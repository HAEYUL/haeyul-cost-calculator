import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import AmountInput from '../components/AmountInput'
import { UNIT_LABELS } from '../lib/units'
import { rowDateStr } from '../lib/rowDateStr'
import { monthRange } from '../lib/dateRange'
import { canRecordBatchPayment, paidBatchIds, recordBatchPayment } from '../lib/batchPayment'
import {
  LEDGER_START,
  LEDGER_START_MONTH,
  addDays,
  currentMonth,
  endingBalanceOf,
  hasBalanceInfo,
  makeLedger,
  monthBounds,
  monthLabel,
  shiftMonth,
  suggestOpening,
  todayStr,
} from '../lib/vendorLedger'

const PAYMENT_MEMO_PRESETS = ['계좌이체', '카드', '현금']
const fmt = (n) => Math.round(Number(n)).toLocaleString()

export default function VendorDetailScreen() {
  const { store } = useStore()
  const navigate = useNavigate()
  const location = useLocation()
  const { vendorId } = useParams()

  const [vendor, setVendor] = useState(null)
  const [batches, setBatches] = useState([])
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [dataKey, setDataKey] = useState(0)
  const [savingVatSeparate, setSavingVatSeparate] = useState(false)

  // 명세표 수정 화면에 갔다가 돌아온 경우에만(location.state로 전달됨) 고른 기간을 유지하고,
  // 그 외의 재진입(메인 메뉴 등을 거쳐 다시 들어온 경우, 다른 거래처로 이동한 경우)에는
  // 항상 이번 달로 되돌아간다.
  const [dateFrom, setDateFrom] = useState(() => location.state?.dateRange?.dateFrom ?? monthRange().start)
  const [dateTo, setDateTo] = useState(() => location.state?.dateRange?.dateTo ?? monthRange().end)

  useEffect(() => {
    setDateFrom(location.state?.dateRange?.dateFrom ?? monthRange().start)
    setDateTo(location.state?.dateRange?.dateTo ?? monthRange().end)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId])

  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentDate, setPaymentDate] = useState(() => todayStr())
  const [paymentMemo, setPaymentMemo] = useState('')
  const [savingPayment, setSavingPayment] = useState(false)
  const [paymentDateEdits, setPaymentDateEdits] = useState({})
  const [savingPaymentDateId, setSavingPaymentDateId] = useState(null)
  const [issueDates, setIssueDates] = useState({})
  const [registeringIssueId, setRegisteringIssueId] = useState(null)

  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const [payBatchTarget, setPayBatchTarget] = useState(null)
  const [payingBatch, setPayingBatch] = useState(false)

  const [deletePaymentTarget, setDeletePaymentTarget] = useState(null)
  const [deletingPayment, setDeletingPayment] = useState(false)

  const [openingBalances, setOpeningBalances] = useState([])
  const [startBalanceInput, setStartBalanceInput] = useState('')
  const [savingOpeningBalance, setSavingOpeningBalance] = useState(false)

  useEffect(() => {
    if (!store) navigate('/', { replace: true })
  }, [store, navigate])

  useEffect(() => {
    if (!store || !supabase) return
    setLoading(true)
    setError('')
    Promise.all([
      supabase.from('vendors').select('id, name, vat_separate').eq('id', vendorId).single(),
      supabase
        .from('invoice_batches')
        .select(
          'id, vendor_id, invoice_date, total_amount, statement_balance, current_balance, photo_path, created_at, invoices(id, item_name, quantity, unit_price, unit, amount)',
        )
        .eq('store_code', store.code)
        .eq('vendor_id', vendorId)
        .order('invoice_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('vendor_payments')
        .select('id, vendor_id, amount, paid_date, memo, created_at')
        .eq('store_code', store.code)
        .eq('vendor_id', vendorId)
        .order('paid_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('vendor_opening_balances')
        .select('id, as_of_date, balance, memo')
        .eq('store_code', store.code)
        .eq('vendor_id', vendorId)
        .order('as_of_date', { ascending: false }),
    ]).then(([vendorRes, batchesRes, paymentsRes, openingBalancesRes]) => {
      const err = vendorRes.error || batchesRes.error || paymentsRes.error || openingBalancesRes.error
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }
      setVendor(vendorRes.data)
      setBatches(batchesRes.data ?? [])
      setPayments(paymentsRes.data ?? [])
      setOpeningBalances(openingBalancesRes.data ?? [])
      setLoading(false)
    })
  }, [store, vendorId, dataKey])

  // 저장해 둔 장부 시작 잔액을 입력칸에 불러온다.
  useEffect(() => {
    const saved = openingBalances.find((b) => b.as_of_date === LEDGER_START)
    setStartBalanceInput(saved ? String(saved.balance) : '')
  }, [openingBalances])

  if (!store) return null

  // 장부(외상 원장): 장부 시작 잔액 + 그 뒤 입고 − 그 뒤 결제. 거래처 목록·메인 메뉴와 같은 계산이다.
  // 명세표의 전잔액·현잔액은 계산에 쓰지 않고 아래 대조(issues)에만 쓴다.
  const ledger = makeLedger({ batches, payments, openings: openingBalances })
  const liveBalance = ledger.current
  const issues = ledger.reconcile()
  const openingSuggestion = ledger.hasOpening ? null : suggestOpening({ batches, payments })
  const periodLedger = ledger.period(dateFrom, dateTo)
  const periodStart = !dateFrom || dateFrom < LEDGER_START ? LEDGER_START : dateFrom
  const monthlyLedger = ledger.months(currentMonth())

  // 기간 칸 위의 ◀ ▶ 로 한 달씩 넘긴다. 지금 기간이 딱 한 달이면 그 달 이름을 보여준다.
  const navMonth = dateFrom ? dateFrom.slice(0, 7) : currentMonth()
  const isWholeMonth = dateFrom && dateTo && dateFrom === monthBounds(navMonth).start && dateTo === monthBounds(navMonth).end
  const goMonth = (delta) => {
    const { start, end } = monthBounds(shiftMonth(navMonth, delta))
    setDateFrom(start)
    setDateTo(end)
  }

  // "입고 내역" 목록과 아래 누적 입고액/결제액 요약이 함께 이 기간을 따른다.
  const filteredBatches = batches.filter((b) => {
    const d = rowDateStr(b)
    return (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo)
  })

  // 기간과 상관없이 전체 명세표·결제로 짝을 지어야, 기간을 바꿔도 결제됨 표시가 흔들리지 않는다.
  const paidIds = paidBatchIds(batches, payments)

  const undatedPayments = ledger.undatedPayments

  const handleAddPayment = async () => {
    const amount = Number(paymentAmount)
    if (!paymentAmount || !Number.isFinite(amount) || amount <= 0 || !supabase) {
      setError('결제 금액을 0보다 크게 입력하세요.')
      return
    }
    if (!paymentDate) {
      setError('결제일을 등록해 주세요.')
      return
    }
    setSavingPayment(true)
    setError('')
    const { error: err } = await supabase.from('vendor_payments').insert({
      store_code: store.code,
      vendor_id: vendorId,
      amount,
      paid_date: paymentDate,
      memo: paymentMemo.trim() || null,
    })
    setSavingPayment(false)
    if (err) {
      setError(err.message)
      return
    }
    setPaymentAmount('')
    setPaymentDate(todayStr())
    setPaymentMemo('')
    setDataKey((k) => k + 1)
  }

  // 이미 저장된, 결제일 없는 결제 기록에 날짜를 채워 넣는다.
  const handleSetPaymentDate = async (paymentId) => {
    const date = paymentDateEdits[paymentId]
    if (!date || !supabase) return
    setSavingPaymentDateId(paymentId)
    setError('')
    const { error: err } = await supabase.from('vendor_payments').update({ paid_date: date }).eq('id', paymentId)
    setSavingPaymentDateId(null)
    if (err) {
      setError(err.message)
      return
    }
    setDataKey((k) => k + 1)
  }

  // 명세표 대조에서 찾은 빠진 결제를, 사장님이 확인한 결제일로 등록한다.
  const handleRegisterIssuePayment = async (issue) => {
    if (!supabase) return
    const date = issueDates[issue.batchId] ?? issue.toDate
    if (!date || date < issue.fromDate || date > issue.toDate) {
      setError(`결제일은 ${issue.fromDate} ~ ${issue.toDate} 사이여야 ${issue.statementDate} 명세표 잔액과 맞아요.`)
      return
    }
    setRegisteringIssueId(issue.batchId)
    setError('')
    const { error: err } = await supabase.from('vendor_payments').insert({
      store_code: store.code,
      vendor_id: vendorId,
      amount: -issue.amount,
      paid_date: date,
      memo: '명세표 잔액 대조로 등록',
    })
    setRegisteringIssueId(null)
    if (err) {
      setError(err.message)
      return
    }
    setDataKey((k) => k + 1)
  }

  const saveOpeningBalance = async (balance) => {
    setSavingOpeningBalance(true)
    setError('')
    const { error: err } = await supabase.from('vendor_opening_balances').upsert(
      { store_code: store.code, vendor_id: vendorId, as_of_date: LEDGER_START, balance },
      { onConflict: 'vendor_id,as_of_date' },
    )
    setSavingOpeningBalance(false)
    if (err) {
      setError(err.message)
      return
    }
    setDataKey((k) => k + 1)
  }

  // 첫 명세표부터 장부와 다르면 시작 잔액이 틀린 것일 수 있어, 명세표에 맞게 고칠 수 있게 한다.
  const handleFixOpening = (issue) => {
    if (!supabase) return
    saveOpeningBalance(ledger.opening + issue.amount)
  }

  const handlePayBatch = async () => {
    if (!payBatchTarget || !supabase) return
    setPayingBatch(true)
    setError('')
    const { error: err } = await recordBatchPayment({ storeCode: store.code, vendorId, batch: payBatchTarget })
    setPayingBatch(false)
    if (err) {
      setError(err.message)
      return
    }
    setPayBatchTarget(null)
    setDataKey((k) => k + 1)
  }

  const handleDeletePayment = async () => {
    if (!deletePaymentTarget || !supabase) return
    setDeletingPayment(true)
    setError('')

    const { error: err } = await supabase.from('vendor_payments').delete().eq('id', deletePaymentTarget.id)
    setDeletingPayment(false)
    if (err) {
      setError(err.message)
      return
    }

    setDeletePaymentTarget(null)
    setDataKey((k) => k + 1)
  }

  const handleSaveOpeningBalance = () => {
    const balance = Number(startBalanceInput)
    if (startBalanceInput === '' || !Number.isFinite(balance) || !supabase) {
      setError('장부 시작 잔액을 숫자로 입력하세요.')
      return
    }
    saveOpeningBalance(balance)
  }

  // "부가세 별도" 거래처는 명세표의 "금액"이 공급가액만이고 부가세를 더해야 진짜 합계가 되는
  // 곳(예: 디안반찬광)을 위한 설정. 켜두면 명세표 합계 검증·미지급금·원가계산이 모두 그 방식에
  // 맞춰진다.
  const handleToggleVatSeparate = async (e) => {
    const next = e.target.checked
    if (!supabase || !vendor) return
    setSavingVatSeparate(true)
    setError('')
    const { error: err } = await supabase.from('vendors').update({ vat_separate: next }).eq('id', vendorId)
    setSavingVatSeparate(false)
    if (err) {
      setError(err.message)
      return
    }
    setVendor((v) => ({ ...v, vat_separate: next }))
  }

  // 명세표(전표) 삭제 시 그에 딸린 품목별 단가·수량·금액(invoices)까지 함께 지운다.
  const handleDeleteBatch = async () => {
    if (!deleteTarget || !supabase) return
    setDeleting(true)
    setError('')

    const { error: itemsErr } = await supabase.from('invoices').delete().eq('batch_id', deleteTarget.id)
    if (itemsErr) {
      setDeleting(false)
      setError(itemsErr.message)
      return
    }

    const { error: batchErr } = await supabase.from('invoice_batches').delete().eq('id', deleteTarget.id)
    setDeleting(false)
    if (batchErr) {
      setError(batchErr.message)
      return
    }

    // 보관해 둔 원본 사진도 함께 지운다 (최선 노력 — 실패해도 명세표 삭제 자체는 이미 끝난 뒤).
    if (deleteTarget.photo_path) {
      supabase.storage
        .from('invoice-photos')
        .remove([deleteTarget.photo_path])
        .then(({ error: removeErr }) => {
          if (removeErr) console.error(removeErr)
        })
    }

    setDeleteTarget(null)
    setDataKey((k) => k + 1)
  }

  const photoUrl = (photoPath) => supabase.storage.from('invoice-photos').getPublicUrl(photoPath).data.publicUrl

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/vendors')}>
          ← 거래처 목록
        </button>
        <h1>{vendor?.name ?? '거래처'}</h1>
        <p className="subtitle">{store.name} · 입고·결제 내역과 미지급금</p>
      </div>

      {!supabase && <p className="hint">Supabase가 설정되지 않았습니다.</p>}
      {loading && <p className="hint">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}

      {!loading && supabase && vendor && (
        <>
          <div className="field">
            <label className="toggle-row">
              <input type="checkbox" checked={!!vendor.vat_separate} onChange={handleToggleVatSeparate} disabled={savingVatSeparate} />
              <span>부가세 별도 거래처 (명세표의 "금액"이 공급가액만이고, 부가세를 더해야 진짜 합계가 돼요)</span>
            </label>
          </div>

          <div className="cost-summary">
            <div className="cost-summary-row">
              <span>현재 미지급금 (장부)</span>
              <strong className={liveBalance > 0 ? 'alert-up' : liveBalance < 0 ? 'alert-down' : ''}>{fmt(liveBalance)}원</strong>
            </div>
          </div>
          <p className="hint">
            장부 시작 잔액({addDays(LEDGER_START, -1)} 기준)에 그 뒤 입고를 더하고 직접 입력한 결제를 뺀 금액이에요.
          </p>

          {!ledger.hasOpening && (
            <div className="price-alert-box">
              <p className="price-alert-title">장부 시작 잔액을 아직 안 넣었어요</p>
              <p className="hint">
                {addDays(LEDGER_START, -1)}까지 남아 있던 잔액을 아래에 넣어주세요. 지금은 0원부터 계산했어요.
              </p>
            </div>
          )}
          <div className="field">
            <label htmlFor="startBalance">장부 시작 잔액 ({addDays(LEDGER_START, -1)} 기준 잔액)</label>
            <AmountInput
              id="startBalance"
              className="input"
              value={startBalanceInput}
              onChange={setStartBalanceInput}
              placeholder="예: 6,000,000"
            />
            {openingSuggestion && (
              <p className="hint">
                제안 {fmt(openingSuggestion.amount)}원 · {openingSuggestion.source}{' '}
                <button
                  type="button"
                  className="link-btn"
                  style={{ marginTop: 0 }}
                  onClick={() => setStartBalanceInput(String(Math.round(openingSuggestion.amount)))}
                >
                  이 값 넣기
                </button>
              </p>
            )}
          </div>
          <button type="button" className="btn-secondary" onClick={handleSaveOpeningBalance} disabled={savingOpeningBalance}>
            {savingOpeningBalance ? '저장 중...' : '시작 잔액 저장'}
          </button>

          {undatedPayments.length > 0 && (
            <p className="error-text">
              날짜 없는 결제 기록 {undatedPayments.length}건은 장부에서 빠져 있어요. 아래 결제 내역에서 결제일을 넣어주세요.
            </p>
          )}

          {issues.map((issue) => {
            const gap = Math.abs(issue.amount)
            return (
              <div key={issue.batchId} className="price-alert-box price-alert-box-danger">
                <p className="price-alert-title">
                  ⚠️ {issue.statementDate} 명세표 잔액과 장부가 {fmt(gap)}원 달라요
                </p>
                <p className="hint">
                  명세표 전잔액 {fmt(issue.statementBalance)}원 · 장부 {fmt(issue.ledgerBalance)}원
                </p>
                {issue.amount < 0 && issue.canRegisterPayment && (
                  <>
                    <p className="hint">
                      {issue.fromDate} ~ {issue.toDate} 사이에 {fmt(gap)}원 결제를 빠뜨린 것 같아요. 실제 결제일을 고르고
                      등록하세요.
                    </p>
                    <div className="invoice-form">
                      <input
                        type="date"
                        className="input"
                        min={issue.fromDate}
                        max={issue.toDate}
                        value={issueDates[issue.batchId] ?? issue.toDate}
                        onChange={(e) => setIssueDates((prev) => ({ ...prev, [issue.batchId]: e.target.value }))}
                        aria-label="빠진 결제의 결제일"
                      />
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => handleRegisterIssuePayment(issue)}
                        disabled={registeringIssueId === issue.batchId}
                      >
                        {registeringIssueId === issue.batchId ? '등록 중...' : '결제로 등록'}
                      </button>
                    </div>
                  </>
                )}
                {issue.amount > 0 && (
                  <p className="hint">
                    명세표 잔액이 장부보다 많아요. 입고를 빠뜨렸거나, 결제를 실제보다 많이(중복으로) 입력했는지 확인해 주세요.
                  </p>
                )}
                {issue.amount < 0 && !issue.canRegisterPayment && !issue.isFirst && (
                  <p className="hint">같은 날 명세표끼리 잔액이 달라요. 명세표 잔액 입력이 맞는지 확인해 주세요.</p>
                )}
                {issue.isFirst && (
                  <>
                    <p className="hint">
                      장부 시작 잔액이 틀렸을 수도 있어요. 시작 잔액을 {fmt(ledger.opening + issue.amount)}원으로 고치면 이
                      명세표와 맞아요.
                    </p>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => handleFixOpening(issue)}
                      disabled={savingOpeningBalance}
                    >
                      시작 잔액을 {fmt(ledger.opening + issue.amount)}원으로 고치기
                    </button>
                  </>
                )}
              </div>
            )
          })}

          <h2 className="section-title">기간 원장</h2>
          <div className="month-nav">
            <button
              type="button"
              className="chip"
              onClick={() => goMonth(-1)}
              disabled={navMonth <= LEDGER_START_MONTH}
              aria-label="이전 달"
            >
              ◀
            </button>
            <strong>{isWholeMonth ? monthLabel(navMonth) : '직접 지정한 기간'}</strong>
            <button type="button" className="chip" onClick={() => goMonth(1)} aria-label="다음 달">
              ▶
            </button>
          </div>
          <div className="date-range">
            <input
              type="date"
              className="input"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value)
                e.target.blur()
              }}
              aria-label="시작일"
            />
            <span className="date-range-sep">~</span>
            <input
              type="date"
              className="input"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value)
                e.target.blur()
              }}
              aria-label="종료일"
            />
          </div>
          <div className="cost-summary">
            <div className="cost-summary-row">
              <span>이월 잔액 ({addDays(periodStart, -1)}까지)</span>
              <strong>{fmt(periodLedger.carryOver)}원</strong>
            </div>
            <div className="cost-summary-row">
              <span>입고</span>
              <strong>+ {fmt(periodLedger.invoiced)}원</strong>
            </div>
            <div className="cost-summary-row">
              <span>결제</span>
              <strong>− {fmt(periodLedger.paid)}원</strong>
            </div>
            <div className="cost-summary-row">
              <span>기간 말 잔액</span>
              <strong className={periodLedger.ending > 0 ? 'alert-up' : ''}>{fmt(periodLedger.ending)}원</strong>
            </div>
          </div>
          <p className="hint">
            아래 입고 내역도 이 기간 기준이에요. {LEDGER_START} 이전 날짜는 장부 시작일부터 계산해요.
          </p>

          <h2 className="section-title">월별 원장</h2>
          <div className="ledger-table-wrap">
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>월</th>
                  <th>이월</th>
                  <th>입고</th>
                  <th>결제</th>
                  <th>잔액</th>
                </tr>
              </thead>
              <tbody>
                {monthlyLedger.map((row) => (
                  <tr key={row.month}>
                    <td>{Number(row.month.slice(5))}월</td>
                    <td>{fmt(row.carryOver)}</td>
                    <td>{fmt(row.invoiced)}</td>
                    <td>{fmt(row.paid)}</td>
                    <td>{fmt(row.ending)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="section-title">결제 입력</h2>
          <p className="hint">결제할 때마다 입력해 주세요. 장부의 미지급금은 입력한 결제로만 줄어요.</p>
          <div className="field">
            <label htmlFor="paymentAmount">결제 금액</label>
            <AmountInput
              id="paymentAmount"
              className="input"
              value={paymentAmount}
              onChange={setPaymentAmount}
              placeholder="예: 200,000"
            />
            {liveBalance > 0 && (
              <div className="preset-row" style={{ marginTop: 8 }}>
                <button type="button" className="chip" onClick={() => setPaymentAmount(String(Math.round(liveBalance)))}>
                  잔액 전액 ({fmt(liveBalance)}원)
                </button>
              </div>
            )}
          </div>
          <div className="field">
            <label htmlFor="paymentDate">결제일 (필수)</label>
            <input
              id="paymentDate"
              className="input"
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="paymentMemo">메모</label>
            <input
              id="paymentMemo"
              className="input"
              value={paymentMemo}
              onChange={(e) => setPaymentMemo(e.target.value)}
              placeholder="예: 계좌이체"
            />
            <div className="preset-row" style={{ marginTop: 8 }}>
              {PAYMENT_MEMO_PRESETS.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`chip${paymentMemo === m ? ' chip-active' : ''}`}
                  onClick={() => setPaymentMemo(m)}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            className="btn-primary"
            onClick={handleAddPayment}
            disabled={savingPayment || !paymentAmount || !paymentDate}
          >
            {savingPayment ? '저장 중...' : '결제 기록 추가'}
          </button>

          <h2 className="section-title">결제 내역 ({payments.length}건)</h2>
          {payments.length === 0 && <p className="hint">아직 결제 기록이 없습니다.</p>}
          {undatedPayments.length > 0 && (
            <p className="hint">날짜 없는 결제 기록이 {undatedPayments.length}건 있어요. 등록해 주세요.</p>
          )}
          <ul className="history-list">
            {payments.map((p) => (
              <li key={p.id} className="history-row">
                <div className="history-row-main">
                  {p.paid_date ? (
                    <span className="history-item">{p.paid_date}</span>
                  ) : (
                    <span className="history-item" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="date"
                        className="input"
                        style={{ width: 'auto' }}
                        value={paymentDateEdits[p.id] ?? ''}
                        onChange={(e) => setPaymentDateEdits((prev) => ({ ...prev, [p.id]: e.target.value }))}
                        aria-label="결제일 등록"
                      />
                      <button
                        type="button"
                        className="link-btn"
                        style={{ marginTop: 0 }}
                        onClick={() => handleSetPaymentDate(p.id)}
                        disabled={!paymentDateEdits[p.id] || savingPaymentDateId === p.id}
                      >
                        {savingPaymentDateId === p.id ? '저장 중...' : '등록'}
                      </button>
                    </span>
                  )}
                  <div className="history-row-main-end">
                    <span>{Math.round(Number(p.amount)).toLocaleString()}원</span>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="결제 기록 삭제"
                      onClick={() => setDeletePaymentTarget(p)}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                {p.memo && (
                  <div className="history-row-sub">
                    <span>{p.memo}</span>
                  </div>
                )}

                {deletePaymentTarget?.id === p.id && (
                  <div className="price-alert-box price-alert-box-danger">
                    <p className="price-alert-title">이 결제 기록을 삭제할까요?</p>
                    <p className="hint">잘못 입력한 결제 기록만 지워지고, 되돌릴 수 없어요.</p>
                    <div className="invoice-form">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setDeletePaymentTarget(null)}
                        disabled={deletingPayment}
                      >
                        취소
                      </button>
                      <button type="button" className="btn-primary" onClick={handleDeletePayment} disabled={deletingPayment}>
                        {deletingPayment ? '삭제 중...' : '삭제'}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>

          <h2 className="section-title">입고 내역 ({filteredBatches.length}건)</h2>
          {batches.length === 0 && <p className="hint">아직 입고 내역이 없습니다.</p>}
          {batches.length > 0 && filteredBatches.length === 0 && (
            <p className="hint">이 기간에 입고 내역이 없습니다.</p>
          )}

          <ul className="history-list">
            {filteredBatches.map((batch) => (
              <li key={batch.id} className="history-row">
                <div className="history-row-main">
                  <span className="history-item">{batch.invoice_date ?? '날짜 미입력'}</span>
                  <div className="history-row-main-end">
                    <span>{Math.round(Number(batch.total_amount)).toLocaleString()}원</span>
                    {paidIds.has(batch.id) ? (
                      <span className="paid-badge">✓ 결제됨</span>
                    ) : (
                      canRecordBatchPayment(batch) && (
                        <button type="button" className="link-btn" onClick={() => setPayBatchTarget(batch)}>
                          결제완료
                        </button>
                      )
                    )}
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() =>
                        navigate(`/invoices/edit/${batch.id}`, { state: { returnDateRange: { dateFrom, dateTo } } })
                      }
                    >
                      수정
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="명세표 삭제"
                      onClick={() => setDeleteTarget(batch)}
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {payBatchTarget?.id === batch.id && (
                  <div className="price-alert-box">
                    <p className="price-alert-title">
                      {Math.round(Number(batch.total_amount)).toLocaleString()}원을 {batch.invoice_date} 결제로 기록할까요?
                    </p>
                    <p className="hint">입고 때 "바로 결제 완료"를 체크한 것과 똑같이 결제 기록이 남아요.</p>
                    <div className="invoice-form">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setPayBatchTarget(null)}
                        disabled={payingBatch}
                      >
                        취소
                      </button>
                      <button type="button" className="btn-primary" onClick={handlePayBatch} disabled={payingBatch}>
                        {payingBatch ? '저장 중...' : '확인'}
                      </button>
                    </div>
                  </div>
                )}

                {deleteTarget?.id === batch.id && (
                  <div className="price-alert-box price-alert-box-danger">
                    <p className="price-alert-title">이 명세표를 삭제할까요?</p>
                    <p className="hint">딸린 품목별 단가·수량·금액도 모두 함께 삭제되고, 되돌릴 수 없어요.</p>
                    <div className="invoice-form">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setDeleteTarget(null)}
                        disabled={deleting}
                      >
                        취소
                      </button>
                      <button type="button" className="btn-primary" onClick={handleDeleteBatch} disabled={deleting}>
                        {deleting ? '삭제 중...' : '삭제'}
                      </button>
                    </div>
                  </div>
                )}

                {hasBalanceInfo(batch) && (
                  <div className="history-row-sub">
                    {batch.statement_balance != null && (
                      <span>전잔액 {Math.round(Number(batch.statement_balance)).toLocaleString()}원</span>
                    )}
                    <span>
                      {batch.current_balance != null ? '현잔액' : '입고 반영 후'} {Math.round(endingBalanceOf(batch)).toLocaleString()}원
                    </span>
                  </div>
                )}
                {batch.photo_path && (
                  <div className="inventory-row-actions">
                    <a
                      className="link-btn"
                      href={photoUrl(batch.photo_path)}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      📷 원본 사진 보기
                    </a>
                  </div>
                )}
                {batch.invoices?.length > 0 && (
                  <ul className="batch-items">
                    {batch.invoices.map((row) => (
                      <li key={row.id} className="batch-item-row">
                        <span>{row.item_name}</span>
                        <span>
                          {row.quantity != null && `${row.quantity} · `}
                          {row.unit_price != null &&
                            `단가 ${Number(row.unit_price).toLocaleString()}원${row.unit ? `/${UNIT_LABELS[row.unit] ?? row.unit}` : ''} · `}
                          {row.amount != null && `${Number(row.amount).toLocaleString()}원`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
