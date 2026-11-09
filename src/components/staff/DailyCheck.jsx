import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { todayStr } from '../../lib/vendorLedger'
import { fetchShifts, fetchWorkers } from '../../lib/dispatchApi'
import {
  DAILY_CHOICES,
  WEEKDAY_LABELS,
  buildDayUpsert,
  canEditDate,
  countSelections,
  dateLabel,
  initialSelections,
  monthRangeOf,
  parseDate,
  shiftDate,
} from '../../lib/staffDaily'

function won(n) {
  return `${Number(n || 0).toLocaleString()}원`
}

function hhmm(t) {
  return t ? String(t).slice(0, 5) : ''
}

// 직원근무표 [오늘 근무 체크]: 재직 직원 전체가 보이고, 근무한 사람만 종일/반타임/연차를 고른다.
// 고르지 않은 사람은 저장할 때 휴무(X)로 확정된다. 같은 화면에서 그날 파출 근무도 확인·등록한다.
export default function DailyCheck({ store, isAdmin, onGoRoster }) {
  const navigate = useNavigate()
  const today = todayStr()
  const [date, setDate] = useState(today)
  const monthKey = date.slice(0, 7)

  const [members, setMembers] = useState([])
  const [monthRows, setMonthRows] = useState([])
  const [savedAtByDate, setSavedAtByDate] = useState(new Map())
  const [closed, setClosed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [selections, setSelections] = useState(new Map())

  const [workers, setWorkers] = useState([])
  const [shifts, setShifts] = useState([])
  const [dispatchError, setDispatchError] = useState('')

  // 그 달의 직원 명부·근무표·저장 기록·마감 여부
  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    const { year, month } = parseDate(`${monthKey}-01`)
    const { start, end } = monthRangeOf(`${monthKey}-01`)
    setLoading(true)
    setError('')
    Promise.all([
      supabase
        .from('staff_members')
        .select('id, name, off_weekdays, active, sort_order')
        .eq('store_code', store.code)
        .eq('active', true)
        .order('sort_order')
        .order('name'),
      supabase.from('staff_schedules').select('id, employee_name, days').eq('store_code', store.code).eq('year', year).eq('month', month),
      supabase.from('staff_day_logs').select('work_date, saved_at').eq('store_code', store.code).gte('work_date', start).lte('work_date', end),
      supabase.from('staff_month_closes').select('year').eq('store_code', store.code).eq('year', year).eq('month', month),
    ]).then(([membersRes, rowsRes, logsRes, closesRes]) => {
      if (cancelled) return
      const err = membersRes.error || rowsRes.error || logsRes.error
      if (err) {
        setError(
          /staff_members|staff_day_logs|schema cache|does not exist/i.test(err.message ?? '')
            ? '직원 명부 표가 아직 없어요. Supabase에서 supabase/staff-daily.sql을 실행해 주세요.'
            : err.message,
        )
        setLoading(false)
        return
      }
      setMembers(membersRes.data ?? [])
      setMonthRows((rowsRes.data ?? []).map((r) => ({ ...r, days: r.days ?? {} })))
      setSavedAtByDate(new Map((logsRes.data ?? []).map((l) => [l.work_date, l.saved_at])))
      setClosed(!closesRes.error && (closesRes.data ?? []).length > 0)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [store.code, monthKey, reloadKey])

  const saved = savedAtByDate.has(date)

  // 날짜를 바꾸거나 다시 불러오면 그날의 처음 선택을 다시 만든다.
  useEffect(() => {
    setSelections(initialSelections({ members, monthRows, dateStr: date, saved }))
    setMessage('')
  }, [members, monthRows, date, saved])

  // 그날 파출
  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    setDispatchError('')
    Promise.all([fetchWorkers(store.code), fetchShifts({ storeCodes: store.code, start: date, end: shiftDate(date, 1) })])
      .then(([w, s]) => {
        if (cancelled) return
        setWorkers(w)
        setShifts(s)
      })
      .catch((e) => !cancelled && setDispatchError(e.message))
    return () => {
      cancelled = true
    }
  }, [store.code, date])

  const editable = canEditDate({ dateStr: date, today, isAdmin, closed })
  const counts = countSelections(members, selections)
  const workerById = new Map(workers.map((w) => [w.id, w]))
  const shiftWorkerIds = new Set(shifts.map((s) => s.worker_id))
  const fixedNotYet = workers.filter((w) => w.is_fixed && !shiftWorkerIds.has(w.id))

  const choose = (name, mark) => {
    if (!editable) return
    setSelections((prev) => new Map(prev).set(name, prev.get(name) === mark ? null : mark))
    setMessage('')
  }

  const handleSave = async () => {
    if (!supabase || !editable || members.length === 0) return
    setSaving(true)
    setError('')
    setMessage('')
    const rows = buildDayUpsert({ storeCode: store.code, members, monthRows, dateStr: date, selections })
    const { error: upErr } = await supabase.from('staff_schedules').upsert(rows, { onConflict: 'store_code,employee_name,year,month' })
    if (upErr) {
      setSaving(false)
      setError(upErr.message)
      return
    }
    const { error: logErr } = await supabase
      .from('staff_day_logs')
      .upsert({ store_code: store.code, work_date: date, saved_at: new Date().toISOString() }, { onConflict: 'store_code,work_date' })
    setSaving(false)
    if (logErr) {
      setError(logErr.message)
      return
    }
    setMessage(`${dateLabel(date)} 근무를 저장했어요.`)
    setReloadKey((k) => k + 1)
  }

  const goDate = (delta) => {
    const next = shiftDate(date, delta)
    if (next > today) return
    setDate(next)
  }

  return (
    <div className="staff-daily">
      <div className="staff-daily-nav">
        <button type="button" className="mini-btn" onClick={() => goDate(-1)} aria-label="전날">
          ◀
        </button>
        <input
          type="date"
          className="input staff-daily-date"
          value={date}
          max={today}
          onChange={(e) => e.target.value && setDate(e.target.value > today ? today : e.target.value)}
          aria-label="근무 날짜"
        />
        <button type="button" className="mini-btn" onClick={() => goDate(1)} disabled={date >= today} aria-label="다음날">
          ▶
        </button>
        {date !== today && (
          <button type="button" className="mini-btn" onClick={() => setDate(today)}>
            오늘
          </button>
        )}
      </div>
      <p className="staff-daily-title">
        {dateLabel(date)}
        {saved ? (
          <span className="status-tag status-tag-ok">저장됨</span>
        ) : (
          <span className="status-tag status-tag-warn">미기록</span>
        )}
        {closed && <span className="status-tag status-tag-danger">마감한 달</span>}
      </p>
      {!editable && (
        <p className="hint">
          {closed
            ? '마감한 달이라 메인 관리자만 고칠 수 있어요.'
            : '매니저는 이번 달 오늘까지의 근무만 입력·수정할 수 있어요. 지난달은 메인 관리자에게 요청해 주세요.'}
        </p>
      )}

      {error && <p className="error-text">{error}</p>}
      {loading && <p className="hint">불러오는 중...</p>}

      <h2 className="section-title">👤 직원</h2>
      {!loading && !error && members.length === 0 && (
        <div className="panel">
          <p className="hint">아직 등록된 직원이 없어요. 먼저 직원을 등록해 주세요.</p>
          <button type="button" className="btn-primary" onClick={onGoRoster}>
            직원 등록하러 가기
          </button>
        </div>
      )}
      {members.length > 0 && (
        <>
          <p className="hint">
            근무한 사람만 고르세요. 고르지 않은 사람은 저장할 때 <b>휴무</b>로 기록돼요.
            {!saved && ' 평소 근무하는 요일인 직원은 미리 "종일"로 골라 뒀어요.'}
          </p>
          <ul className="staff-daily-list">
            {members.map((m) => {
              const mark = selections.get(m.name) ?? null
              return (
                <li key={m.id} className="staff-daily-row">
                  <div className="staff-daily-name">
                    <span className="history-item">{m.name}</span>
                    {(m.off_weekdays ?? []).length > 0 && (
                      <span className="hint">평소 휴무 {m.off_weekdays.map((d) => WEEKDAY_LABELS[d]).join('·')}</span>
                    )}
                  </div>
                  <div className="staff-daily-choices" role="group" aria-label={`${m.name} 근무`}>
                    {DAILY_CHOICES.map((c) => (
                      <button
                        key={c.mark}
                        type="button"
                        className={`chip staff-choice${mark === c.mark ? ` chip-active staff-choice-${c.label}` : ''}`}
                        aria-pressed={mark === c.mark}
                        disabled={!editable}
                        onClick={() => choose(m.name, c.mark)}
                      >
                        {c.label}
                      </button>
                    ))}
                    {mark == null && <span className="staff-off-label">휴무</span>}
                  </div>
                </li>
              )
            })}
          </ul>
          <p className="staff-daily-count">
            종일 {counts.O} · 반타임 {counts['△']} · 연차 {counts['연']} · 휴무 {counts.X}
          </p>
          {editable && (
            <div className="staff-daily-save">
              <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? '저장 중...' : saved ? `${dateLabel(date)} 근무 다시 저장` : `${dateLabel(date)} 근무 저장`}
              </button>
              {message && <p className="hint">{message}</p>}
            </div>
          )}
        </>
      )}

      <h2 className="section-title">👷 파출</h2>
      {dispatchError && <p className="error-text">{dispatchError}</p>}
      {shifts.length === 0 && fixedNotYet.length === 0 && !dispatchError && <p className="hint">이 날 등록된 파출 근무가 없어요.</p>}
      {shifts.length > 0 && (
        <ul className="history-list">
          {shifts.map((s) => (
            <li key={s.id} className="history-row">
              <div className="history-row-main">
                <span className="history-item">✓ {workerById.get(s.worker_id)?.name ?? '파출'}</span>
                <span>{won(s.wage)}</span>
              </div>
              <div className="history-row-sub">
                {s.position && <span>{s.position}</span>}
                {(s.start_time || s.end_time) && (
                  <span>
                    {hhmm(s.start_time)}~{hhmm(s.end_time)}
                  </span>
                )}
                {s.paid_date && <span>송금 완료</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {editable && fixedNotYet.length > 0 && (
        <ul className="history-list">
          {fixedNotYet.map((w) => (
            <li key={w.id} className="history-row staff-fixed-row">
              <div className="history-row-main">
                <span className="history-item">📌 {w.name} (고정)</span>
                <button type="button" className="mini-btn" onClick={() => navigate(`/dispatch/new?worker=${w.id}&date=${date}`)}>
                  출근 등록 +
                </button>
              </div>
              <div className="history-row-sub">
                {w.default_position && <span>{w.default_position}</span>}
                {(w.default_start || w.default_end) && (
                  <span>
                    {hhmm(w.default_start)}~{hhmm(w.default_end)}
                  </span>
                )}
                {w.default_wage != null && <span>{won(w.default_wage)}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <button type="button" className="btn-secondary" onClick={() => navigate(`/dispatch/new?date=${date}`)}>
          + 다른 파출 등록
        </button>
      )}

    </div>
  )
}
