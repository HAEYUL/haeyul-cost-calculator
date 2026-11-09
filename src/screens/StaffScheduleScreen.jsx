import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { compressImage } from '../lib/compressImage'
import { cycleMark, daysInMonth, countMarks, MARK_LABELS } from '../lib/staffSchedule'
import { apiFetch } from '../lib/apiFetch'
import DailyCheck from '../components/staff/DailyCheck'
import { mergeScheduleDays } from '../lib/staffDaily'
import { buildStaffMonthSheets } from '../lib/staffExport'
import { downloadXlsx } from '../lib/xlsxWriter'
import { fetchShifts, fetchWorkers } from '../lib/dispatchApi'
import StaffRoster from '../components/staff/StaffRoster'

function pad2(n) {
  return String(n).padStart(2, '0')
}

function monthKeyOf(row) {
  return `${row.year}-${pad2(row.month)}`
}

function thisMonthKey() {
  const now = new Date()
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`
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

const SECTIONS = [
  { key: 'daily', label: '오늘 근무 체크' },
  { key: 'browse', label: '월 근무표' },
  { key: 'upload', label: '사진·파일로 올리기' },
  { key: 'employee', label: '직원별 조회' },
  { key: 'roster', label: '직원 관리' },
]

const PRESETS = [
  { key: 'lastMonth', label: '지난 달' },
  { key: 'thisYear', label: '올해' },
  { key: 'custom', label: '기간 선택' },
]

function CountsLine({ counts }) {
  return (
    <>
      <div className="cost-summary-row">
        <span>
          {MARK_LABELS.O} {counts.full}일 · {MARK_LABELS['△']} {counts.half}일 · {MARK_LABELS['연']} {counts.leave}일 ·{' '}
          {MARK_LABELS.X} {counts.off}일
        </span>
      </div>
      <div className="cost-summary-row">
        <span>총 근무일수</span>
        <strong>{counts.total}일</strong>
      </div>
    </>
  )
}

function DayGrid({ year, month, days, onCycle }) {
  const n = daysInMonth(year, month)
  return (
    <div className="item-table-wrap" style={{ marginTop: 10 }}>
      <div className="day-grid" style={{ minWidth: n * 34 }}>
        {Array.from({ length: n }, (_, i) => i + 1).map((day) => {
          const mark = days[day]
          const markClass =
            mark === 'O' ? 'day-cell-full' : mark === '△' ? 'day-cell-half' : mark === '연' ? 'day-cell-leave' : mark === 'X' ? 'day-cell-off' : ''
          return (
            <button key={day} type="button" className={`day-cell ${markClass}`} onClick={() => onCycle(day)} disabled={!onCycle}>
              <span className="day-cell-num">{day}</span>
              <span className="day-cell-mark">{mark ?? '-'}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function StaffScheduleScreen() {
  const { store, isAdmin } = useStore()
  const navigate = useNavigate()
  const [section, setSection] = useState('daily')

  useEffect(() => {
    if (!store) navigate('/', { replace: true })
  }, [store, navigate])

  // ---- 자료 올리기 ----
  const [pendingImage, setPendingImage] = useState(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [uploadMessage, setUploadMessage] = useState('')
  const [extracted, setExtracted] = useState(null)
  const [savingExtracted, setSavingExtracted] = useState(false)
  const [openDetail, setOpenDetail] = useState(new Set())

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadError('')
    setUploadMessage('')
    setExtracted(null)
    try {
      const { base64, mediaType, previewUrl: preview } = await compressImage(file)
      setPendingImage({ imageBase64: base64, mediaType })
      setPreviewUrl(preview)
    } catch (err) {
      setUploadError(err.message)
    }
  }

  const handleAnalyze = async () => {
    if (!pendingImage || !supabase) return
    setAnalyzing(true)
    setUploadError('')
    try {
      const res = await apiFetch('/api/analyze-staff-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pendingImage),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '분석에 실패했습니다')

      const year = data.year ?? new Date().getFullYear()
      const month = data.month
      if (!month) throw new Error('월을 인식하지 못했습니다. 더 선명한 사진으로 다시 시도해주세요.')

      const { data: existing, error: existErr } = await supabase
        .from('staff_schedules')
        .select('employee_name, days')
        .eq('store_code', store.code)
        .eq('year', year)
        .eq('month', month)
      if (existErr) throw existErr
      // 이미 저장된(매일 입력했거나 전에 올린) 근무와 합치기 위해 직원별 기존 표시를 같이 들고 있는다.
      const existingByName = Object.fromEntries((existing ?? []).map((r) => [r.employee_name, r.days ?? {}]))

      const employees = (data.employees ?? []).map((e) => ({
        name: e.name,
        days: Object.fromEntries((e.entries ?? []).map((en) => [String(en.day), en.mark])),
      }))

      if (employees.length === 0) {
        setUploadError('사진에서 인식된 직원이 없습니다. 더 선명한 사진으로 다시 시도해주세요.')
        return
      }
      setExtracted({ year, month, employees, existingByName, policy: 'keep' })
      setOpenDetail(new Set())
    } catch (err) {
      setUploadError(err.message)
    } finally {
      setAnalyzing(false)
    }
  }

  const updateExtractedName = (index, name) => {
    setExtracted((prev) => ({ ...prev, employees: prev.employees.map((e, i) => (i === index ? { ...e, name } : e)) }))
  }

  const setMergePolicy = (policy) => setExtracted((prev) => ({ ...prev, policy }))

  const cycleExtractedDay = (index, day) => {
    setExtracted((prev) => ({
      ...prev,
      employees: prev.employees.map((e, i) => {
        if (i !== index) return e
        const next = { ...e.days }
        const nextMark = cycleMark(next[day])
        if (nextMark == null) delete next[day]
        else next[day] = nextMark
        return { ...e, days: next }
      }),
    }))
  }

  const toggleDetail = (index) => {
    setOpenDetail((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const handleSaveExtracted = async () => {
    if (!extracted || !supabase) return
    const toSave = extracted.employees.filter((e) => e.name.trim())
    if (toSave.length === 0) {
      setUploadError('저장할 직원이 없습니다.')
      return
    }
    setSavingExtracted(true)
    setUploadError('')
    const payload = toSave.map((e) => ({
      store_code: store.code,
      employee_name: e.name.trim(),
      year: extracted.year,
      month: extracted.month,
      // 이미 저장된 근무와 합친다: 새 날짜는 더하고, 다른 날짜는 고른 기준(기존 유지/사진 기준)으로.
      days: mergeScheduleDays(extracted.existingByName[e.name.trim()], e.days, extracted.policy).merged,
    }))
    const { error: err } = await supabase.from('staff_schedules').upsert(payload, { onConflict: 'store_code,employee_name,year,month' })
    if (!err) {
      // 사진에서 읽은 직원을 직원 명부에도 넣어 [오늘 근무 체크]에 나오게 한다(이미 있으면 그대로).
      await supabase
        .from('staff_members')
        .upsert(
          payload.map((p) => ({ store_code: p.store_code, name: p.employee_name })),
          { onConflict: 'store_code,name', ignoreDuplicates: true },
        )
    }
    setSavingExtracted(false)
    if (err) {
      setUploadError(/마감한 달/.test(err.message ?? '') ? '마감한 달이라 메인 관리자만 저장할 수 있어요.' : err.message)
      return
    }
    setUploadMessage(`${toSave.length}명 저장했습니다.`)
    setExtracted(null)
    setPendingImage(null)
    setPreviewUrl('')
  }

  // ---- 월별 조회·인쇄 ----
  const [browseMonth, setBrowseMonth] = useState(thisMonthKey())
  const [browseRows, setBrowseRows] = useState([])
  const [browseLoading, setBrowseLoading] = useState(false)
  const [browseLoaded, setBrowseLoaded] = useState(false)
  const [browseError, setBrowseError] = useState('')
  const [browseMessage, setBrowseMessage] = useState('')
  const [browseOpenDetail, setBrowseOpenDetail] = useState(new Set())
  const [browseSaving, setBrowseSaving] = useState(false)
  const [browseClosed, setBrowseClosed] = useState(false)
  const [browseOrder, setBrowseOrder] = useState([])
  const [closing, setClosing] = useState(false)
  const [exporting, setExporting] = useState(false)
  // 매니저는 이번 달만 고칠 수 있다(지난달·마감한 달은 메인 관리자). 마감은 DB에서도 막는다.
  const browseEditable = isAdmin || (browseMonth === thisMonthKey() && !browseClosed)
  const [printData, setPrintData] = useState(null)
  const [pendingPrint, setPendingPrint] = useState(false)

  const handleLoadBrowse = async () => {
    if (!supabase) return
    const [yearStr, monthStr] = browseMonth.split('-')
    setBrowseLoading(true)
    setBrowseError('')
    setBrowseMessage('')
    const [{ data, error: err }, closesRes, membersRes] = await Promise.all([
      supabase
        .from('staff_schedules')
        .select('id, employee_name, days')
        .eq('store_code', store.code)
        .eq('year', Number(yearStr))
        .eq('month', Number(monthStr))
        .order('employee_name'),
      supabase.from('staff_month_closes').select('year').eq('store_code', store.code).eq('year', Number(yearStr)).eq('month', Number(monthStr)),
      supabase.from('staff_members').select('name, sort_order').eq('store_code', store.code).order('sort_order').order('name'),
    ])
    setBrowseLoading(false)
    if (err) {
      setBrowseError(err.message)
      return
    }
    const order = (membersRes.data ?? []).map((m) => m.name)
    const rank = new Map(order.map((n, i) => [n, i]))
    setBrowseOrder(order)
    setBrowseClosed(!closesRes.error && (closesRes.data ?? []).length > 0)
    // 직원 명부 순서대로(명부에 없는 이름은 뒤에 가나다순)
    setBrowseRows(
      (data ?? [])
        .map((r) => ({ ...r, days: r.days ?? {} }))
        .sort((a, b) => (rank.get(a.employee_name) ?? 9999) - (rank.get(b.employee_name) ?? 9999) || a.employee_name.localeCompare(b.employee_name)),
    )
    setBrowseLoaded(true)
    setBrowseOpenDetail(new Set())
  }

  const updateBrowseName = (index, name) => {
    setBrowseRows((prev) => prev.map((r, i) => (i === index ? { ...r, employee_name: name } : r)))
  }

  const cycleBrowseDay = (index, day) => {
    if (!browseEditable) return
    setBrowseRows((prev) =>
      prev.map((r, i) => {
        if (i !== index) return r
        const next = { ...r.days }
        const nextMark = cycleMark(next[day])
        if (nextMark == null) delete next[day]
        else next[day] = nextMark
        return { ...r, days: next }
      }),
    )
  }

  const toggleBrowseDetail = (index) => {
    setBrowseOpenDetail((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const handleSaveBrowse = async () => {
    if (!supabase) return
    setBrowseSaving(true)
    setBrowseError('')
    setBrowseMessage('')
    for (const row of browseRows) {
      // eslint-disable-next-line no-await-in-loop
      const { error: err } = await supabase
        .from('staff_schedules')
        .update({ employee_name: row.employee_name.trim(), days: row.days })
        .eq('id', row.id)
      if (err) {
        setBrowseSaving(false)
        setBrowseError(err.message)
        return
      }
    }
    setBrowseSaving(false)
    setBrowseMessage('수정한 내용을 저장했습니다.')
  }

  // 월 마감(메인 관리자만): 마감하면 매니저는 그 달 근무표·오늘 근무 체크를 고칠 수 없다(DB에서도 막는다).
  const handleToggleClose = async () => {
    if (!supabase || !isAdmin) return
    const [yearStr, monthStr] = browseMonth.split('-')
    const label = `${Number(yearStr)}년 ${Number(monthStr)}월`
    const ok = browseClosed
      ? window.confirm(`${label} 마감을 해제할까요?\n매니저가 다시 근무를 고칠 수 있게 돼요.`)
      : window.confirm(`${label}을(를) 마감할까요?\n마감하면 매니저는 이 달 근무를 고칠 수 없어요. (메인 관리자는 고칠 수 있고, 마감 해제도 가능해요)`)
    if (!ok) return
    setClosing(true)
    setBrowseError('')
    const q = browseClosed
      ? supabase.from('staff_month_closes').delete().eq('store_code', store.code).eq('year', Number(yearStr)).eq('month', Number(monthStr))
      : supabase.from('staff_month_closes').insert({ store_code: store.code, year: Number(yearStr), month: Number(monthStr) })
    const { error: err } = await q
    setClosing(false)
    if (err) {
      setBrowseError(err.message)
      return
    }
    setBrowseClosed(!browseClosed)
    setBrowseMessage(browseClosed ? `${label} 마감을 해제했어요.` : `${label}을(를) 마감했어요. 엑셀 저장·인쇄로 보관하세요.`)
  }

  // 엑셀 저장: 1번 시트 근무표(직원 × 날짜 + 합계), 2번 시트 그 달 파출 근무
  const handleExportXlsx = async () => {
    if (browseRows.length === 0) return
    const [yearStr, monthStr] = browseMonth.split('-')
    const year = Number(yearStr)
    const month = Number(monthStr)
    const start = `${yearStr}-${monthStr}-01`
    const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${pad2(month + 1)}-01`
    setExporting(true)
    setBrowseError('')
    let shifts = []
    let workers = []
    try {
      ;[shifts, workers] = await Promise.all([fetchShifts({ storeCodes: store.code, start, end: nextMonth }), fetchWorkers(store.code)])
    } catch (e) {
      setBrowseError(`파출 기록을 불러오지 못해 근무표만 저장해요. (${e.message})`)
    }
    const sheets = buildStaffMonthSheets({ storeName: store.name, year, month, rows: browseRows, order: browseOrder, shifts, workers })
    downloadXlsx(`직원근무표_${store.name}_${year}-${monthStr}.xlsx`, sheets)
    setExporting(false)
  }

  const handlePrint = () => {
    if (browseRows.length === 0) return
    const [yearStr, monthStr] = browseMonth.split('-')
    setPrintData({ year: Number(yearStr), month: Number(monthStr), rows: browseRows })
    setPendingPrint(true)
  }

  useEffect(() => {
    if (pendingPrint && printData) {
      window.print()
      setPendingPrint(false)
    }
  }, [pendingPrint, printData])

  // ---- 직원별 조회 ----
  const [employeeQuery, setEmployeeQuery] = useState('')
  const [employeeNames, setEmployeeNames] = useState([])
  const [selectedEmployee, setSelectedEmployee] = useState('')
  const [empPreset, setEmpPreset] = useState('thisYear')
  const [empFromMonth, setEmpFromMonth] = useState(thisYearRange().from)
  const [empToMonth, setEmpToMonth] = useState(thisYearRange().to)
  const [empRows, setEmpRows] = useState([])
  const [empLoading, setEmpLoading] = useState(false)
  const [empError, setEmpError] = useState('')

  useEffect(() => {
    if (!store || !supabase || section !== 'employee') return
    supabase
      .from('staff_schedules')
      .select('employee_name')
      .eq('store_code', store.code)
      .then(({ data, error: err }) => {
        if (err) return
        setEmployeeNames([...new Set((data ?? []).map((r) => r.employee_name))].sort())
      })
  }, [store, section])

  const filteredNames = useMemo(() => {
    const q = employeeQuery.trim()
    if (!q) return employeeNames
    return employeeNames.filter((n) => n.includes(q))
  }, [employeeNames, employeeQuery])

  const handleSelectEmployee = async (name) => {
    setSelectedEmployee(name)
    setEmpError('')
    setEmpLoading(true)
    const { data, error: err } = await supabase
      .from('staff_schedules')
      .select('year, month, days')
      .eq('store_code', store.code)
      .eq('employee_name', name)
    setEmpLoading(false)
    if (err) {
      setEmpError(err.message)
      return
    }
    setEmpRows((data ?? []).map((r) => ({ ...r, days: r.days ?? {} })))
  }

  const applyEmpPreset = (key) => {
    setEmpPreset(key)
    if (key === 'lastMonth') {
      const m = lastMonthKey()
      setEmpFromMonth(m)
      setEmpToMonth(m)
    } else if (key === 'thisYear') {
      const { from, to } = thisYearRange()
      setEmpFromMonth(from)
      setEmpToMonth(to)
    }
  }

  const filteredEmpRows = useMemo(() => {
    return empRows
      .filter((r) => monthKeyOf(r) >= empFromMonth && monthKeyOf(r) <= empToMonth)
      .sort((a, b) => (monthKeyOf(a) < monthKeyOf(b) ? 1 : -1))
  }, [empRows, empFromMonth, empToMonth])

  const empTotals = useMemo(() => {
    return filteredEmpRows.reduce(
      (acc, r) => {
        const c = countMarks(r.days)
        return { full: acc.full + c.full, half: acc.half + c.half, off: acc.off + c.off, total: acc.total + c.total }
      },
      { full: 0, half: 0, off: 0, total: 0 },
    )
  }, [filteredEmpRows])

  if (!store) return null

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/menu')}>
          ← 메인 메뉴
        </button>
        <h1>직원근무표</h1>
        <p className="subtitle">{store.name} · 매일 근무한 직원·파출을 기록하고, 월 근무표로 모아 봐요</p>
      </div>

      {!supabase && <p className="hint">Supabase가 설정되지 않았습니다.</p>}

      <div className="preset-row">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            className={section === s.key ? 'chip chip-active' : 'chip'}
            onClick={() => setSection(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {section === 'daily' && <DailyCheck store={store} isAdmin={isAdmin} onGoRoster={() => setSection('roster')} />}

      {section === 'roster' && <StaffRoster store={store} />}

      {section === 'upload' && (
        <>
          <h2 className="section-title">근무표 올리기</h2>
          <p className="hint">근무표를 사진으로 찍거나 캡처해서 올리면 자동으로 읽어드려요.</p>
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

          {previewUrl && <img className="photo-preview" src={previewUrl} alt="업로드한 근무표 미리보기" />}

          {pendingImage && !extracted && (
            <button type="button" className="btn-primary" onClick={handleAnalyze} disabled={analyzing}>
              {analyzing ? '분석 중...' : '분석하기'}
            </button>
          )}

          {uploadError && <p className="error-text">{uploadError}</p>}
          {uploadMessage && <p className="success-text">{uploadMessage}</p>}

          {extracted && (
            <>
              <h2 className="section-title">
                읽은 내용 확인 — {extracted.year}년 {extracted.month}월
              </h2>
              <p className="hint">
                이름이나 표시가 잘못 읽혔으면 고치고, 확인되면 저장하세요. 날짜 칸을 누르면 O→△→연→X 순서로 바뀌어요.
                이미 입력해 둔 근무가 있으면 합쳐서 저장해요(새 날짜는 더하고, 같은 표시는 그대로).
              </p>
              {(() => {
                const totalConflicts = extracted.employees.reduce(
                  (sum, e) => sum + mergeScheduleDays(extracted.existingByName[e.name.trim()], e.days).conflicts.length,
                  0,
                )
                if (totalConflicts === 0) return null
                return (
                  <div className="panel staff-merge-policy">
                    <p className="price-alert-title">⚠️ 이미 입력한 근무와 다른 날이 {totalConflicts}칸 있어요</p>
                    <p className="hint">아래 직원별로 다른 날짜를 확인하고, 어느 쪽으로 저장할지 고르세요.</p>
                    <div className="toolbar-chips">
                      <button
                        type="button"
                        className={`chip${extracted.policy === 'keep' ? ' chip-active' : ''}`}
                        onClick={() => setMergePolicy('keep')}
                      >
                        기존 입력 유지
                      </button>
                      <button
                        type="button"
                        className={`chip${extracted.policy === 'photo' ? ' chip-active' : ''}`}
                        onClick={() => setMergePolicy('photo')}
                      >
                        사진 기준으로 바꾸기
                      </button>
                    </div>
                  </div>
                )
              })()}

              {extracted.employees.map((emp, i) => (
                <div className="cost-summary" key={i} style={{ textAlign: 'left' }}>
                  <div className="field" style={{ marginBottom: 8 }}>
                    <input
                      className="input"
                      value={emp.name}
                      onChange={(e) => updateExtractedName(i, e.target.value)}
                      placeholder="직원명"
                    />
                  </div>
                  <CountsLine counts={countMarks(emp.days)} />
                  {(() => {
                    const prev = extracted.existingByName[emp.name.trim()]
                    if (!prev) return <p className="hint">새로 저장되는 직원이에요.</p>
                    const { conflicts, added } = mergeScheduleDays(prev, emp.days)
                    return (
                      <div className="staff-merge-info">
                        <p className="hint">
                          이미 저장된 직원이에요 · 새로 더해지는 날 {added}일{conflicts.length > 0 ? ` · 다른 날 ${conflicts.length}일` : ''}
                        </p>
                        {conflicts.length > 0 && (
                          <p className="cost-warning staff-conflicts">
                            {conflicts.map((c) => `${c.day}일 기존 ${c.existing} → 사진 ${c.photo}`).join(' · ')}
                          </p>
                        )}
                      </div>
                    )
                  })()}
                  <button type="button" className="link-btn" style={{ marginTop: 8 }} onClick={() => toggleDetail(i)}>
                    {openDetail.has(i) ? '자세히 닫기' : '자세히보기'}
                  </button>
                  {openDetail.has(i) && (
                    <DayGrid
                      year={extracted.year}
                      month={extracted.month}
                      days={emp.days}
                      onCycle={(day) => cycleExtractedDay(i, day)}
                    />
                  )}
                </div>
              ))}

              <button type="button" className="btn-primary" onClick={handleSaveExtracted} disabled={savingExtracted}>
                {savingExtracted ? '저장 중...' : '저장하기'}
              </button>
            </>
          )}
        </>
      )}

      {section === 'browse' && (
        <>
          <h2 className="section-title">
            월 근무표 {browseLoaded && browseClosed && <span className="status-tag status-tag-danger">마감</span>}
          </h2>
          <div className="date-range">
            <input
              type="month"
              className="input"
              value={browseMonth}
              onChange={(e) => {
                setBrowseMonth(e.target.value)
                setBrowseLoaded(false)
              }}
              aria-label="조회할 달"
            />
            <button
              type="button"
              className="btn-secondary"
              style={{ marginTop: 0, width: 'auto', padding: '8px 14px' }}
              onClick={handleLoadBrowse}
              disabled={browseLoading}
            >
              {browseLoading ? '불러오는 중...' : '불러오기'}
            </button>
          </div>

          {browseError && <p className="error-text">{browseError}</p>}
          {browseMessage && <p className="success-text">{browseMessage}</p>}

          {browseLoaded && browseRows.length === 0 && <p className="hint">이 달에 저장된 근무표가 없습니다.</p>}

          {browseLoaded && browseRows.length > 0 && (
            <>
              <p className="hint">
                {browseEditable
                  ? '"자세히보기"에서 날짜 칸을 누를 때마다 종일(O) → 반타임(△) → 연차(연) → 휴무(X) → 빈칸 순으로 바뀌어요. 고친 뒤 "수정 저장"을 누르세요.'
                  : '매니저는 이번 달 근무표만 고칠 수 있어요. 지난달은 보기만 돼요.'}
              </p>
              {browseRows.map((row, i) => {
                const [yearStr, monthStr] = browseMonth.split('-')
                return (
                  <div className="cost-summary" key={row.id} style={{ textAlign: 'left' }}>
                    <div className="field" style={{ marginBottom: 8 }}>
                      {isAdmin ? (
                        <input className="input" value={row.employee_name} onChange={(e) => updateBrowseName(i, e.target.value)} />
                      ) : (
                        <strong>{row.employee_name}</strong>
                      )}
                    </div>
                    <CountsLine counts={countMarks(row.days)} />
                    <button type="button" className="link-btn" style={{ marginTop: 8 }} onClick={() => toggleBrowseDetail(i)}>
                      {browseOpenDetail.has(i) ? '자세히 닫기' : '자세히보기'}
                    </button>
                    {browseOpenDetail.has(i) && (
                      <DayGrid
                        year={Number(yearStr)}
                        month={Number(monthStr)}
                        days={row.days}
                        onCycle={browseEditable ? (day) => cycleBrowseDay(i, day) : null}
                      />
                    )}
                  </div>
                )
              })}

              <div className="invoice-form">
                <button type="button" className="btn-secondary" onClick={handleSaveBrowse} disabled={browseSaving || !browseEditable}>
                  {browseSaving ? '저장 중...' : '수정 저장'}
                </button>
                <button type="button" className="btn-primary" onClick={handleExportXlsx} disabled={exporting}>
                  {exporting ? '만드는 중...' : '📊 엑셀 저장 (근무표 + 파출)'}
                </button>
                <button type="button" className="btn-secondary" onClick={handlePrint}>
                  🖨 인쇄하기 (A4 가로)
                </button>
                {isAdmin && (
                  <button type="button" className="btn-secondary" onClick={handleToggleClose} disabled={closing}>
                    {closing ? '처리 중...' : browseClosed ? '🔓 이 달 마감 해제' : '🔒 이 달 마감'}
                  </button>
                )}
              </div>
            </>
          )}
        </>
      )}

      {section === 'employee' && (
        <>
          <h2 className="section-title">직원별 조회</h2>
          <div className="field">
            <input
              className="input"
              placeholder="직원 이름 검색"
              value={employeeQuery}
              onChange={(e) => setEmployeeQuery(e.target.value)}
            />
          </div>
          <div className="match-suggestions">
            {filteredNames.map((name) => (
              <button
                key={name}
                type="button"
                className={selectedEmployee === name ? 'chip chip-active' : 'chip'}
                onClick={() => handleSelectEmployee(name)}
              >
                {name}
              </button>
            ))}
          </div>
          {filteredNames.length === 0 && <p className="hint">저장된 직원이 없습니다.</p>}

          {selectedEmployee && (
            <>
              <h3 className="settlement-month-title" style={{ marginTop: 16 }}>
                {selectedEmployee}
              </h3>

              <div className="preset-row">
                {PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    className={empPreset === p.key ? 'chip chip-active' : 'chip'}
                    onClick={() => applyEmpPreset(p.key)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="date-range">
                <input
                  type="month"
                  className="input"
                  value={empFromMonth}
                  onChange={(e) => {
                    setEmpFromMonth(e.target.value)
                    setEmpPreset('custom')
                  }}
                  aria-label="시작월"
                />
                <span className="date-range-sep">~</span>
                <input
                  type="month"
                  className="input"
                  value={empToMonth}
                  onChange={(e) => {
                    setEmpToMonth(e.target.value)
                    setEmpPreset('custom')
                  }}
                  aria-label="종료월"
                />
              </div>

              {empLoading && <p className="hint">불러오는 중...</p>}
              {empError && <p className="error-text">{empError}</p>}

              {!empLoading && filteredEmpRows.length === 0 && <p className="hint">이 기간에 저장된 근무표가 없습니다.</p>}

              {!empLoading && filteredEmpRows.length > 0 && (
                <>
                  <div className="cost-summary settlement-total">
                    <h2 className="settlement-month-title">선택 기간 합계 ({filteredEmpRows.length}개월)</h2>
                    <CountsLine counts={empTotals} />
                  </div>

                  {filteredEmpRows.map((row) => (
                    <div className="cost-summary" key={monthKeyOf(row)}>
                      <h2 className="settlement-month-title">
                        {row.year}년 {row.month}월
                      </h2>
                      <CountsLine counts={countMarks(row.days)} />
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </>
      )}

      {printData && (
        <div className="print-schedule">
          <h2 className="print-title">
            {printData.year}년 {printData.month}월 근무표
          </h2>
          <p className="print-store-name">
            {store.name} · O=종일 △=반타임 연=연차 X=휴무 · 총 근무일 = 종일 + 반타임
          </p>
          <table className="print-table">
            <thead>
              <tr>
                <th>직원명</th>
                {Array.from({ length: daysInMonth(printData.year, printData.month) }, (_, i) => i + 1).map((day) => (
                  <th key={day}>{day}</th>
                ))}
                <th>O(종일근무)</th>
                <th>△(반타임)</th>
                <th>연(연차)</th>
                <th>X(휴무)</th>
                <th>총 근무일</th>
              </tr>
              <tr>
                <th>요일</th>
                {Array.from({ length: daysInMonth(printData.year, printData.month) }, (_, i) => i + 1).map((day) => (
                  <th key={day}>{['일', '월', '화', '수', '목', '금', '토'][new Date(printData.year, printData.month - 1, day).getDay()]}</th>
                ))}
                <th colSpan={5} />
              </tr>
            </thead>
            <tbody>
              {printData.rows.map((row) => {
                const counts = countMarks(row.days)
                return (
                  <tr key={row.id}>
                    <td>{row.employee_name}</td>
                    {Array.from({ length: daysInMonth(printData.year, printData.month) }, (_, i) => i + 1).map((day) => (
                      <td key={day}>{row.days[day] ?? ''}</td>
                    ))}
                    <td>{counts.full}</td>
                    <td>{counts.half}</td>
                    <td>{counts.leave}</td>
                    <td>{counts.off}</td>
                    <td>{counts.total}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
