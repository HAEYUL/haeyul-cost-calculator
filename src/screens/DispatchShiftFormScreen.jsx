import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { useGoBack } from '../hooks/usePageHistoryState'
import { dispatchRequest, fetchShifts, fetchWorkers, SHIFT_COLUMNS, workerPayload } from '../lib/dispatchApi'
import {
  findSimilarWorkers,
  finishTimeInput,
  formatTimeInput,
  hhmm,
  INSURANCE_DAY_LIMIT,
  isValidTime,
  monthRange,
  POSITIONS,
  rrnDigits,
  rrnError,
  showMaskedRrn,
  SIMILAR_REASON_LABELS,
  won,
} from '../lib/dispatch'
import { todayStr } from '../lib/vendorLedger'

const BANKS = ['기업은행', '국민은행', '농협', '신한은행', '우리은행', '하나은행', '카카오뱅크', '토스뱅크', '새마을금고', '우체국', '수협', '신협', 'SC제일은행', '케이뱅크']

// 파출 근무 등록·수정. 입력: 근무날짜 · 이름 · 주민번호 · 근무시간 · 일당 · 계좌번호.
// 처음 오신 분은 인력 명부에 같이 저장되고, 다음부터는 이름만 고르면 주민번호·계좌가 채워진다.
export default function DispatchShiftFormScreen() {
  const { store, isAdmin } = useStore()
  const navigate = useNavigate()
  const goBack = useGoBack('/dispatch')
  const { shiftId } = useParams()
  const [searchParams] = useSearchParams()
  const editMode = Boolean(shiftId)

  const [workers, setWorkers] = useState([])
  const [loading, setLoading] = useState(true)
  const [original, setOriginal] = useState(null)

  const [date, setDate] = useState(todayStr())
  const [workerId, setWorkerId] = useState(null)
  const [nameInput, setNameInput] = useState('')
  const [creatingNew, setCreatingNew] = useState(false)
  const [rrnFront, setRrnFront] = useState('')
  const [rrnBack, setRrnBack] = useState('')
  // 근무시간·일당은 매번 직접 입력한다 (자동으로 채우지 않음)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [wage, setWage] = useState('')
  const [bank, setBank] = useState('')
  const [account, setAccount] = useState('')
  const [editingAccount, setEditingAccount] = useState(false)
  const [memo, setMemo] = useState('')
  const [position, setPosition] = useState('')

  const [monthInfo, setMonthInfo] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [duplicatePrompt, setDuplicatePrompt] = useState(null)
  const [sameDayConfirm, setSameDayConfirm] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const worker = workers.find((w) => w.id === workerId) ?? null
  const locked = Boolean(original?.paid_date) && !isAdmin

  const applyWorker = (w) => {
    setWorkerId(w.id)
    setNameInput(w.name)
    setCreatingNew(false)
    setBank(w.bank ?? '')
    setAccount(w.account ?? '')
    setEditingAccount(!w.account)
    setDuplicatePrompt(null)
    if (!editMode && w.default_position) setPosition(w.default_position)
  }

  // 인력 명부와 (수정이면) 근무 기록 불러오기
  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    ;(async () => {
      try {
        const list = await fetchWorkers(store.code)
        if (cancelled) return
        setWorkers(list)
        if (editMode) {
          const { data, error: err } = await supabase.from('dispatch_shifts').select(SHIFT_COLUMNS).eq('id', shiftId).maybeSingle()
          if (cancelled) return
          if (err) throw err
          if (!data) throw new Error('근무 기록을 찾을 수 없어요.')
          setOriginal(data)
          const w = list.find((x) => x.id === data.worker_id)
          setWorkerId(data.worker_id)
          setNameInput(w?.name ?? '')
          setDate(data.work_date)
          setStart(hhmm(data.start_time))
          setEnd(hhmm(data.end_time))
          setWage(String(data.wage))
          setBank(data.bank ?? w?.bank ?? '')
          setAccount(data.account ?? w?.account ?? '')
          setMemo(data.memo ?? '')
          setPosition(data.position ?? '')
        } else {
          const preset = list.find((x) => x.id === searchParams.get('worker'))
          if (preset) applyWorker(preset)
        }
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // applyWorker·searchParams는 처음 한 번만 쓴다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, shiftId, editMode])

  // 고른 분의 이번 달 근무(같은 날 중복, 8일 이상 경고용)
  useEffect(() => {
    if (!workerId || !date || !supabase) {
      setMonthInfo(null)
      return
    }
    let cancelled = false
    const { start: from, end: to } = monthRange(date.slice(0, 7))
    fetchShifts({ storeCodes: store.code, workerId, start: from, end: to })
      .then((rows) => {
        if (cancelled) return
        const others = rows.filter((r) => r.id !== shiftId)
        setMonthInfo({
          days: new Set(others.map((r) => r.work_date)).size,
          total: others.reduce((sum, r) => sum + Number(r.wage || 0), 0),
          sameDay: others.some((r) => r.work_date === date),
        })
      })
      .catch(() => !cancelled && setMonthInfo(null))
    return () => {
      cancelled = true
    }
  }, [store, workerId, date, shiftId])

  const suggestions = useMemo(() => {
    if (workerId || creatingNew || !nameInput.trim()) return []
    return findSimilarWorkers(nameInput, workers)
  }, [nameInput, workers, workerId, creatingNew])


  const handleSave = async () => {
    setError('')
    if (locked) return
    const wageNum = Number(String(wage).replace(/,/g, ''))
    if (!date) return setError('근무날짜를 입력하세요.')
    if (!isValidTime(start) || !isValidTime(end)) return setError('근무시간을 4자리 숫자로 입력하세요. 예: 0900 ~ 2100')
    if (wage === '' || !Number.isInteger(wageNum) || wageNum <= 0) return setError('일당을 입력하세요.')
    if (!position) return setError('포지션(홀/주방)을 체크하세요.')
    if (!workerId && !creatingNew) {
      if (!nameInput.trim()) return setError('이름을 입력하세요.')
      return setError('위에서 같은 분을 고르거나 [새로 등록할게요]를 눌러주세요.')
    }
    const rrn = `${rrnFront}${rrnBack}`
    if (creatingNew) {
      if (!nameInput.trim()) return setError('이름을 입력하세요.')
      const rrnErr = rrnError(rrn)
      if (rrnErr) return setError(rrnErr)
    }
    if (monthInfo?.sameDay && !sameDayConfirm) {
      setSameDayConfirm(true)
      return setError('이 분은 같은 날 근무가 이미 있어요. 그래도 저장하려면 [저장]을 한 번 더 누르세요.')
    }

    setSaving(true)
    try {
      let targetId = workerId
      // 1) 처음 오신 분: 인력 명부에 저장 (주민번호는 서버에서 암호화)
      if (creatingNew) {
        const { ok, status, body } = await dispatchRequest('saveWorker', {
          storeCode: store.code,
          name: nameInput.trim(),
          rrn: rrnDigits(rrn),
          bank,
          account,
          defaultPosition: position,
        })
        if (!ok) {
          if (status === 409 && body.duplicate) {
            const existing = workers.find((w) => w.id === body.duplicate.id)
            setDuplicatePrompt(existing ?? null)
          }
          throw new Error(body.error || '인력을 저장하지 못했어요.')
        }
        targetId = body.worker.id
        setWorkers((prev) => [...prev, body.worker])
        setWorkerId(targetId)
        setCreatingNew(false)
      } else if (worker && ((worker.bank ?? '') !== bank || (worker.account ?? '') !== account || !worker.default_position)) {
        // 2) 계좌를 바꿨거나 평소 포지션이 비어 있으면 명부에도 반영
        const { ok, body } = await dispatchRequest('saveWorker', {
          storeCode: store.code,
          ...workerPayload(worker, { bank, account, defaultPosition: worker.default_position || position }),
        })
        if (!ok) throw new Error(body.error || '인력 정보를 저장하지 못했어요.')
        setWorkers((prev) => prev.map((w) => (w.id === body.worker.id ? body.worker : w)))
      }

      // 3) 근무 기록
      const row = {
        store_code: store.code,
        worker_id: targetId,
        work_date: date,
        start_time: start,
        end_time: end,
        wage: wageNum,
        position,
        bank: bank || null,
        account: account || null,
        memo: memo.trim() || null,
      }
      const { error: err } = editMode
        ? await supabase.from('dispatch_shifts').update(row).eq('id', shiftId)
        : await supabase.from('dispatch_shifts').insert(row)
      if (err) throw err
      goBack()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setSaving(true)
    const { error: err } = await supabase.from('dispatch_shifts').delete().eq('id', shiftId)
    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }
    goBack()
  }

  if (loading) {
    return (
      <div className="screen screen-wide">
        <p className="hint">불러오는 중...</p>
      </div>
    )
  }

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={goBack}>
          ← 파출 관리
        </button>
        <h1>{editMode ? '파출 근무 수정' : '파출 근무 등록'}</h1>
        <p className="subtitle">{store.name}</p>
      </div>

      {locked && (
        <div className="price-alert-box">
          <p className="price-alert-title">🔒 송금완료된 근무예요</p>
          <p className="hint">메인 관리자만 고칠 수 있어요. 잘못된 내용이 있으면 메인 관리자에게 알려주세요.</p>
        </div>
      )}
      {isAdmin && original?.paid_date && (
        <div className="price-alert-box">
          <p className="price-alert-title">💸 {original.paid_date}에 송금완료된 근무예요</p>
          <p className="hint">금액을 바꾸면 송금한 금액과 달라질 수 있어요.</p>
        </div>
      )}

      <div className="invoice-form">
        <div className="field">
          <label htmlFor="workDate">근무날짜</label>
          <input id="workDate" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} disabled={locked} />
        </div>

        <div className="field">
          <label htmlFor="workerName">이름</label>
          {workerId && !creatingNew ? (
            <div className="input dispatch-picked">
              <span>
                <strong>{worker?.name ?? nameInput}</strong> {worker?.is_fixed && <span className="tag">고정</span>}
              </span>
              {!locked && !editMode && (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setWorkerId(null)
                    setNameInput('')
                    setBank('')
                    setAccount('')
                  }}
                >
                  변경
                </button>
              )}
            </div>
          ) : (
            <input
              id="workerName"
              className="input"
              value={nameInput}
              onChange={(e) => {
                setNameInput(e.target.value)
                setCreatingNew(false)
                setDuplicatePrompt(null)
              }}
              placeholder="이름을 입력하면 비슷한 이름을 찾아드려요"
              autoComplete="off"
            />
          )}

          {suggestions.length > 0 && (
            <div className="similar-box">
              <p className="similar-title">
                {suggestions.some((s) => s.reason === 'same') ? '✅ 등록된 분이 있어요' : '⚠️ 비슷한 이름이 있어요'} — 같은 분이면 눌러주세요
              </p>
              {suggestions.map(({ worker: w, reason }) => (
                <div key={w.id} className="similar-row">
                  <div>
                    <strong>{w.name}</strong> {w.is_fixed && <span className="tag">고정</span>}{' '}
                    <span className="hint">({SIMILAR_REASON_LABELS[reason]})</span>
                    <div className="hint">
                      {showMaskedRrn(w.rrn_masked)} · {[w.bank, w.account].filter(Boolean).join(' ') || '계좌 없음'}
                    </div>
                  </div>
                  <button type="button" className="chip chip-active" onClick={() => applyWorker(w)}>
                    이 분이에요
                  </button>
                </div>
              ))}
              <div className="similar-new">
                <button type="button" className="chip" onClick={() => setCreatingNew(true)}>
                  아니요, 새로 등록할게요
                </button>
              </div>
            </div>
          )}
          {!workerId && !creatingNew && nameInput.trim() && suggestions.length === 0 && (
            <div className="similar-new">
              <button type="button" className="chip chip-active" onClick={() => setCreatingNew(true)}>
                처음 오신 분 — 새로 등록
              </button>
            </div>
          )}
          {duplicatePrompt && (
            <div className="similar-box">
              <p className="similar-title">같은 주민번호로 등록된 분이 있어요</p>
              <div className="similar-row">
                <strong>{duplicatePrompt.name}</strong>
                <button type="button" className="chip chip-active" onClick={() => applyWorker(duplicatePrompt)}>
                  이 분으로 등록
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="field">
          <label>주민등록번호</label>
          {creatingNew ? (
            <div className="rrn-row">
              <input
                className="input"
                inputMode="numeric"
                maxLength={6}
                value={rrnFront}
                onChange={(e) => setRrnFront(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="앞 6자리"
                autoComplete="off"
              />
              <span>-</span>
              <input
                className="input"
                type="password"
                inputMode="numeric"
                maxLength={7}
                value={rrnBack}
                onChange={(e) => setRrnBack(e.target.value.replace(/\D/g, '').slice(0, 7))}
                placeholder="뒤 7자리"
                autoComplete="off"
              />
            </div>
          ) : (
            <div className="input dispatch-picked">
              <span>{worker ? showMaskedRrn(worker.rrn_masked) : '이름을 먼저 고르세요'}</span>
              {worker && <span className="hint">🔒 저장됨</span>}
            </div>
          )}
          {creatingNew && <p className="hint">주민번호는 암호화해서 저장하고, 화면에는 앞자리만 보여요.</p>}
        </div>

        <div className="field">
          <label>포지션</label>
          <div className="position-row" role="radiogroup" aria-label="포지션">
            {POSITIONS.map((p) => (
              <button
                key={p.key}
                type="button"
                role="radio"
                aria-checked={position === p.key}
                className={`position-btn${position === p.key ? ' position-btn-on' : ''}`}
                onClick={() => setPosition(p.key)}
                disabled={locked}
              >
                <span className="position-check">{position === p.key ? '☑' : '☐'}</span> {p.icon} {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>근무시간</label>
          <div className="rrn-row">
            <input
              className="input time-input"
              inputMode="numeric"
              value={start}
              onChange={(e) => setStart(formatTimeInput(e.target.value))}
              onBlur={() => setStart((v) => finishTimeInput(v))}
              placeholder="시작 (예: 0900)"
              disabled={locked}
              aria-label="시작 시간"
            />
            <span>~</span>
            <input
              className="input time-input"
              inputMode="numeric"
              value={end}
              onChange={(e) => setEnd(formatTimeInput(e.target.value))}
              onBlur={() => setEnd((v) => finishTimeInput(v))}
              placeholder="끝 (예: 2100)"
              disabled={locked}
              aria-label="끝 시간"
            />
          </div>
          {!locked && <p className="hint">숫자 4자리로 입력하세요. 24시간 기준 (밤 9시 = 2100)</p>}
        </div>

        <div className="field">
          <label htmlFor="wage">일당 (원)</label>
          <input
            id="wage"
            className="input"
            inputMode="numeric"
            value={wage === '' ? '' : Number(wage).toLocaleString('ko-KR')}
            onChange={(e) => setWage(e.target.value.replace(/\D/g, ''))}
            placeholder="일당을 직접 입력하세요"
            disabled={locked}
          />
        </div>

        <div className="field">
          <label>계좌번호</label>
          {worker && !editingAccount && !creatingNew ? (
            <div className="input dispatch-picked">
              <span>{[bank, account].filter(Boolean).join(' ') || '계좌 없음'}</span>
              {!locked && (
                <button type="button" className="link-btn" onClick={() => setEditingAccount(true)}>
                  바꾸기
                </button>
              )}
            </div>
          ) : (
            <div className="rrn-row">
              <input className="input bank-input" list="bank-list" value={bank} onChange={(e) => setBank(e.target.value)} placeholder="은행" disabled={locked} />
              <input
                className="input"
                inputMode="numeric"
                value={account}
                onChange={(e) => setAccount(e.target.value.replace(/[^\d-]/g, ''))}
                placeholder="계좌번호"
                disabled={locked}
              />
              <datalist id="bank-list">
                {BANKS.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </div>
          )}
        </div>

        <div className="field">
          <label htmlFor="memo">메모 (선택)</label>
          <input id="memo" className="input" value={memo} onChange={(e) => setMemo(e.target.value)} disabled={locked} placeholder="예: 주방 보조" />
        </div>

        {worker && monthInfo && (
          <div className="cost-summary">
            <p className="price-alert-title">
              {worker.name}님 {Number(date.slice(5, 7))}월
            </p>
            <div className="cost-summary-row">
              <span>이 근무 빼고</span>
              <span>
                {monthInfo.days}일 · {won(monthInfo.total)}
              </span>
            </div>
            {monthInfo.days + 1 >= INSURANCE_DAY_LIMIT && (
              <p className="hint cost-warning">
                ⚠️ 이번 달 {INSURANCE_DAY_LIMIT}일 이상 근무예요 (국민연금·건강보험 확인 대상, 관리자 화면에도 표시돼요)
              </p>
            )}
          </div>
        )}

        {error && <p className="error-text">{error}</p>}

        {!locked && (
          <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '저장 중...' : '저장'}
          </button>
        )}
        {editMode && !locked && (
          <button type="button" className="btn-secondary danger-btn" onClick={handleDelete} disabled={saving}>
            {confirmDelete ? '정말 지울까요? 한 번 더 누르면 지워져요' : '이 근무 지우기'}
          </button>
        )}
        {worker && (
          <button type="button" className="link-btn" onClick={() => navigate(`/dispatch/workers/${worker.id}?month=${date.slice(0, 7)}`)}>
            {worker.name}님 한 달 내역 보기 →
          </button>
        )}
      </div>
    </div>
  )
}
