import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { compressImage } from '../lib/compressImage'
import { cycleMark, daysInMonth, countMarks, MARK_LABELS } from '../lib/staffSchedule'

function pad2(n) {
  return String(n).padStart(2, '0')
}

function monthKeyOf(row) {
  return `${row.year}-${pad2(row.month)}`
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
  { key: 'upload', label: '자료 올리기' },
  { key: 'browse', label: '월별 조회·인쇄' },
  { key: 'employee', label: '직원별 조회' },
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
          {MARK_LABELS.O} {counts.full}일 · {MARK_LABELS['△']} {counts.half}일 · {MARK_LABELS.X} {counts.off}일
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
          const markClass = mark === 'O' ? 'day-cell-full' : mark === '△' ? 'day-cell-half' : mark === 'X' ? 'day-cell-off' : ''
          return (
            <button key={day} type="button" className={`day-cell ${markClass}`} onClick={() => onCycle(day)}>
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
  const { store } = useStore()
  const navigate = useNavigate()
  const [section, setSection] = useState('upload')

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
      const res = await fetch('/api/analyze-staff-schedule', {
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
        .select('employee_name')
        .eq('store_code', store.code)
        .eq('year', year)
        .eq('month', month)
      if (existErr) throw existErr
      const existingNames = new Set((existing ?? []).map((r) => r.employee_name))

      const employees = (data.employees ?? []).map((e) => ({
        name: e.name,
        days: Object.fromEntries((e.entries ?? []).map((en) => [String(en.day), en.mark])),
        isDuplicate: existingNames.has(e.name),
        overwrite: false,
      }))

      if (employees.length === 0) {
        setUploadError('사진에서 인식된 직원이 없습니다. 더 선명한 사진으로 다시 시도해주세요.')
        return
      }
      setExtracted({ year, month, employees })
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

  const toggleExtractedOverwrite = (index) => {
    setExtracted((prev) => ({
      ...prev,
      employees: prev.employees.map((e, i) => (i === index ? { ...e, overwrite: !e.overwrite } : e)),
    }))
  }

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
    const toSave = extracted.employees.filter((e) => e.name.trim() && (!e.isDuplicate || e.overwrite))
    if (toSave.length === 0) {
      setUploadError('저장할 직원이 없습니다. 겹치는 직원은 덮어쓰기를 체크해주세요.')
      return
    }
    setSavingExtracted(true)
    setUploadError('')
    const payload = toSave.map((e) => ({
      store_code: store.code,
      employee_name: e.name.trim(),
      year: extracted.year,
      month: extracted.month,
      days: e.days,
    }))
    const { error: err } = await supabase.from('staff_schedules').upsert(payload, { onConflict: 'store_code,employee_name,year,month' })
    setSavingExtracted(false)
    if (err) {
      setUploadError(err.message)
      return
    }
    setUploadMessage(`${toSave.length}명 저장했습니다.`)
    setExtracted(null)
    setPendingImage(null)
    setPreviewUrl('')
  }

  // ---- 월별 조회·인쇄 ----
  const [browseMonth, setBrowseMonth] = useState(lastMonthKey())
  const [browseRows, setBrowseRows] = useState([])
  const [browseLoading, setBrowseLoading] = useState(false)
  const [browseLoaded, setBrowseLoaded] = useState(false)
  const [browseError, setBrowseError] = useState('')
  const [browseMessage, setBrowseMessage] = useState('')
  const [browseOpenDetail, setBrowseOpenDetail] = useState(new Set())
  const [browseSaving, setBrowseSaving] = useState(false)
  const [printData, setPrintData] = useState(null)
  const [pendingPrint, setPendingPrint] = useState(false)

  const handleLoadBrowse = async () => {
    if (!supabase) return
    const [yearStr, monthStr] = browseMonth.split('-')
    setBrowseLoading(true)
    setBrowseError('')
    setBrowseMessage('')
    const { data, error: err } = await supabase
      .from('staff_schedules')
      .select('id, employee_name, days')
      .eq('store_code', store.code)
      .eq('year', Number(yearStr))
      .eq('month', Number(monthStr))
      .order('employee_name')
    setBrowseLoading(false)
    if (err) {
      setBrowseError(err.message)
      return
    }
    setBrowseRows((data ?? []).map((r) => ({ ...r, days: r.days ?? {} })))
    setBrowseLoaded(true)
    setBrowseOpenDetail(new Set())
  }

  const updateBrowseName = (index, name) => {
    setBrowseRows((prev) => prev.map((r, i) => (i === index ? { ...r, employee_name: name } : r)))
  }

  const cycleBrowseDay = (index, day) => {
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
        <h1>직원 근무표</h1>
        <p className="subtitle">
          {store.name} · 근무표 사진을 올리면 {MARK_LABELS.O} / {MARK_LABELS['△']} / {MARK_LABELS.X}를 자동으로 읽어드려요
        </p>
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
                이름이나 표시가 잘못 읽혔으면 고치고, 확인되면 저장하세요. 날짜 칸을 누르면 O→△→X 순서로 바뀌어요.
              </p>

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
                  {emp.isDuplicate && (
                    <label className="toggle-row" style={{ padding: '8px 0' }}>
                      <input type="checkbox" checked={emp.overwrite} onChange={() => toggleExtractedOverwrite(i)} />
                      <span>이미 저장된 직원이에요 — 덮어쓸게요</span>
                    </label>
                  )}
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
          <h2 className="section-title">월별 조회·인쇄</h2>
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
              <p className="hint">이름이나 표시가 잘못됐으면 고친 뒤 "수정 저장"을 누르세요.</p>
              {browseRows.map((row, i) => {
                const [yearStr, monthStr] = browseMonth.split('-')
                return (
                  <div className="cost-summary" key={row.id} style={{ textAlign: 'left' }}>
                    <div className="field" style={{ marginBottom: 8 }}>
                      <input className="input" value={row.employee_name} onChange={(e) => updateBrowseName(i, e.target.value)} />
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
                        onCycle={(day) => cycleBrowseDay(i, day)}
                      />
                    )}
                  </div>
                )
              })}

              <div className="invoice-form">
                <button type="button" className="btn-secondary" onClick={handleSaveBrowse} disabled={browseSaving}>
                  {browseSaving ? '저장 중...' : '수정 저장'}
                </button>
                <button type="button" className="btn-primary" onClick={handlePrint}>
                  인쇄하기
                </button>
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
          <p className="print-store-name">{store.name}</p>
          <table className="print-table">
            <thead>
              <tr>
                <th>직원명</th>
                {Array.from({ length: daysInMonth(printData.year, printData.month) }, (_, i) => i + 1).map((day) => (
                  <th key={day}>{day}</th>
                ))}
                <th>O(종일근무)</th>
                <th>△(반타임)</th>
                <th>X(휴무)</th>
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
                    <td>{counts.off}</td>
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
