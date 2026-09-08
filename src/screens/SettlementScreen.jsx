import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { hashPin } from '../lib/pinHash'
import { compressImage } from '../lib/compressImage'

const MAX_ATTEMPTS = 5
const LOCK_MINUTES = 5

function pad2(n) {
  return String(n).padStart(2, '0')
}

function lastMonthKey() {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}

function thisYearRange() {
  const y = new Date().getFullYear()
  return { from: `${y}-01`, to: `${y}-12` }
}

function formatRemaining(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}분 ${String(s).padStart(2, '0')}초`
}

function settlementSalt(storeCode) {
  return `${storeCode}:settlement`
}

function unlockedStorageKey(storeCode) {
  return `haeyul-settlement-unlocked:${storeCode}`
}

const PRESETS = [
  { key: 'lastMonth', label: '지난 달' },
  { key: 'thisYear', label: '올해' },
  { key: 'custom', label: '기간 선택' },
]

const FIELDS = [
  ['revenue', '총 매출액'],
  ['ingredient_cost', '총 식재료비'],
  ['labor_cost', '인건비'],
  ['general_cost', '일반경비'],
  ['total_expense', '지출총합계'],
  ['operating_profit', '영업손익'],
  ['pretax_profit', '소득세차감전이익'],
]

const AI_FIELD_KEYS = {
  revenue: 'revenue',
  ingredient_cost: 'ingredientCost',
  labor_cost: 'laborCost',
  general_cost: 'generalCost',
  total_expense: 'totalExpense',
  operating_profit: 'operatingProfit',
  pretax_profit: 'pretaxProfit',
}

function fmt(n) {
  return `${Math.round(Number(n ?? 0)).toLocaleString('ko-KR')}원`
}

function monthKeyOf(row) {
  return `${row.year}-${pad2(row.month)}`
}

function SettlementRows({ row }) {
  return (
    <>
      {FIELDS.map(([key, label]) => {
        const pct = key !== 'revenue' && row.revenue ? (Number(row[key] ?? 0) / Number(row.revenue)) * 100 : null
        return (
          <div className="cost-summary-row" key={key}>
            <span>
              {label}
              {pct != null && <span style={{ color: 'var(--text-muted)' }}> ({pct.toFixed(1)}%)</span>}
            </span>
            <strong className={(key === 'operating_profit' || key === 'pretax_profit') && row[key] < 0 ? 'alert-up' : ''}>
              {fmt(row[key])}
            </strong>
          </div>
        )
      })}
    </>
  )
}

export default function SettlementScreen() {
  const { store } = useStore()
  const navigate = useNavigate()

  // ---- 이 화면 전용 비밀번호(잠금) ----
  const [unlocked, setUnlocked] = useState(false)
  const [authLoading, setAuthLoading] = useState(true)
  const [auth, setAuth] = useState(null)
  const [pinInput, setPinInput] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [pinError, setPinError] = useState('')
  const [pinSubmitting, setPinSubmitting] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const [showChangePin, setShowChangePin] = useState(false)
  const [changeCurrentPin, setChangeCurrentPin] = useState('')
  const [changeNewPin, setChangeNewPin] = useState('')
  const [changeConfirmPin, setChangeConfirmPin] = useState('')
  const [changePinError, setChangePinError] = useState('')
  const [changePinMessage, setChangePinMessage] = useState('')
  const [changePinSaving, setChangePinSaving] = useState(false)

  // ---- 결산 조회 ----
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [settlements, setSettlements] = useState([])
  const [preset, setPreset] = useState('lastMonth')
  const [fromMonth, setFromMonth] = useState(lastMonthKey())
  const [toMonth, setToMonth] = useState(lastMonthKey())
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [editingKey, setEditingKey] = useState(null)
  const [editValues, setEditValues] = useState({})
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState('')

  // ---- 파일/사진 업로드 분석 ----
  const [pendingImage, setPendingImage] = useState(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [uploadMessage, setUploadMessage] = useState('')
  const [extractedMonths, setExtractedMonths] = useState([])
  const [savingExtracted, setSavingExtracted] = useState(false)

  useEffect(() => {
    if (!store) navigate('/', { replace: true })
  }, [store, navigate])

  useEffect(() => {
    if (!store) return
    setUnlocked(sessionStorage.getItem(unlockedStorageKey(store.code)) === '1')
    if (!supabase) {
      setAuthLoading(false)
      return
    }
    setAuthLoading(true)
    supabase
      .from('stores')
      .select('settlement_pin_hash, settlement_failed_attempts, settlement_locked_until')
      .eq('code', store.code)
      .single()
      .then(({ data, error: err }) => {
        setAuthLoading(false)
        if (err) {
          setPinError(err.message)
          return
        }
        setAuth(data)
      })
  }, [store])

  const lockedUntilMs = auth?.settlement_locked_until ? new Date(auth.settlement_locked_until).getTime() : null
  const isLocked = lockedUntilMs != null && lockedUntilMs > now

  useEffect(() => {
    if (!isLocked) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [isLocked])

  const fetchSettlements = useCallback(async () => {
    if (!store || !supabase) return
    setLoading(true)
    setError('')
    const { data, error: err } = await supabase
      .from('store_settlements')
      .select('year, month, revenue, ingredient_cost, labor_cost, general_cost, total_expense, operating_profit, pretax_profit')
      .eq('store_code', store.code)
    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }
    setSettlements(data ?? [])
    setLoading(false)
  }, [store])

  useEffect(() => {
    if (!unlocked) return
    fetchSettlements()
  }, [unlocked, fetchSettlements])

  const handleDeleteSettlement = async () => {
    if (!supabase || !deleteTarget) return
    setDeleting(true)
    setDeleteError('')
    const { error: err } = await supabase
      .from('store_settlements')
      .delete()
      .eq('store_code', store.code)
      .eq('year', deleteTarget.year)
      .eq('month', deleteTarget.month)
    setDeleting(false)
    if (err) {
      setDeleteError(err.message)
      return
    }
    setDeleteTarget(null)
    fetchSettlements()
  }

  const startEdit = (row) => {
    setDeleteTarget(null)
    setEditError('')
    setEditingKey(monthKeyOf(row))
    setEditValues(Object.fromEntries(FIELDS.map(([key]) => [key, String(row[key] ?? '')])))
  }

  const cancelEdit = () => {
    setEditingKey(null)
    setEditError('')
  }

  const updateEditValue = (key, value) => {
    setEditValues((prev) => ({ ...prev, [key]: value }))
  }

  const handleSaveEdit = async () => {
    if (!supabase || !editingKey) return
    const [yearStr, monthStr] = editingKey.split('-')
    setSavingEdit(true)
    setEditError('')
    const payload = Object.fromEntries(FIELDS.map(([key]) => [key, Number(editValues[key]) || 0]))
    const { error: err } = await supabase
      .from('store_settlements')
      .update(payload)
      .eq('store_code', store.code)
      .eq('year', Number(yearStr))
      .eq('month', Number(monthStr))
    setSavingEdit(false)
    if (err) {
      setEditError(err.message)
      return
    }
    setEditingKey(null)
    fetchSettlements()
  }

  const handleSetupPin = async () => {
    setPinError('')
    if (!/^\d{4}$/.test(newPin) || !/^\d{4}$/.test(confirmPin)) {
      setPinError('비밀번호 4자리를 입력하세요.')
      return
    }
    if (newPin !== confirmPin) {
      setPinError('두 비밀번호가 서로 달라요.')
      return
    }
    if (!supabase) return
    setPinSubmitting(true)
    const hash = await hashPin(newPin, settlementSalt(store.code))
    const { error: err } = await supabase
      .from('stores')
      .update({ settlement_pin_hash: hash, settlement_failed_attempts: 0, settlement_locked_until: null })
      .eq('code', store.code)
    setPinSubmitting(false)
    if (err) {
      setPinError(err.message)
      return
    }
    sessionStorage.setItem(unlockedStorageKey(store.code), '1')
    setUnlocked(true)
  }

  const handleUnlock = async () => {
    if (!supabase || !auth || isLocked) return
    if (!/^\d{4}$/.test(pinInput)) {
      setPinError('비밀번호 4자리를 입력하세요.')
      return
    }
    setPinSubmitting(true)
    setPinError('')
    const hash = await hashPin(pinInput, settlementSalt(store.code))

    if (hash === auth.settlement_pin_hash) {
      await supabase
        .from('stores')
        .update({ settlement_failed_attempts: 0, settlement_locked_until: null })
        .eq('code', store.code)
      setPinSubmitting(false)
      sessionStorage.setItem(unlockedStorageKey(store.code), '1')
      setUnlocked(true)
      return
    }

    const nextAttempts = (auth.settlement_failed_attempts ?? 0) + 1
    const shouldLock = nextAttempts >= MAX_ATTEMPTS
    const nextLockedUntil = shouldLock ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString() : null

    await supabase
      .from('stores')
      .update({ settlement_failed_attempts: shouldLock ? 0 : nextAttempts, settlement_locked_until: nextLockedUntil })
      .eq('code', store.code)

    setPinSubmitting(false)
    setPinInput('')
    setAuth((prev) => ({ ...prev, settlement_failed_attempts: shouldLock ? 0 : nextAttempts, settlement_locked_until: nextLockedUntil }))
    setNow(Date.now())
    if (!shouldLock) {
      setPinError(`비밀번호가 틀렸습니다 (${nextAttempts}/${MAX_ATTEMPTS})`)
    }
  }

  const handleChangePin = async () => {
    setChangePinError('')
    setChangePinMessage('')
    if (!/^\d{4}$/.test(changeCurrentPin) || !/^\d{4}$/.test(changeNewPin) || !/^\d{4}$/.test(changeConfirmPin)) {
      setChangePinError('비밀번호는 모두 4자리 숫자로 입력하세요.')
      return
    }
    if (changeNewPin !== changeConfirmPin) {
      setChangePinError('새 비밀번호와 확인이 서로 달라요.')
      return
    }
    if (!supabase) return

    setChangePinSaving(true)
    const { data, error: fetchErr } = await supabase
      .from('stores')
      .select('settlement_pin_hash')
      .eq('code', store.code)
      .single()
    if (fetchErr) {
      setChangePinSaving(false)
      setChangePinError(fetchErr.message)
      return
    }

    const currentHash = await hashPin(changeCurrentPin, settlementSalt(store.code))
    if (currentHash !== data.settlement_pin_hash) {
      setChangePinSaving(false)
      setChangePinError('현재 비밀번호가 틀렸습니다.')
      return
    }

    const newHash = await hashPin(changeNewPin, settlementSalt(store.code))
    const { error: updateErr } = await supabase
      .from('stores')
      .update({ settlement_pin_hash: newHash, settlement_failed_attempts: 0, settlement_locked_until: null })
      .eq('code', store.code)

    setChangePinSaving(false)
    if (updateErr) {
      setChangePinError(updateErr.message)
      return
    }
    setChangeCurrentPin('')
    setChangeNewPin('')
    setChangeConfirmPin('')
    setChangePinMessage('비밀번호를 변경했습니다.')
  }

  const applyPreset = (key) => {
    setPreset(key)
    if (key === 'lastMonth') {
      const m = lastMonthKey()
      setFromMonth(m)
      setToMonth(m)
    } else if (key === 'thisYear') {
      const { from, to } = thisYearRange()
      setFromMonth(from)
      setToMonth(to)
    }
  }

  const filteredRows = useMemo(() => {
    return settlements
      .filter((r) => monthKeyOf(r) >= fromMonth && monthKeyOf(r) <= toMonth)
      .sort((a, b) => (monthKeyOf(a) < monthKeyOf(b) ? 1 : -1))
  }, [settlements, fromMonth, toMonth])

  const totals = useMemo(() => {
    if (filteredRows.length === 0) return null
    const sum = (key) => filteredRows.reduce((acc, r) => acc + Number(r[key] ?? 0), 0)
    return Object.fromEntries(FIELDS.map(([key]) => [key, sum(key)]))
  }, [filteredRows])

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadError('')
    setUploadMessage('')
    setExtractedMonths([])
    try {
      const { base64, mediaType, previewUrl: preview } = await compressImage(file)
      setPendingImage({ imageBase64: base64, mediaType })
      setPreviewUrl(preview)
    } catch (err) {
      setUploadError(err.message)
    }
  }

  const handleAnalyze = async () => {
    if (!pendingImage) return
    setAnalyzing(true)
    setUploadError('')
    try {
      const res = await fetch('/api/analyze-settlement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pendingImage),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '분석에 실패했습니다')

      const existingKeys = new Set(settlements.map(monthKeyOf))
      const rows = (data.months ?? []).map((m) => {
        const key = `${m.year}-${pad2(m.month)}`
        const row = { year: String(m.year ?? ''), month: String(m.month ?? ''), isDuplicate: existingKeys.has(key), overwrite: false }
        for (const [dbKey, aiKey] of Object.entries(AI_FIELD_KEYS)) {
          row[dbKey] = m[aiKey] != null ? String(m[aiKey]) : ''
        }
        return row
      })
      setExtractedMonths(rows)
      if (rows.length === 0) setUploadError('사진에서 인식된 월이 없습니다. 더 선명한 사진으로 다시 시도해주세요.')
    } catch (err) {
      setUploadError(err.message)
    } finally {
      setAnalyzing(false)
    }
  }

  const updateExtracted = (index, field, value) => {
    setExtractedMonths((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)))
  }

  const toggleOverwrite = (index) => {
    setExtractedMonths((prev) => prev.map((row, i) => (i === index ? { ...row, overwrite: !row.overwrite } : row)))
  }

  const handleSaveExtracted = async () => {
    if (!supabase) return
    setUploadError('')
    setUploadMessage('')

    const toSave = extractedMonths.filter((row) => !row.isDuplicate || row.overwrite)
    if (toSave.length === 0) {
      setUploadError('저장할 달이 없습니다. 겹치는 달은 덮어쓰기를 체크해주세요.')
      return
    }

    setSavingExtracted(true)
    const payload = toSave.map((row) => ({
      store_code: store.code,
      year: Number(row.year),
      month: Number(row.month),
      revenue: Number(row.revenue) || 0,
      ingredient_cost: Number(row.ingredient_cost) || 0,
      labor_cost: Number(row.labor_cost) || 0,
      general_cost: Number(row.general_cost) || 0,
      total_expense: Number(row.total_expense) || 0,
      operating_profit: Number(row.operating_profit) || 0,
      pretax_profit: Number(row.pretax_profit) || 0,
    }))

    const { error: err } = await supabase.from('store_settlements').upsert(payload, { onConflict: 'store_code,year,month' })
    setSavingExtracted(false)
    if (err) {
      setUploadError(err.message)
      return
    }
    setUploadMessage(`${toSave.length}개월 저장했습니다.`)
    setExtractedMonths([])
    setPendingImage(null)
    setPreviewUrl('')
    fetchSettlements()
  }

  if (!store) return null

  if (!unlocked) {
    return (
      <div className="screen">
        <div className="screen-header">
          <button type="button" className="link-btn" onClick={() => navigate('/menu')}>
            ← 메인 메뉴
          </button>
          <h1>매장운영결산</h1>
          <p className="subtitle">사장님만 볼 수 있는 화면이에요</p>
        </div>

        {!supabase && <p className="hint">Supabase가 설정되지 않았습니다.</p>}
        {supabase && authLoading && <p className="hint">불러오는 중...</p>}

        {supabase && !authLoading && auth && auth.settlement_pin_hash == null && (
          <>
            <p className="hint">처음 사용이시네요. 이 화면 전용 비밀번호(4자리)를 새로 만드세요.</p>
            <div className="field">
              <label htmlFor="newPin">새 비밀번호</label>
              <input
                id="newPin"
                className="input"
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="••••"
                autoFocus
              />
            </div>
            <div className="field">
              <label htmlFor="confirmPin">비밀번호 확인</label>
              <input
                id="confirmPin"
                className="input"
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="••••"
              />
            </div>
            {pinError && <p className="error-text">{pinError}</p>}
            <button type="button" className="btn-primary" onClick={handleSetupPin} disabled={pinSubmitting}>
              {pinSubmitting ? '설정 중...' : '설정하고 시작하기'}
            </button>
          </>
        )}

        {supabase && !authLoading && auth && auth.settlement_pin_hash != null && (
          <>
            <div className="field">
              <label htmlFor="pinInput">비밀번호</label>
              <input
                id="pinInput"
                className="input"
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
                onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
                placeholder="••••"
                disabled={isLocked || pinSubmitting}
                autoFocus
              />
            </div>

            {isLocked && (
              <p className="error-text">
                🔒 비밀번호를 {MAX_ATTEMPTS}회 잘못 입력해서 {LOCK_MINUTES}분간 잠겼어요.
                <br />
                {formatRemaining(lockedUntilMs - now)} 후 다시 시도할 수 있어요.
              </p>
            )}
            {!isLocked && pinError && <p className="error-text">{pinError}</p>}

            <button
              type="button"
              className="btn-primary"
              onClick={handleUnlock}
              disabled={isLocked || pinSubmitting || pinInput.length !== 4}
            >
              {pinSubmitting ? '확인 중...' : '확인'}
            </button>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/menu')}>
          ← 메인 메뉴
        </button>
        <h1>매장운영결산</h1>
        <p className="subtitle">{store.name} · 월별 매출·비용·손익을 확인해요</p>
      </div>

      <h2 className="section-title">자료 올리기</h2>
      <p className="hint">결산 엑셀 화면을 캡처하거나 사진으로 찍어 올리면 자동으로 읽어드려요.</p>
      <div className="upload-btn-row">
        <label className="upload-btn">
          {previewUrl ? '다른 파일 선택' : '파일 선택'}
          <input type="file" accept="image/*" onChange={handleFileChange} hidden />
        </label>
        <label className="upload-btn">
          카메라로 촬영
          <input type="file" accept="image/*" capture="environment" onChange={handleFileChange} hidden />
        </label>
      </div>

      {previewUrl && <img className="photo-preview" src={previewUrl} alt="업로드한 결산표 미리보기" />}

      {pendingImage && extractedMonths.length === 0 && (
        <button type="button" className="btn-primary" onClick={handleAnalyze} disabled={analyzing}>
          {analyzing ? '분석 중...' : '분석하기'}
        </button>
      )}

      {uploadError && <p className="error-text">{uploadError}</p>}
      {uploadMessage && <p className="success-text">{uploadMessage}</p>}

      {extractedMonths.length > 0 && (
        <>
          <h2 className="section-title">읽은 내용 확인</h2>
          <p className="hint">숫자가 틀렸으면 바로 고치고, 확인되면 저장하세요.</p>
          {extractedMonths.map((row, i) => (
            <div className="cost-summary" key={i}>
              <h3 className="settlement-month-title">
                {row.year}년 {row.month}월
                {row.isDuplicate && <span className="cost-warning"> · 이미 저장된 달이에요</span>}
              </h3>
              {FIELDS.map(([key, label]) => (
                <div className="cost-summary-row" key={key}>
                  <span>{label}</span>
                  <input
                    className="input"
                    style={{ maxWidth: 160, textAlign: 'right' }}
                    inputMode="numeric"
                    value={row[key]}
                    onChange={(e) => updateExtracted(i, key, e.target.value.replace(/[^0-9-]/g, ''))}
                  />
                </div>
              ))}
              {row.isDuplicate && (
                <div className="field" style={{ marginTop: 8, marginBottom: 0 }}>
                  <label className="toggle-row">
                    <input type="checkbox" checked={row.overwrite} onChange={() => toggleOverwrite(i)} />
                    <span>이 달 데이터를 덮어쓸게요</span>
                  </label>
                </div>
              )}
            </div>
          ))}
          <button type="button" className="btn-primary" onClick={handleSaveExtracted} disabled={savingExtracted}>
            {savingExtracted ? '저장 중...' : '저장하기'}
          </button>
        </>
      )}

      <h2 className="section-title">결산 조회</h2>

      {!supabase && <p className="hint">Supabase가 설정되지 않았습니다.</p>}
      {loading && <p className="hint">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}

      {!loading && supabase && (
        <>
          <div className="preset-row">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                className={preset === p.key ? 'chip chip-active' : 'chip'}
                onClick={() => applyPreset(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="date-range">
            <input
              type="month"
              className="input"
              value={fromMonth}
              onChange={(e) => {
                setFromMonth(e.target.value)
                setPreset('custom')
              }}
              aria-label="시작월"
            />
            <span className="date-range-sep">~</span>
            <input
              type="month"
              className="input"
              value={toMonth}
              onChange={(e) => {
                setToMonth(e.target.value)
                setPreset('custom')
              }}
              aria-label="종료월"
            />
          </div>

          {filteredRows.length === 0 && <p className="hint">이 기간에 저장된 결산이 없습니다.</p>}

          {totals && (
            <div className="cost-summary settlement-total">
              <h2 className="settlement-month-title">선택 기간 합계 ({filteredRows.length}개월)</h2>
              <SettlementRows row={totals} />
            </div>
          )}

          {deleteError && <p className="error-text">{deleteError}</p>}

          {filteredRows.map((row) => {
            const isEditing = editingKey === monthKeyOf(row)
            return (
            <div className="cost-summary" key={monthKeyOf(row)}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <h2 className="settlement-month-title">
                  {row.year}년 {row.month}월
                </h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  {!isEditing && (
                    <button type="button" className="link-btn" style={{ marginTop: 0 }} onClick={() => startEdit(row)}>
                      수정
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`${row.year}년 ${row.month}월 결산 삭제`}
                    onClick={() => {
                      setEditingKey(null)
                      setDeleteTarget(row)
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>

              {isEditing ? (
                <>
                  {FIELDS.map(([key, label]) => (
                    <div className="cost-summary-row" key={key}>
                      <span>{label}</span>
                      <input
                        className="input"
                        style={{ maxWidth: 160, textAlign: 'right' }}
                        inputMode="numeric"
                        value={editValues[key] ?? ''}
                        onChange={(e) => updateEditValue(key, e.target.value.replace(/[^0-9-]/g, ''))}
                      />
                    </div>
                  ))}
                  {editError && <p className="error-text">{editError}</p>}
                  <div className="invoice-form">
                    <button type="button" className="btn-secondary" onClick={cancelEdit} disabled={savingEdit}>
                      취소
                    </button>
                    <button type="button" className="btn-primary" onClick={handleSaveEdit} disabled={savingEdit}>
                      {savingEdit ? '저장 중...' : '저장'}
                    </button>
                  </div>
                </>
              ) : (
                <SettlementRows row={row} />
              )}

              {deleteTarget && monthKeyOf(deleteTarget) === monthKeyOf(row) && (
                <div className="price-alert-box price-alert-box-danger" style={{ marginTop: 12 }}>
                  <p className="price-alert-title">
                    {row.year}년 {row.month}월 결산을 삭제할까요?
                  </p>
                  <p className="hint">되돌릴 수 없어요.</p>
                  <div className="invoice-form">
                    <button type="button" className="btn-secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                      취소
                    </button>
                    <button type="button" className="btn-primary" onClick={handleDeleteSettlement} disabled={deleting}>
                      {deleting ? '삭제 중...' : '삭제'}
                    </button>
                  </div>
                </div>
              )}
            </div>
            )
          })}

        </>
      )}

      <p style={{ marginTop: 24 }}>
        <button type="button" className="link-btn" onClick={() => setShowChangePin((v) => !v)}>
          {showChangePin ? '비밀번호 변경 닫기' : '이 화면 비밀번호 변경'}
        </button>
      </p>

      {showChangePin && (
        <div className="cost-summary" style={{ textAlign: 'left' }}>
          <div className="field">
            <label htmlFor="changeCurrentPin">현재 비밀번호</label>
            <input
              id="changeCurrentPin"
              className="input"
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={changeCurrentPin}
              onChange={(e) => setChangeCurrentPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="••••"
            />
          </div>
          <div className="field">
            <label htmlFor="changeNewPin">새 비밀번호</label>
            <input
              id="changeNewPin"
              className="input"
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={changeNewPin}
              onChange={(e) => setChangeNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="••••"
            />
          </div>
          <div className="field">
            <label htmlFor="changeConfirmPin">새 비밀번호 확인</label>
            <input
              id="changeConfirmPin"
              className="input"
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={changeConfirmPin}
              onChange={(e) => setChangeConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="••••"
            />
          </div>
          {changePinError && <p className="error-text">{changePinError}</p>}
          {changePinMessage && <p className="success-text">{changePinMessage}</p>}
          <button type="button" className="btn-primary" onClick={handleChangePin} disabled={changePinSaving}>
            {changePinSaving ? '저장 중...' : '비밀번호 변경'}
          </button>
        </div>
      )}
    </div>
  )
}
