import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { useHistoryState } from '../hooks/usePageHistoryState'
import { fetchShifts, fetchWorkers } from '../lib/dispatchApi'
import PositionTag from '../components/PositionTag'
import {
  INSURANCE_DAY_LIMIT,
  monthRange,
  positionLabel,
  POSITIONS,
  shiftMonthKey,
  showMaskedRrn,
  summarizeByPosition,
  summarizeByWorker,
  timeRangeLabel,
  won,
  wonPlain,
} from '../lib/dispatch'
import { currentMonth } from '../lib/vendorLedger'

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
  const [positionFilter, setPositionFilter] = useHistoryState('dispatchPosition', 'all')

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
  }, [store, month])

  const workerById = useMemo(() => new Map(workers.map((w) => [w.id, w])), [workers])
  const summary = useMemo(() => summarizeByWorker(shifts), [shifts])
  const byPosition = useMemo(() => summarizeByPosition(shifts), [shifts])
  const visibleShifts = positionFilter === 'all' ? shifts : shifts.filter((s) => s.position === positionFilter)
  const monthTotal = visibleShifts.reduce((sum, s) => sum + Number(s.wage || 0), 0)
  const fixedWorkers = workers.filter((w) => w.is_fixed)
  const [y, m] = month.split('-')

  // 고정 파출 [오늘 출근 +]: 이름·오늘 날짜·평소 포지션만 채운 등록 화면으로 (근무시간·일당은 직접 입력)
  const addToday = (worker) => navigate(`/dispatch/new?worker=${worker.id}`)

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

      {!loading && tab === 'daily' && (
        <>
          <div className="preset-row position-filter">
            {[{ key: 'all', label: '전체', icon: '' }, ...POSITIONS].map((p) => {
              const count = p.key === 'all' ? shifts.length : byPosition[p.key].count
              return (
                <button
                  key={p.key}
                  type="button"
                  className={positionFilter === p.key ? 'chip chip-active' : 'chip'}
                  onClick={() => setPositionFilter(p.key)}
                >
                  {p.icon} {p.label} {count}
                </button>
              )
            })}
          </div>
          {visibleShifts.length === 0 ? (
            <p className="hint">이 달에 등록된 근무가 없어요.</p>
          ) : (
            <div className="ledger-table-wrap">
              <table className="dispatch-table">
                <thead>
                  <tr>
                    <th>날짜</th>
                    <th>이름</th>
                    <th>포지션</th>
                    <th>시간</th>
                    <th className="num">일당</th>
                    <th className="num">송금</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visibleShifts.map((s) => (
                    <tr key={s.id} className="clickable" onClick={() => navigate(`/dispatch/edit/${s.id}`)}>
                      <td>{dayLabel(s.work_date)}</td>
                      <td>
                        {workerById.get(s.worker_id)?.name ?? '-'}
                        {s.paid_date && !isAdmin && ' 🔒'}
                      </td>
                      <td>
                        <PositionTag value={s.position} />
                      </td>
                      <td>{timeRangeLabel(s.start_time, s.end_time)}</td>
                      <td className="num">{wonPlain(s.wage)}</td>
                      <td className={`num ${s.paid_date ? 'paid-text' : 'pending-text'}`}>
                        {s.paid_date ? `완료 ${dayLabel(s.paid_date)}` : '대기'}
                      </td>
                      <td className="num">
                        {s.paid_date && !isAdmin ? (
                          <span className="hint">🔒</span>
                        ) : (
                          <button
                            type="button"
                            className="chip edit-chip"
                            onClick={(e) => {
                              e.stopPropagation()
                              navigate(`/dispatch/edit/${s.id}`)
                            }}
                          >
                            수정
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="cost-summary">
            <div className="cost-summary-row">
              <span>
                {Number(m)}월 합계{positionFilter !== 'all' && ` (${positionLabel(positionFilter)})`}
              </span>
              <strong>
                {visibleShifts.length}건 · {won(monthTotal)}
              </strong>
            </div>
            {positionFilter === 'all' &&
              POSITIONS.map((p) => (
                <div key={p.key} className="cost-summary-row position-sum-row">
                  <span>
                    {p.icon} {p.label}
                  </span>
                  <span>
                    {byPosition[p.key].count}건 · {won(byPosition[p.key].total)}
                  </span>
                </div>
              ))}
            {positionFilter === 'all' && byPosition.none.count > 0 && (
              <div className="cost-summary-row position-sum-row">
                <span>포지션 미입력</span>
                <span>
                  {byPosition.none.count}건 · {won(byPosition.none.total)}
                </span>
              </div>
            )}
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
                  평소 포지션 {w.default_position ? <PositionTag value={w.default_position} /> : '미설정'}
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
                  <button type="button" className="btn-primary" onClick={() => addToday(w)}>
                    오늘 출근 +
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
              <div key={w.id} className="cost-summary dispatch-card">
                <div className="cost-summary-row">
                  <strong>
                    {w.name} {w.is_fixed && <span className="tag">고정</span>} {w.default_position && <PositionTag value={w.default_position} />}
                  </strong>
                  <span>{r ? `${Number(m)}월 ${r.days}일` : ''}</span>
                </div>
                <p className="hint">
                  {showMaskedRrn(w.rrn_masked)} · {[w.bank, w.account].filter(Boolean).join(' ') || '계좌 없음'}
                </p>
                <div className="dispatch-card-actions">
                  <button type="button" className="btn-secondary" onClick={() => navigate(`/dispatch/workers/${w.id}?month=${month}`)}>
                    근무 내역
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => navigate(`/dispatch/workers/${w.id}?month=${month}&edit=1`)}>
                    ✏️ 정보 수정
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
