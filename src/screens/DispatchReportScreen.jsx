import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { useHistoryState } from '../hooks/usePageHistoryState'
import { dispatchRequest, fetchShifts, fetchWorkers } from '../lib/dispatchApi'
import {
  buildLedgerRows,
  buildYearRows,
  groupByPaidDate,
  INSURANCE_DAY_LIMIT,
  monthRange,
  positionLabel,
  positionsOf,
  shiftMonthKey,
  timeRangeLabel,
  wonPlain,
} from '../lib/dispatch'
import { downloadCsv, rowsToCsv } from '../lib/csvExport'
import { currentMonth, todayStr } from '../lib/vendorLedger'

const EMPTY_BIZ = { business_name: '', owner_name: '', business_no: '', address: '' }
const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
const daysIn = (ym) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate()

// 파출 세무 출력 (메인 관리자 전용): 월간 일용직 지급대장 · 개인별 급여명세서 · 연간 집계표 (인쇄/PDF, 엑셀)
export default function DispatchReportScreen() {
  const { stores } = useStore()
  const navigate = useNavigate()
  const [storeCode, setStoreCode] = useHistoryState('reportStore', () => stores[0]?.code)
  const [mode, setMode] = useHistoryState('reportMode', 'month')
  const [month, setMonth] = useHistoryState('reportMonth', () => shiftMonthKey(currentMonth(), -1))
  const [year, setYear] = useHistoryState('reportYear', () => Number(currentMonth().slice(0, 4)))
  const [outputs, setOutputs] = useState({ ledger: true, statements: true })

  const [workers, setWorkers] = useState([])
  const [shifts, setShifts] = useState([])
  const [rrns, setRrns] = useState({})
  const [biz, setBiz] = useState(EMPTY_BIZ)
  const [bizOpen, setBizOpen] = useState(false)
  const [bizSaving, setBizSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const store = stores.find((s) => s.code === storeCode) ?? stores[0]
  const range = mode === 'month' ? monthRange(month) : { start: `${year}-01-01`, end: `${year + 1}-01-01` }

  useEffect(() => {
    if (!supabase || !store) return
    let cancelled = false
    setLoading(true)
    setError('')
    ;(async () => {
      try {
        const [w, s, bizRes] = await Promise.all([
          fetchWorkers(store.code),
          fetchShifts({ storeCodes: store.code, start: range.start, end: range.end }),
          supabase.from('store_business_info').select('business_name, owner_name, business_no, address').eq('store_code', store.code).maybeSingle(),
        ])
        if (cancelled) return
        setWorkers(w)
        setShifts(s)
        setBiz(bizRes.data ? { ...EMPTY_BIZ, ...bizRes.data } : { ...EMPTY_BIZ, business_name: store.name })
        // 주민번호 전체는 서버에서 관리자 확인 후에만 받아온다.
        const ids = [...new Set(s.map((x) => x.worker_id))]
        const { ok, body } = await dispatchRequest('revealRrn', { workerIds: ids })
        if (cancelled) return
        if (!ok) throw new Error(body.error || '주민번호를 불러오지 못했어요.')
        setRrns(body.rrns ?? {})
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [store, range.start, range.end])

  const workerById = useMemo(() => new Map(workers.map((w) => [w.id, w])), [workers])
  const byName = (a, b) => (workerById.get(a.workerId)?.name ?? '').localeCompare(workerById.get(b.workerId)?.name ?? '', 'ko')
  const ledger = useMemo(() => buildLedgerRows(shifts).sort(byName), [shifts, workerById]) // eslint-disable-line react-hooks/exhaustive-deps
  const yearRows = useMemo(() => buildYearRows(shifts).sort(byName), [shifts, workerById]) // eslint-disable-line react-hooks/exhaustive-deps
  const sum = (rows, key) => rows.reduce((acc, r) => acc + r[key], 0)
  const nameOf = (id) => workerById.get(id)?.name ?? '-'
  const rrnOf = (id) => rrns[id] ?? '(확인 불가)'
  const periodLabel = mode === 'month' ? `${month.slice(0, 4)}년 ${Number(month.slice(5))}월분` : `${year}년 1월 ~ 12월`

  const saveBiz = async () => {
    setBizSaving(true)
    setError('')
    const { error: err } = await supabase
      .from('store_business_info')
      .upsert({ store_code: store.code, ...biz, updated_at: new Date().toISOString() }, { onConflict: 'store_code' })
    setBizSaving(false)
    if (err) return setError(err.message)
    setBizOpen(false)
    setMessage('사업자 정보를 저장했어요.')
  }

  const exportCsv = () => {
    if (mode === 'month') {
      const csv = rowsToCsv(ledger, [
        { label: '이름', value: (r) => nameOf(r.workerId) },
        { label: '주민등록번호', value: (r) => rrnOf(r.workerId) },
        { label: '포지션', value: (r) => positionsOf(r.shifts) },
        { label: '근무일수', value: 'days' },
        { label: '근무일자', value: (r) => [...r.dates].sort().map((d) => Number(d.slice(8, 10))).join(' ') },
        { label: '총지급액', value: 'total' },
        { label: '소득세', value: 'incomeTax' },
        { label: '지방소득세', value: 'localTax' },
        { label: '실지급액', value: 'net' },
        { label: '미송금액', value: 'unpaid' },
        { label: '은행', value: (r) => workerById.get(r.workerId)?.bank ?? '' },
        { label: '계좌번호', value: (r) => workerById.get(r.workerId)?.account ?? '' },
      ])
      downloadCsv(`일용직지급대장_${store.name}_${month}.csv`, csv)
    } else {
      const csv = rowsToCsv(yearRows, [
        { label: '이름', value: (r) => nameOf(r.workerId) },
        { label: '주민등록번호', value: (r) => rrnOf(r.workerId) },
        ...Array.from({ length: 12 }, (_, i) => ({ label: `${i + 1}월`, value: (r) => r.months[i] })),
        { label: '연 합계', value: 'total' },
        { label: '근무일수', value: 'days' },
      ])
      downloadCsv(`일용직연간집계_${store.name}_${year}.csv`, csv)
    }
  }

  const payer = (
    <>
      <tr>
        <th rowSpan={3}>지불인</th>
        <th>상호</th>
        <td colSpan={3} className="center">
          {biz.business_name || store?.name}
        </td>
      </tr>
      <tr>
        <th>대표</th>
        <td>{biz.owner_name}</td>
        <th>사업자번호</th>
        <td>{biz.business_no}</td>
      </tr>
      <tr>
        <th>주소</th>
        <td colSpan={3}>{biz.address}</td>
      </tr>
    </>
  )

  const printHeader = (
    <div className="print-meta">
      <span>
        {biz.business_name || store?.name}
        {biz.business_no && ` · 사업자번호 ${biz.business_no}`}
      </span>
      <span>출력일 {todayStr()}</span>
    </div>
  )

  if (!store) return null

  return (
    <div className="screen screen-wide dispatch-report">
      <div className="no-print">
        <div className="screen-header">
          <button type="button" className="link-btn" onClick={() => navigate('/menu')}>
            ← 메인 메뉴
          </button>
          <h1>🖨️ 파출 세무 출력</h1>
          <p className="subtitle">주민번호 전체가 표시돼요. 출력물 보관에 주의하세요.</p>
        </div>

        <div className="field">
          <label>매장</label>
          <div className="preset-row">
            {stores.map((s) => (
              <button key={s.code} type="button" className={store.code === s.code ? 'chip chip-active' : 'chip'} onClick={() => setStoreCode(s.code)}>
                {s.name}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>기간</label>
          <div className="preset-row">
            <button type="button" className={mode === 'month' ? 'chip chip-active' : 'chip'} onClick={() => setMode('month')}>
              월별
            </button>
            <button type="button" className={mode === 'year' ? 'chip chip-active' : 'chip'} onClick={() => setMode('year')}>
              연별
            </button>
          </div>
          <div className="month-nav">
            <button
              type="button"
              className="chip"
              onClick={() => (mode === 'month' ? setMonth(shiftMonthKey(month, -1)) : setYear(year - 1))}
              aria-label="이전"
            >
              ◀
            </button>
            <strong>{mode === 'month' ? `${month.slice(0, 4)}년 ${Number(month.slice(5))}월` : `${year}년`}</strong>
            <button
              type="button"
              className="chip"
              onClick={() => (mode === 'month' ? setMonth(shiftMonthKey(month, 1)) : setYear(year + 1))}
              aria-label="다음"
            >
              ▶
            </button>
          </div>
        </div>

        {mode === 'month' && (
          <div className="field">
            <label>출력물</label>
            <label className="toggle-row">
              <input type="checkbox" checked={outputs.ledger} onChange={(e) => setOutputs((o) => ({ ...o, ledger: e.target.checked }))} />
              <span>월간 일용직 지급대장 (근로내용확인신고·지급명세서용, 1~31일 근무 표시)</span>
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={outputs.statements}
                onChange={(e) => setOutputs((o) => ({ ...o, statements: e.target.checked }))}
              />
              <span>개인별 일용직 급여명세서 (1인 1장)</span>
            </label>
          </div>
        )}

        <div className="cost-summary">
          <div className="cost-summary-row">
            <span>지불인(사업자) 정보</span>
            <button type="button" className="link-btn inline-link" onClick={() => setBizOpen((v) => !v)}>
              {bizOpen ? '닫기' : '고치기'}
            </button>
          </div>
          <p className="hint">
            {[biz.business_name || store.name, biz.owner_name, biz.business_no, biz.address].filter(Boolean).join(' · ')}
            {!biz.business_no && ' — 사업자번호를 넣어주세요'}
          </p>
          {bizOpen && (
            <div className="invoice-form">
              {[
                ['business_name', '상호'],
                ['owner_name', '대표자'],
                ['business_no', '사업자등록번호'],
                ['address', '사업장 주소'],
              ].map(([key, label]) => (
                <div className="field" key={key}>
                  <label>{label}</label>
                  <input className="input" value={biz[key] ?? ''} onChange={(e) => setBiz((b) => ({ ...b, [key]: e.target.value }))} />
                </div>
              ))}
              <button type="button" className="btn-primary" onClick={saveBiz} disabled={bizSaving}>
                {bizSaving ? '저장 중...' : '저장'}
              </button>
            </div>
          )}
        </div>

        {loading && <p className="hint">불러오는 중...</p>}
        {error && <p className="error-text">{error}</p>}
        {message && <p className="success-text">{message}</p>}

        <div className="report-actions">
          <button type="button" className="btn-primary" onClick={() => window.print()} disabled={loading || shifts.length === 0}>
            🖨️ 인쇄 / PDF 저장
          </button>
          <button type="button" className="btn-secondary" onClick={exportCsv} disabled={loading || shifts.length === 0}>
            📥 엑셀(CSV) 내려받기
          </button>
        </div>
        {mode === 'month' && (
          <div className="cost-summary">
            <p className="price-alert-title">📅 신고 기한 ({Number(month.slice(5))}월분)</p>
            <p className="hint">
              근로내용확인신고(근로복지공단): 다음 달 15일까지 · 일용근로소득 지급명세서(홈택스): 다음 달 말일까지
            </p>
          </div>
        )}
        {!loading && shifts.length === 0 && <p className="hint">이 기간에 파출 근무 기록이 없어요.</p>}
        {!loading && shifts.length > 0 && <p className="hint report-preview-title">▼ 출력 미리보기</p>}
      </div>

      {!loading && shifts.length > 0 && (
        <div className="print-dispatch">
          {mode === 'month' && outputs.ledger && (
            <section className="print-page landscape">
              {printHeader}
              <h2 className="print-doc-title">일 용 직 지 급 대 장</h2>
              <p className="print-doc-sub">{periodLabel}</p>
              <table className="print-doc-table">
                <thead>
                  <tr>
                    <th>이름</th>
                    <th>주민등록번호</th>
                    <th>포지션</th>
                    <th>근무일수</th>
                    <th>총지급액</th>
                    <th>소득세</th>
                    <th>지방소득세</th>
                    <th>실지급액</th>
                    <th>송금</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((r) => (
                    <tr key={r.workerId}>
                      <td>
                        {nameOf(r.workerId)}
                        {r.days >= INSURANCE_DAY_LIMIT && ' ⚠️'}
                      </td>
                      <td>{rrnOf(r.workerId)}</td>
                      <td className="center">{positionsOf(r.shifts)}</td>
                      <td className="num">{r.days}</td>
                      <td className="num">{wonPlain(r.total)}</td>
                      <td className="num">{wonPlain(r.incomeTax)}</td>
                      <td className="num">{wonPlain(r.localTax)}</td>
                      <td className="num">{wonPlain(r.net)}</td>
                      <td className="center">{r.unpaid > 0 ? `미송금 ${wonPlain(r.unpaid)}` : '완료'}</td>
                    </tr>
                  ))}
                  <tr className="total-row">
                    <th colSpan={3}>합계 {ledger.length}명</th>
                    <th className="num">{sum(ledger, 'days')}</th>
                    <th className="num">{wonPlain(sum(ledger, 'total'))}</th>
                    <th className="num">{wonPlain(sum(ledger, 'incomeTax'))}</th>
                    <th className="num">{wonPlain(sum(ledger, 'localTax'))}</th>
                    <th className="num">{wonPlain(sum(ledger, 'net'))}</th>
                    <th />
                  </tr>
                </tbody>
              </table>

              <p className="print-doc-section">일자별 근무 (근로내용확인신고용)</p>
              <table className="print-doc-table day-grid-table">
                <thead>
                  <tr>
                    <th>이름</th>
                    {Array.from({ length: daysIn(month) }, (_, i) => (
                      <th key={i}>{i + 1}</th>
                    ))}
                    <th>일수</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((r) => (
                    <tr key={r.workerId}>
                      <td>{nameOf(r.workerId)}</td>
                      {Array.from({ length: daysIn(month) }, (_, i) => (
                        <td key={i} className="center">
                          {r.dates.has(`${month}-${String(i + 1).padStart(2, '0')}`) ? '○' : ''}
                        </td>
                      ))}
                      <td className="center">{r.days}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="print-note">
                · 일당 15만 원 이하는 소득세 0원 (초과분 × 2.7%, 소득세 1,000원 미만은 소액부징수, 지방소득세는 소득세의 10%)
                <br />· ⚠️ 한 달 {INSURANCE_DAY_LIMIT}일 이상 근무: 국민연금·건강보험 사업장 가입 여부 확인 필요
              </p>
            </section>
          )}

          {mode === 'month' &&
            outputs.statements &&
            ledger.map((r) => {
              const w = workerById.get(r.workerId)
              const groups = groupByPaidDate(r.shifts)
              const paidTotal = r.total - r.unpaid
              return (
                <section key={r.workerId} className="print-page portrait">
                  <div className="print-meta">
                    <span />
                    <span>{[w?.bank, w?.account].filter(Boolean).join(' ')}</span>
                  </div>
                  <h2 className="print-doc-title">일 용 직 급 여 명 세 서</h2>
                  <p className="print-doc-sub">{periodLabel}</p>
                  <table className="print-doc-table">
                    <tbody>
                      <tr>
                        <th rowSpan={2}>수령인</th>
                        <th>이름</th>
                        <td>{w?.name}</td>
                        <th>주민등록번호</th>
                        <td>{rrnOf(r.workerId)}</td>
                      </tr>
                      <tr>
                        <th>계좌</th>
                        <td colSpan={3}>{[w?.bank, w?.account].filter(Boolean).join(' ')}</td>
                      </tr>
                      {payer}
                    </tbody>
                  </table>
                  <table className="print-doc-table">
                    <thead>
                      <tr>
                        <th>근무일</th>
                        <th>포지션</th>
                        <th>근무시간</th>
                        <th>일당</th>
                        <th>송금일</th>
                        <th>송금액</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.flatMap((g) =>
                        g.shifts.map((s, i) => (
                          <tr key={s.id}>
                            <td>{md(s.work_date)}</td>
                            <td className="center">{s.position ? positionLabel(s.position) : ''}</td>
                            <td>{timeRangeLabel(s.start_time, s.end_time)}</td>
                            <td className="num">{wonPlain(s.wage)}</td>
                            {i === 0 && (
                              <>
                                <td rowSpan={g.shifts.length} className="center">
                                  {g.paidDate ? md(g.paidDate) : '미송금'}
                                </td>
                                <td rowSpan={g.shifts.length} className="num">
                                  {g.paidDate ? wonPlain(g.amount) : ''}
                                </td>
                              </>
                            )}
                          </tr>
                        )),
                      )}
                      <tr className="total-row">
                        <th colSpan={3}>합계 {r.days}일</th>
                        <th className="num">{wonPlain(r.total)}</th>
                        <th />
                        <th className="num">{wonPlain(paidTotal)}</th>
                      </tr>
                      {(r.incomeTax > 0 || r.localTax > 0) && (
                        <tr>
                          <th colSpan={3}>원천징수 (소득세 / 지방소득세)</th>
                          <td colSpan={3} className="num">
                            {wonPlain(r.incomeTax)} / {wonPlain(r.localTax)} · 실지급액 {wonPlain(r.net)}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  <p className="print-note">위 금액을 정히 영수합니다. 수령인: {w?.name} (서명)</p>
                </section>
              )
            })}

          {mode === 'year' && (
            <section className="print-page landscape">
              {printHeader}
              <h2 className="print-doc-title">일 용 직 연 간 집 계 표</h2>
              <p className="print-doc-sub">{periodLabel} (단위: 원)</p>
              <table className="print-doc-table year-table">
                <thead>
                  <tr>
                    <th>이름</th>
                    <th>주민등록번호</th>
                    {Array.from({ length: 12 }, (_, i) => (
                      <th key={i}>{i + 1}월</th>
                    ))}
                    <th>연 합계</th>
                    <th>근무일</th>
                  </tr>
                </thead>
                <tbody>
                  {yearRows.map((r) => (
                    <tr key={r.workerId}>
                      <td>{nameOf(r.workerId)}</td>
                      <td>{rrnOf(r.workerId)}</td>
                      {r.months.map((v, i) => (
                        <td key={i} className="num">
                          {v ? wonPlain(v) : '-'}
                        </td>
                      ))}
                      <td className="num">
                        <strong>{wonPlain(r.total)}</strong>
                      </td>
                      <td className="num">{r.days}</td>
                    </tr>
                  ))}
                  <tr className="total-row">
                    <th colSpan={2}>합계 {yearRows.length}명</th>
                    {Array.from({ length: 12 }, (_, i) => (
                      <th key={i} className="num">
                        {wonPlain(yearRows.reduce((acc, r) => acc + r.months[i], 0))}
                      </th>
                    ))}
                    <th className="num">{wonPlain(sum(yearRows, 'total'))}</th>
                    <th className="num">{sum(yearRows, 'days')}</th>
                  </tr>
                </tbody>
              </table>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
