import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { useHistoryState } from '../hooks/usePageHistoryState'
import { fetchShifts, fetchWorkers } from '../lib/dispatchApi'
import {
  INSURANCE_DAY_LIMIT,
  monthRange,
  shiftMonthKey,
  showMaskedRrn,
  summarizeByWorker,
  timeRangeLabel,
  won,
  wonPlain,
} from '../lib/dispatch'
import { currentMonth, todayStr } from '../lib/vendorLedger'

const TABS = [
  { key: 'daily', label: '날짜별' },
  { key: 'fixed', label: '📌 고정 파출' },
  { key: 'workers', label: '인력 명부' },
]

const dayLabel = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`

// 파출 관리: 매니저·메인 관리자 모두 보고 입력한다. 송금 상태는 둘 다 보이지만 바꾸는 건 관리자(송금 관리 화면)만.
export default function DispatchScreen() {
  const { store, isAdmin } = useStore()
  const navigate = useNavigate()
  const [tab, setTab] = useHistoryState('dispatchTab', 'daily')
  const [month, setMonth] = useHistoryState('dispatchMonth', () => currentMonth())
  const [workers, setWorkers] = useState([])
  const [shifts, setShifts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [busyWorker, setBusyWorker] = useState(null)

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    setLoading(true)
    const { start, end } = monthRange(month)
    Promise.all([fetchWorkers(store.code), fetchShifts({ storeCodes: store.code, start, end })])
      .then(([w, s]) => {
        if (cancelled) return
        setWorkers(w)
        setShifts(s)
        setError('')
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [store, month, reloadKey])

  const workerById = useMemo(() => new Map(workers.map((w) => [w.id, w])), [workers])
  const summary = useMemo(() => summarizeByWorker(shifts), [shifts])
  const monthTotal = shifts.reduce((sum, s) => sum + Number(s.wage || 0), 0)
  const fixedWorkers = workers.filter((w) => w.is_fixed)
  const [y, m] = month.split('-')

  // 고정 파출 [오늘 출근 +]: 평소 근무시간·일당으로 바로 등록 (평소 값이 없으면 등록 화면으로)
  const addToday = async (worker) => {
    setMessage('')
    setError('')
    if (!worker.default_wage) {
      navigate(`/dispatch/new?worker=${worker.id}`)
      return
    }
    const today = todayStr()
    if (shifts.some((s) => s.worker_id === worker.id && s.work_date === today)) {
      setError(`${worker.name}님은 오늘 이미 등록돼 있어요.`)
      return
    }
    setBusyWorker(worker.id)
    const { error: err } = await supabase.from('dispatch_shifts').insert({
      store_code: store.code,
      worker_id: worker.id,
      work_date: today,
      start_time: worker.default_start,
      end_time: worker.default_end,
      wage: worker.default_wage,
      bank: worker.bank,
      account: worker.account,
    })
    setBusyWorker(null)
    if (err) {
      setError(err.message)
      return
    }
    setMessage(`${worker.name}님 오늘 출근을 등록했어요 (${timeRangeLabel(worker.default_start, worker.default_end)} · ${won(worker.default_wage)}).`)
    if (month !== today.slice(0, 7)) setMonth(today.slice(0, 7))
    else setReloadKey((k) => k + 1)
  }

  return (
    <div className="screen screen-wide dispatch-screen">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/menu')}>
          ← 메인 메뉴
        </button>
        <h1>👷 파출 관리</h1>
        <p className="subtitle">{store.name} · 근무를 등록하면 메인 관리자가 확인하고 송금해요</p>
      </div>

      <div className="month-nav">
        <button type="button" className="chip" onClick={() => setMonth(shiftMonthKey(month, -1))} aria-label="이전 달">
          ◀
        </button>
        <strong>
          {y}년 {Number(m)}월
        </strong>
        <button type="button" className="chip" onClick={() => setMonth(shiftMonthKey(month, 1))} aria-label="다음 달">
          ▶
        </button>
      </div>

      <div className="preset-row">
        {TABS.map((t) => (
          <button key={t.key} type="button" className={tab === t.key ? 'chip chip-active' : 'chip'} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      <button type="button" className="btn-primary" onClick={() => navigate('/dispatch/new')}>
        + 근무 등록
      </button>
      {isAdmin && (
        <button type="button" className="btn-secondary" onClick={() => navigate('/dispatch-payments')}>
          💸 송금 관리로 가기
        </button>
      )}

      {loading && <p className="hint">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}
      {message && <p className="success-text">{message}</p>}

      {!loading && tab === 'daily' && (
        <>
          {shifts.length === 0 ? (
            <p className="hint">이 달에 등록된 근무가 없어요.</p>
          ) : (
            <div className="ledger-table-wrap">
              <table className="dispatch-table">
                <thead>
                  <tr>
                    <th>날짜</th>
                    <th>이름</th>
                    <th>시간</th>
                    <th className="num">일당</th>
                    <th className="num">송금</th>
                  </tr>
                </thead>
                <tbody>
                  {shifts.map((s) => (
                    <tr key={s.id} className="clickable" onClick={() => navigate(`/dispatch/edit/${s.id}`)}>
                      <td>{dayLabel(s.work_date)}</td>
                      <td>
                        {workerById.get(s.worker_id)?.name ?? '-'}
                        {s.paid_date && !isAdmin && ' 🔒'}
                      </td>
                      <td>{timeRangeLabel(s.start_time, s.end_time)}</td>
                      <td className="num">{wonPlain(s.wage)}</td>
                      <td className={`num ${s.paid_date ? 'paid-text' : 'pending-text'}`}>
                        {s.paid_date ? `완료 ${dayLabel(s.paid_date)}` : '대기'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="cost-summary">
            <div className="cost-summary-row">
              <span>{Number(m)}월 합계</span>
              <strong>
                {shifts.length}건 · {won(monthTotal)}
              </strong>
            </div>
            {!isAdmin && <p className="hint">🔒 송금완료된 근무는 메인 관리자만 고칠 수 있어요.</p>}
          </div>
        </>
      )}

      {!loading && tab === 'fixed' && (
        <div className="dispatch-cards">
          {fixedWorkers.length === 0 && (
            <p className="hint">고정 파출로 표시된 분이 없어요. [인력 명부]에서 이름을 누르고 '고정 파출'을 켜주세요.</p>
          )}
          {fixedWorkers.map((w) => {
            const r = summary.get(w.id)
            return (
              <div key={w.id} className="cost-summary dispatch-card">
                <div className="cost-summary-row">
                  <strong className="dispatch-card-name">{w.name}</strong>
                  {r && r.days >= INSURANCE_DAY_LIMIT && <span className="tag-warn">{INSURANCE_DAY_LIMIT}일 이상</span>}
                </div>
                <p className="hint">
                  평소 {w.default_wage ? `${timeRangeLabel(w.default_start, w.default_end)} · ${won(w.default_wage)}` : '근무시간·일당 미설정'}
                </p>
                <div className="cost-summary-row">
                  <span>{Number(m)}월 근무</span>
                  <strong>{r ? `${r.days}일 · ${won(r.total)}` : '0일'}</strong>
                </div>
                {r && (
                  <>
                    <div className="cost-summary-row">
                      <span>송금 완료 / 대기</span>
                      <span>
                        <span className="paid-text">{won(r.paid)}</span> / <span className="pending-text">{won(r.unpaid)}</span>
                      </span>
                    </div>
                    <p className="dispatch-days">{[...r.dates].sort().map((d) => Number(d.slice(8, 10))).join(' ')}</p>
                  </>
                )}
                <div className="dispatch-card-actions">
                  <button type="button" className="btn-primary" disabled={busyWorker === w.id} onClick={() => addToday(w)}>
                    {busyWorker === w.id ? '등록 중...' : '오늘 출근 +'}
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => navigate(`/dispatch/workers/${w.id}?month=${month}`)}>
                    상세 보기
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!loading && tab === 'workers' && (
        <div className="dispatch-cards">
          {workers.length === 0 && <p className="hint">등록된 인력이 없어요. [+ 근무 등록]에서 처음 오신 분을 등록하면 명부에 저장돼요.</p>}
          {workers.map((w) => {
            const r = summary.get(w.id)
            return (
              <button
                type="button"
                key={w.id}
                className="cost-summary dispatch-card dispatch-worker-row"
                onClick={() => navigate(`/dispatch/workers/${w.id}?month=${month}`)}
              >
                <div className="cost-summary-row">
                  <strong>
                    {w.name} {w.is_fixed && <span className="tag">고정</span>}
                  </strong>
                  <span>{r ? `${Number(m)}월 ${r.days}일` : ''}</span>
                </div>
                <p className="hint">
                  {showMaskedRrn(w.rrn_masked)} · {[w.bank, w.account].filter(Boolean).join(' ') || '계좌 없음'}
                </p>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
