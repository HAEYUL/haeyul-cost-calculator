import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { useHistoryState } from '../hooks/usePageHistoryState'
import { fetchShifts, fetchSources, fetchWorkers, SHIFT_COLUMNS } from '../lib/dispatchApi'
import { groupUnpaid, monthRange, positionLabel, shiftMonthKey, showMaskedRrn, sourcesOf, timeRangeLabel, won, wonPlain } from '../lib/dispatch'
import PositionTag from '../components/PositionTag'
import { currentMonth, todayStr } from '../lib/vendorLedger'

const dayLabel = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`

// 파출비 송금 관리 (메인 관리자 전용). 송금은 은행에서 직접 하고, 여기서는 송금완료만 체크한다.
export default function DispatchPaymentsScreen() {
  const { stores } = useStore()
  const navigate = useNavigate()
  const [tab, setTab] = useHistoryState('payTab', 'pending')
  const [storeFilter, setStoreFilter] = useHistoryState('payStore', 'all')
  const [doneMonth, setDoneMonth] = useHistoryState('payDoneMonth', () => currentMonth())

  const [workers, setWorkers] = useState([])
  const [shifts, setShifts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [selected, setSelected] = useState(new Set())
  const [expanded, setExpanded] = useState(new Set())
  const [paidDate, setPaidDate] = useState(todayStr())
  const [saving, setSaving] = useState(false)
  const [cancelTarget, setCancelTarget] = useState(null)
  const [sources, setSources] = useState([])

  const storeCodes = useMemo(() => stores.map((s) => s.code), [stores])
  const storeName = (code) => stores.find((s) => s.code === code)?.name ?? code

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    setLoading(true)
    const load =
      tab === 'pending'
        ? fetchShifts({ storeCodes, unpaidOnly: true })
        : (async () => {
            const { start, end } = monthRange(doneMonth)
            const { data, error: err } = await supabase
              .from('dispatch_shifts')
              .select(SHIFT_COLUMNS)
              .in('store_code', storeCodes)
              .gte('paid_date', start)
              .lt('paid_date', end)
              .order('paid_date', { ascending: false })
              .limit(5000)
            if (err) throw err
            return data ?? []
          })()
    Promise.all([fetchWorkers(storeCodes), load, fetchSources().catch(() => [])])
      .then(([w, s, src]) => {
        if (!cancelled) setSources(src)
        if (cancelled) return
        setWorkers(w)
        setShifts(s)
        setError('')
        if (tab === 'pending') setSelected(new Set())
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [storeCodes, tab, doneMonth, reloadKey])

  const workerById = useMemo(() => new Map(workers.map((w) => [w.id, w])), [workers])
  const visibleShifts = storeFilter === 'all' ? shifts : shifts.filter((s) => s.store_code === storeFilter)
  const groups = useMemo(() => {
    const order = (code) => storeCodes.indexOf(code)
    return groupUnpaid(visibleShifts).sort(
      (a, b) =>
        order(a.storeCode) - order(b.storeCode) ||
        (workerById.get(a.workerId)?.name ?? '').localeCompare(workerById.get(b.workerId)?.name ?? '', 'ko'),
    )
  }, [visibleShifts, storeCodes, workerById])

  const toggle = (ids, on) =>
    setSelected((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })
  const toggleExpand = (key) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const selectedShifts = visibleShifts.filter((s) => selected.has(s.id))
  const selectedTotal = selectedShifts.reduce((sum, s) => sum + Number(s.wage || 0), 0)
  const selectedWorkers = new Set(selectedShifts.map((s) => s.worker_id)).size

  const copyAccount = async (w, shift) => {
    const text = [shift?.bank ?? w?.bank, shift?.account ?? w?.account].filter(Boolean).join(' ')
    try {
      await navigator.clipboard.writeText(text)
      setMessage(`복사했어요: ${text}`)
    } catch {
      setMessage(text)
    }
  }

  const markPaid = async () => {
    setError('')
    setMessage('')
    if (selectedShifts.length === 0) return setError('송금한 근무를 체크하세요.')
    if (!paidDate) return setError('송금일을 입력하세요.')
    setSaving(true)
    const { error: err } = await supabase
      .from('dispatch_shifts')
      .update({ paid_date: paidDate, paid_marked_at: new Date().toISOString() })
      .in('id', selectedShifts.map((s) => s.id))
    setSaving(false)
    if (err) return setError(err.message)
    setMessage(`${selectedWorkers}명 · ${selectedShifts.length}건 · ${won(selectedTotal)} 송금완료로 체크했어요.`)
    setReloadKey((k) => k + 1)
  }

  // 송금 완료 내역: 송금일·매장·근무자별로 묶기
  const doneGroups = useMemo(() => {
    if (tab !== 'done') return []
    const map = new Map()
    for (const s of visibleShifts) {
      const key = `${s.paid_date}|${s.store_code}|${s.worker_id}`
      if (!map.has(key)) map.set(key, { key, paidDate: s.paid_date, storeCode: s.store_code, workerId: s.worker_id, shifts: [], total: 0 })
      const g = map.get(key)
      g.shifts.push(s)
      g.total += Number(s.wage || 0)
    }
    return [...map.values()].sort((a, b) => b.paidDate.localeCompare(a.paidDate))
  }, [tab, visibleShifts])

  const cancelPaid = async (group) => {
    if (cancelTarget !== group.key) {
      setCancelTarget(group.key)
      return
    }
    setSaving(true)
    const { error: err } = await supabase
      .from('dispatch_shifts')
      .update({ paid_date: null, paid_marked_at: null })
      .in('id', group.shifts.map((s) => s.id))
    setSaving(false)
    setCancelTarget(null)
    if (err) return setError(err.message)
    setMessage('송금완료 체크를 취소했어요. 송금 대기로 돌아갔어요.')
    setReloadKey((k) => k + 1)
  }

  const doneTotal = doneGroups.reduce((sum, g) => sum + g.total, 0)
  const doneByStore = stores.map((s) => ({
    ...s,
    total: doneGroups.filter((g) => g.storeCode === s.code).reduce((sum, g) => sum + g.total, 0),
  }))

  return (
    <div className="screen screen-wide dispatch-screen">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/menu')}>
          ← 메인 메뉴
        </button>
        <h1>💸 파출비 송금 관리</h1>
        <p className="subtitle">은행에서 직접 송금하신 뒤, 송금한 근무를 체크하세요. 메인 관리자만 볼 수 있어요.</p>
      </div>

      <div className="preset-row">
        <button type="button" className={tab === 'pending' ? 'chip chip-active' : 'chip'} onClick={() => setTab('pending')}>
          송금 대기
        </button>
        <button type="button" className={tab === 'done' ? 'chip chip-active' : 'chip'} onClick={() => setTab('done')}>
          송금 완료 내역
        </button>
      </div>
      <div className="preset-row">
        {[{ code: 'all', name: '전체 매장' }, ...stores].map((s) => (
          <button
            key={s.code}
            type="button"
            className={storeFilter === s.code ? 'chip chip-active' : 'chip'}
            onClick={() => {
              setStoreFilter(s.code)
              setSelected(new Set())
            }}
          >
            {s.name}
          </button>
        ))}
      </div>

      {loading && <p className="hint">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}
      {message && <p className="success-text">{message}</p>}

      {!loading && tab === 'pending' && (
        <>
          {groups.length === 0 && <p className="hint">송금할 파출비가 없어요. 👍</p>}
          <div className="dispatch-cards">
            {groups.map((g) => {
              const w = workerById.get(g.workerId)
              const ids = g.shifts.map((s) => s.id)
              const allOn = ids.every((id) => selected.has(id))
              const someOn = ids.some((id) => selected.has(id))
              const last = g.shifts.at(-1)
              const open = expanded.has(g.key)
              return (
                <div key={g.key} className={`cost-summary dispatch-card${someOn ? ' dispatch-card-on' : ''}`}>
                  <div className="cost-summary-row">
                    <label className="pay-check">
                      <input
                        type="checkbox"
                        checked={allOn}
                        ref={(el) => el && (el.indeterminate = someOn && !allOn)}
                        onChange={(e) => toggle(ids, e.target.checked)}
                      />
                      <span>
                        <span className="tag">{storeName(g.storeCode)}</span> <strong>{w?.name ?? '-'}</strong>{' '}
                        {w?.is_fixed && <span className="tag">고정</span>}
                      </span>
                    </label>
                    <strong>{won(g.total)}</strong>
                  </div>
                  <p className="hint">
                    {sourcesOf(g.shifts, new Map(sources.map((src) => [src.id, src]))) !== '-' && (
                      <span className="tag">{sourcesOf(g.shifts, new Map(sources.map((src) => [src.id, src])))}</span>
                    )}{' '}
                    {showMaskedRrn(w?.rrn_masked)} · {[last.bank ?? w?.bank, last.account ?? w?.account].filter(Boolean).join(' ') || '계좌 없음'}{' '}
                    <button type="button" className="chip copy-chip" onClick={() => copyAccount(w, last)}>
                      계좌 복사
                    </button>
                  </p>
                  <p className="hint">
                    {g.shifts.map((s) => `${dayLabel(s.work_date)} ${s.position ? positionLabel(s.position) + ' ' : ''}${timeRangeLabel(s.start_time, s.end_time)}`).join(', ')}{' '}
                    <button type="button" className="link-btn inline-link" onClick={() => toggleExpand(g.key)}>
                      {open ? '접기' : '날짜별로 고르기'}
                    </button>
                  </p>
                  {open && (
                    <table className="dispatch-table">
                      <tbody>
                        {g.shifts.map((s) => (
                          <tr key={s.id} className={selected.has(s.id) ? 'selected' : ''}>
                            <td>
                              <label className="pay-check">
                                <input type="checkbox" checked={selected.has(s.id)} onChange={(e) => toggle([s.id], e.target.checked)} />
                                <span>{dayLabel(s.work_date)}</span>
                              </label>
                            </td>
                            <td>
                              <PositionTag value={s.position} />
                            </td>
                            <td>{timeRangeLabel(s.start_time, s.end_time)}</td>
                            <td className="num">{wonPlain(s.wage)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )
            })}
          </div>

          {groups.length > 0 && (
            <div className="sticky-save pay-bar">
              <div className="cost-summary">
                <div className="cost-summary-row">
                  <span>
                    선택 {selectedWorkers}명 · {selectedShifts.length}건
                  </span>
                  <strong className="pay-total">{won(selectedTotal)}</strong>
                </div>
                <div className="rrn-row">
                  <label htmlFor="paidDate" className="hint">
                    송금일
                  </label>
                  <input id="paidDate" type="date" className="input" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
                </div>
                <button type="button" className="btn-primary" onClick={markPaid} disabled={saving || selectedShifts.length === 0}>
                  {saving ? '저장 중...' : '✔ 송금완료 체크'}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {!loading && tab === 'done' && (
        <>
          <div className="month-nav">
            <button type="button" className="chip" onClick={() => setDoneMonth(shiftMonthKey(doneMonth, -1))} aria-label="이전 달">
              ◀
            </button>
            <strong>
              {doneMonth.slice(0, 4)}년 {Number(doneMonth.slice(5))}월 송금
            </strong>
            <button type="button" className="chip" onClick={() => setDoneMonth(shiftMonthKey(doneMonth, 1))} aria-label="다음 달">
              ▶
            </button>
          </div>
          {doneGroups.length === 0 ? (
            <p className="hint">이 달에 송금완료로 체크한 내역이 없어요.</p>
          ) : (
            <div className="ledger-table-wrap">
              <table className="dispatch-table">
                <thead>
                  <tr>
                    <th>송금일</th>
                    <th>매장</th>
                    <th>이름</th>
                    <th>근무일</th>
                    <th className="num">금액</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {doneGroups.map((g) => (
                    <tr key={g.key}>
                      <td>{dayLabel(g.paidDate)}</td>
                      <td>{storeName(g.storeCode)}</td>
                      <td>{workerById.get(g.workerId)?.name ?? '-'}</td>
                      <td>{g.shifts.map((s) => Number(s.work_date.slice(8, 10))).sort((a, b) => a - b).join(', ')}일</td>
                      <td className="num">{wonPlain(g.total)}</td>
                      <td>
                        <button type="button" className="link-btn link-btn-danger inline-link" onClick={() => cancelPaid(g)} disabled={saving}>
                          {cancelTarget === g.key ? '정말 취소?' : '취소'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="cost-summary">
            <div className="cost-summary-row">
              <span>{Number(doneMonth.slice(5))}월 송금 합계</span>
              <strong>{won(doneTotal)}</strong>
            </div>
            {storeFilter === 'all' &&
              doneByStore.map((s) => (
                <div key={s.code} className="cost-summary-row">
                  <span>{s.name}</span>
                  <span>{won(s.total)}</span>
                </div>
              ))}
          </div>
        </>
      )}
    </div>
  )
}
