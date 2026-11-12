import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { useHistoryState } from '../hooks/usePageHistoryState'
import { fetchShifts, fetchSources, fetchWorkers } from '../lib/dispatchApi'
import PositionTag from '../components/PositionTag'
import {
  INSURANCE_DAY_LIMIT,
  monthRange,
  positionLabel,
  POSITIONS,
  shiftMonthKey,
  showMaskedRrn,
  sourceIcon,
  summarizeByPosition,
  summarizeBySource,
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
// 메인 관리자는 [전체 매장 / 매장별] 버튼으로 나눠 본다(처음엔 전체 매장). 매니저는 자기 매장만.
export default function DispatchScreen() {
  const { store, stores, isAdmin, setStore } = useStore()
  const navigate = useNavigate()
  const [tab, setTab] = useHistoryState('dispatchTab', 'daily')
  const [month, setMonth] = useHistoryState('dispatchMonth', () => currentMonth())
  const [workers, setWorkers] = useState([])
  const [shifts, setShifts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [positionFilter, setPositionFilter] = useHistoryState('dispatchPosition', 'all')
  const [sourceFilter, setSourceFilter] = useHistoryState('dispatchSource', 'all')
  const [sources, setSources] = useState([])
  const [storeFilter, setStoreFilter] = useHistoryState('dispatchStore', 'all')
  const [pickingStore, setPickingStore] = useState(false)

  const viewAll = isAdmin && storeFilter === 'all'
  const viewCodes = !isAdmin ? [store.code] : viewAll ? stores.map((st) => st.code) : [storeFilter]
  const codesKey = viewCodes.join(',')
  const storeName = (code) => stores.find((st) => st.code === code)?.name ?? code
  const storeOrder = (code) => stores.findIndex((st) => st.code === code)

  // 근무 등록·수정·인력 상세는 '보는 매장' 기준으로 동작하므로, 그 근무·인력의 매장으로 바꾼 뒤 이동한다.
  const goInStore = (code, path) => {
    if (isAdmin && code !== store.code) {
      const next = stores.find((st) => st.code === code)
      if (next) setStore(next)
    }
    navigate(path)
  }

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    setLoading(true)
    const { start, end } = monthRange(month)
    const codes = codesKey.split(',')
    Promise.all([fetchWorkers(codes), fetchShifts({ storeCodes: codes, start, end }), fetchSources().catch(() => [])])
      .then(([w, s, src]) => {
        if (cancelled) return
        // 전체 매장일 때 인력은 매장 순서 → 이름 순
        setWorkers(codes.length > 1 ? [...w].sort((a, b) => storeOrder(a.store_code) - storeOrder(b.store_code) || a.name.localeCompare(b.name, 'ko')) : w)
        setShifts(s)
        setSources(src)
        setError('')
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
    // storeOrder는 stores에서 나온다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codesKey, month])

  const workerById = useMemo(() => new Map(workers.map((w) => [w.id, w])), [workers])
  const summary = useMemo(() => summarizeByWorker(shifts), [shifts])
  const byPosition = useMemo(() => summarizeByPosition(shifts), [shifts])
  const sourceById = useMemo(() => new Map(sources.map((src) => [src.id, src])), [sources])
  const bySource = useMemo(() => summarizeBySource(shifts), [shifts])
  const visibleShifts = shifts.filter(
    (s) =>
      (positionFilter === 'all' || s.position === positionFilter) &&
      (sourceFilter === 'all' || (s.source_id ?? 'none') === sourceFilter),
  )
  const sourceLabel = (id) => {
    const src = sourceById.get(id)
    return src ? `${sourceIcon(src.kind)} ${src.name}` : '-'
  }
  const monthTotal = visibleShifts.reduce((sum, s) => sum + Number(s.wage || 0), 0)
  // 전체 매장일 때 합계 아래 매장별 합계
  const byStore = viewAll
    ? stores
        .map((st) => {
          const list = visibleShifts.filter((s) => s.store_code === st.code)
          return { code: st.code, name: st.name, count: list.length, total: list.reduce((sum, s) => sum + Number(s.wage || 0), 0) }
        })
        .filter((r) => r.count > 0)
    : []
  const fixedWorkers = workers.filter((w) => w.is_fixed)
  const [y, m] = month.split('-')

  // 고정 파출 [오늘 출근 +]: 이름·오늘 날짜·평소 포지션만 채운 등록 화면으로 (근무시간·일당은 직접 입력)
  const addToday = (worker) => goInStore(worker.store_code, `/dispatch/new?worker=${worker.id}`)

  // [+ 근무 등록]: 전체 매장을 보고 있으면 어느 매장 근무인지 먼저 고른다.
  const startNew = () => {
    if (viewAll) {
      setPickingStore((v) => !v)
      return
    }
    goInStore(isAdmin ? storeFilter : store.code, '/dispatch/new')
  }

  return (
    <div className="screen screen-wide dispatch-screen">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/menu')}>
          ← 메인 메뉴
        </button>
        <h1>👷 파출 관리</h1>
        <p className="subtitle">
          {viewAll ? '전체 매장' : isAdmin ? storeName(storeFilter) : store.name} · 근무를 등록하면 메인 관리자가 확인하고 송금해요
        </p>
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

      <button type="button" className="btn-primary" onClick={startNew} aria-expanded={viewAll ? pickingStore : undefined}>
        + 근무 등록
      </button>
      {viewAll && pickingStore && (
        <div className="cost-summary store-pick">
          <p className="hint">어느 매장 근무를 등록할까요?</p>
          <div className="preset-row">
            {stores.map((st) => (
              <button key={st.code} type="button" className="chip" onClick={() => goInStore(st.code, '/dispatch/new')}>
                {st.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {isAdmin && (
        <button type="button" className="btn-secondary" onClick={() => navigate('/dispatch-payments')}>
          💸 송금 관리로 가기
        </button>
      )}
      <button type="button" className="btn-secondary" onClick={() => navigate('/dispatch/sources')}>
        🏢 경로 관리 (파출사무소·당근 등{isAdmin ? '' : ' 연락처'})
      </button>

      {/* 매장 버튼: 아래 목록 바로 위에 둔다 */}
      {isAdmin && (
        <div className="preset-row dispatch-store-filter">
          {[{ code: 'all', name: '전체 매장' }, ...stores].map((st) => (
            <button
              key={st.code}
              type="button"
              className={storeFilter === st.code ? 'chip chip-active' : 'chip'}
              onClick={() => {
                setStoreFilter(st.code)
                setPickingStore(false)
              }}
            >
              {st.name}
            </button>
          ))}
        </div>
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
          <select className="select source-filter" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} aria-label="경로로 걸러 보기">
            <option value="all">경로: 전체</option>
            {[...bySource.keys()].map((id) => (
              <option key={id} value={id}>
                {id === 'none' ? '경로 미입력' : sourceLabel(id)} ({bySource.get(id).count})
              </option>
            ))}
          </select>
          {visibleShifts.length === 0 ? (
            <p className="hint">이 달에 등록된 근무가 없어요.</p>
          ) : (
            <div className="ledger-table-wrap">
              <table className="dispatch-table">
                <thead>
                  <tr>
                    <th>날짜</th>
                    {viewAll && <th>매장</th>}
                    <th>이름</th>
                    <th>포지션</th>
                    <th>경로</th>
                    <th>시간</th>
                    <th className="num">일당</th>
                    <th className="num">송금</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visibleShifts.map((s) => (
                    <tr key={s.id} className="clickable" onClick={() => goInStore(s.store_code, `/dispatch/edit/${s.id}`)}>
                      <td>{dayLabel(s.work_date)}</td>
                      {viewAll && (
                        <td>
                          <span className="tag">{storeName(s.store_code)}</span>
                        </td>
                      )}
                      <td>
                        {workerById.get(s.worker_id)?.name ?? '-'}
                        {s.paid_date && !isAdmin && ' 🔒'}
                      </td>
                      <td>
                        <PositionTag value={s.position} />
                      </td>
                      <td className="source-cell">{s.source_id ? sourceLabel(s.source_id) : <span className="pending-text">미입력</span>}</td>
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
                              goInStore(s.store_code, `/dispatch/edit/${s.id}`)
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
            {byStore.map((r) => (
              <div key={r.code} className="cost-summary-row position-sum-row">
                <span>{r.name}</span>
                <span>
                  {r.count}건 · {won(r.total)}
                </span>
              </div>
            ))}
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
            {positionFilter === 'all' && sourceFilter === 'all' && bySource.size > 0 && (
              <>
                <p className="hint source-sum-title">경로별</p>
                {[...bySource.entries()]
                  .sort((a, b) => b[1].total - a[1].total)
                  .map(([id, r]) => (
                    <div key={id} className="cost-summary-row position-sum-row">
                      <span className={id === 'none' ? 'pending-text' : ''}>{id === 'none' ? '경로 미입력 ([수정]에서 넣어주세요)' : sourceLabel(id)}</span>
                      <span>
                        {r.count}건 · {won(r.total)}
                      </span>
                    </div>
                  ))}
              </>
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
                  <strong className="dispatch-card-name">
                    {viewAll && <span className="tag">{storeName(w.store_code)}</span>} {w.name}
                  </strong>
                  {r && r.days >= INSURANCE_DAY_LIMIT && <span className="tag-warn">{INSURANCE_DAY_LIMIT}일 이상</span>}
                </div>
                <p className="hint">
                  평소 포지션 {w.default_position ? <PositionTag value={w.default_position} /> : '미설정'} · 경로{' '}
                  {w.default_source_id ? sourceLabel(w.default_source_id) : '미설정'}
                </p>
                {w.memo && <p className="worker-memo">📝 {w.memo}</p>}
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
                  <button type="button" className="btn-secondary" onClick={() => goInStore(w.store_code, `/dispatch/workers/${w.id}?month=${month}`)}>
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
                    {viewAll && <span className="tag">{storeName(w.store_code)}</span>} {w.name} {w.is_fixed && <span className="tag">고정</span>} {w.default_position && <PositionTag value={w.default_position} />}
                  </strong>
                  <span>{r ? `${Number(m)}월 ${r.days}일` : ''}</span>
                </div>
                <p className="hint">
                  {showMaskedRrn(w.rrn_masked)} · {[w.bank, w.account].filter(Boolean).join(' ') || '계좌 없음'}
                  {w.default_source_id && ` · ${sourceLabel(w.default_source_id)}`}
                </p>
                {w.memo && <p className="worker-memo">📝 {w.memo}</p>}
                <div className="dispatch-card-actions">
                  <button type="button" className="btn-secondary" onClick={() => goInStore(w.store_code, `/dispatch/workers/${w.id}?month=${month}`)}>
                    근무 내역
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => goInStore(w.store_code, `/dispatch/workers/${w.id}?month=${month}&edit=1`)}>
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
