import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'

const UNIT_LABELS = { g: 'g', kg: 'kg', ea: '개', other: '기타' }

// 명세표에 적힌 입고일(invoice_date)을 우선 기준으로 삼고, 없는 옛 데이터만 저장 시각
// (created_at)의 날짜로 대신한다.
function rowDateStr(row) {
  if (row.invoice_date) return row.invoice_date
  const d = new Date(row.created_at)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// 이번 달의 시작일~마지막 날짜 (기간 필터 기본값)
function monthRange() {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const start = `${y}-${String(m + 1).padStart(2, '0')}-01`
  const lastDay = new Date(y, m + 1, 0).getDate()
  const end = `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { start, end }
}

export default function VendorDetailScreen() {
  const { store } = useStore()
  const navigate = useNavigate()
  const { vendorId } = useParams()

  const [vendor, setVendor] = useState(null)
  const [batches, setBatches] = useState([])
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [dataKey, setDataKey] = useState(0)

  const defaultRange = monthRange()
  const [dateFrom, setDateFrom] = useState(defaultRange.start)
  const [dateTo, setDateTo] = useState(defaultRange.end)

  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentDate, setPaymentDate] = useState('')
  const [paymentMemo, setPaymentMemo] = useState('')
  const [savingPayment, setSavingPayment] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const [deletePaymentTarget, setDeletePaymentTarget] = useState(null)
  const [deletingPayment, setDeletingPayment] = useState(false)

  const [openingBalances, setOpeningBalances] = useState([])
  const [openingBalanceInput, setOpeningBalanceInput] = useState('')
  const [savingOpeningBalance, setSavingOpeningBalance] = useState(false)

  const [deleteOpeningBalanceTarget, setDeleteOpeningBalanceTarget] = useState(null)
  const [deletingOpeningBalance, setDeletingOpeningBalance] = useState(false)

  useEffect(() => {
    if (!store) navigate('/', { replace: true })
  }, [store, navigate])

  useEffect(() => {
    if (!store || !supabase) return
    setLoading(true)
    setError('')
    Promise.all([
      supabase.from('vendors').select('id, name').eq('id', vendorId).single(),
      supabase
        .from('invoice_batches')
        .select(
          'id, invoice_date, total_amount, statement_balance, photo_path, created_at, invoices(id, item_name, quantity, unit_price, unit, amount)',
        )
        .eq('store_code', store.code)
        .eq('vendor_id', vendorId)
        .order('invoice_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('vendor_payments')
        .select('id, amount, paid_date, memo, created_at')
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

  // 시작일이 바뀌면, 그 날짜로 정확히 저장해 둔 기초 잔액이 있으면 입력칸에 불러오고
  // 없으면 비운다(새로 입력하라는 뜻).
  useEffect(() => {
    const exact = openingBalances.find((b) => b.as_of_date === dateFrom)
    setOpeningBalanceInput(exact ? String(exact.balance) : '')
  }, [dateFrom, openingBalances])

  if (!store) return null

  // 미지급금(실시간) = "믿을 수 있는 기준 잔액(앵커)" + 그 이후 입고액 − 그 이후 결제액.
  // 앵커는 총잔액이 적힌 명세표 중 가장 최근 것을 우선 쓰고, 그런 명세표가 아직 없으면
  // 가장 최근 기초 잔액을 대신 쓴다(둘 다 없으면 0원부터 시작). batches는 이미 최신순 정렬이라
  // 앵커보다 인덱스가 앞선(=더 최근인) 명세표들이 "앵커 이후 입고"가 된다.
  // (위 미지급금은 기간 필터와 무관하게 항상 지금 이 순간 기준이다)
  const latestBatchWithBalanceIndex = batches.findIndex((b) => b.statement_balance != null)
  const latestBatchWithBalance = latestBatchWithBalanceIndex >= 0 ? batches[latestBatchWithBalanceIndex] : undefined
  const latestOpeningBalance = [...openingBalances].sort((a, b) => (a.as_of_date < b.as_of_date ? 1 : -1))[0]

  const anchorDate = latestBatchWithBalance ? rowDateStr(latestBatchWithBalance) : (latestOpeningBalance?.as_of_date ?? null)
  const anchorBalance = latestBatchWithBalance
    ? Number(latestBatchWithBalance.statement_balance)
    : latestOpeningBalance
      ? Number(latestOpeningBalance.balance)
      : 0

  const batchesSinceAnchor = latestBatchWithBalance ? batches.slice(0, latestBatchWithBalanceIndex) : batches
  const invoicedSinceAnchor = batchesSinceAnchor.reduce((sum, b) => sum + Number(b.total_amount), 0)

  // 앵커 이후 입력한 결제만 차감한다. 날짜를 안 넣은 결제는 최근에 입력한 것으로 보고 포함시킨다.
  const paymentsSinceAnchor = payments
    .filter((p) => !anchorDate || !p.paid_date || p.paid_date > anchorDate)
    .reduce((sum, p) => sum + Number(p.amount), 0)

  const liveBalance = anchorBalance + invoicedSinceAnchor - paymentsSinceAnchor

  // 가장 최근 두 명세표 잔액을 대조해서, 그 사이 기록된 입고·결제만으로 설명이 안 되면
  // (=기록이 빠졌을 수 있으면) 알려준다.
  const statementBatches = batches.filter((b) => b.statement_balance != null)
  let balanceMismatch = null
  if (statementBatches.length >= 2) {
    const newest = statementBatches[0]
    const previous = statementBatches[1]
    const newestIndex = batches.indexOf(newest)
    const previousIndex = batches.indexOf(previous)
    const previousDate = rowDateStr(previous)
    const newestDate = rowDateStr(newest)

    const between = batches.slice(newestIndex, previousIndex) // newest 포함, previous 미포함
    const invoicedBetween = between.reduce((sum, b) => sum + Number(b.total_amount), 0)
    const paidBetween = payments
      .filter((p) => (!p.paid_date || p.paid_date > previousDate) && (!p.paid_date || p.paid_date <= newestDate))
      .reduce((sum, p) => sum + Number(p.amount), 0)

    const expected = Number(previous.statement_balance) + invoicedBetween - paidBetween
    const actual = Number(newest.statement_balance)
    if (Math.round(expected) !== Math.round(actual)) {
      balanceMismatch = { newestDate, expected, actual, diff: actual - expected }
    }
  }

  // "입고 내역" 목록과 아래 누적 입고액/결제액 요약이 함께 이 기간을 따른다.
  const filteredBatches = batches.filter((b) => {
    const d = rowDateStr(b)
    return (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo)
  })

  const periodTotalAmount = filteredBatches.reduce((sum, b) => sum + Number(b.total_amount), 0)

  // 기초 잔액: 시작일 이하 기준일 중 가장 최근에 입력해 둔 이월 잔액을 찾는다.
  // (이 앱을 쓰기 전부터 있던 미지급 잔액을 반영하기 위함 — 안 넣었으면 0원으로 본다.)
  const effectiveOpeningBalance = openingBalances
    .filter((b) => b.as_of_date <= dateFrom)
    .sort((a, b) => (a.as_of_date < b.as_of_date ? 1 : -1))[0]

  // 결제액(추정) = 기초 잔액 + 기간 입고액 − 기간 종료일 시점의 미지급 잔액.
  // 기간 종료일 이전(포함)에 잔액이 기록된 가장 최근 명세표를 찾는다(batches는 이미 최신순 정렬).
  const balanceAtPeriodEnd = batches.find((b) => {
    const d = rowDateStr(b)
    return b.statement_balance != null && (!dateTo || d <= dateTo)
  })?.statement_balance
  const periodEstimatedPayment =
    balanceAtPeriodEnd != null
      ? (effectiveOpeningBalance ? Number(effectiveOpeningBalance.balance) : 0) + periodTotalAmount - Number(balanceAtPeriodEnd)
      : null

  const handleAddPayment = async () => {
    const amount = Number(paymentAmount)
    if (!paymentAmount || !Number.isFinite(amount) || amount <= 0 || !supabase) {
      setError('결제 금액을 0보다 크게 입력하세요.')
      return
    }
    setSavingPayment(true)
    setError('')
    const { error: err } = await supabase.from('vendor_payments').insert({
      store_code: store.code,
      vendor_id: vendorId,
      amount,
      paid_date: paymentDate || null,
      memo: paymentMemo.trim() || null,
    })
    setSavingPayment(false)
    if (err) {
      setError(err.message)
      return
    }
    setPaymentAmount('')
    setPaymentDate('')
    setPaymentMemo('')
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

  const handleSaveOpeningBalance = async () => {
    const balance = Number(openingBalanceInput)
    if (openingBalanceInput === '' || !Number.isFinite(balance) || !supabase) {
      setError('기초 잔액을 숫자로 입력하세요.')
      return
    }
    setSavingOpeningBalance(true)
    setError('')
    const { error: err } = await supabase.from('vendor_opening_balances').upsert(
      { store_code: store.code, vendor_id: vendorId, as_of_date: dateFrom, balance },
      { onConflict: 'vendor_id,as_of_date' },
    )
    setSavingOpeningBalance(false)
    if (err) {
      setError(err.message)
      return
    }
    setDataKey((k) => k + 1)
  }

  const handleDeleteOpeningBalance = async () => {
    if (!deleteOpeningBalanceTarget || !supabase) return
    setDeletingOpeningBalance(true)
    setError('')

    const { error: err } = await supabase.from('vendor_opening_balances').delete().eq('id', deleteOpeningBalanceTarget.id)
    setDeletingOpeningBalance(false)
    if (err) {
      setError(err.message)
      return
    }

    setDeleteOpeningBalanceTarget(null)
    setDataKey((k) => k + 1)
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

      {!loading && supabase && (
        <>
          <div className="date-range">
            <input
              type="date"
              className="input"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              aria-label="시작일"
            />
            <span className="date-range-sep">~</span>
            <input
              type="date"
              className="input"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              aria-label="종료일"
            />
          </div>
          <p className="hint">
            아래 누적 입고액·누적 결제액·입고 내역은 이 기간 기준이에요. 기본은 이번 달이고, 원하는 기간으로 바꿀 수 있어요.
          </p>

          <div className="field">
            <label htmlFor="openingBalance">기초 잔액 ({dateFrom} 이전 이월 미지급 잔액)</label>
            <input
              id="openingBalance"
              className="input"
              inputMode="decimal"
              value={openingBalanceInput}
              onChange={(e) => setOpeningBalanceInput(e.target.value)}
              placeholder="예: 6000000"
            />
          </div>
          <button type="button" className="btn-secondary" onClick={handleSaveOpeningBalance} disabled={savingOpeningBalance}>
            {savingOpeningBalance ? '저장 중...' : '기초 잔액 저장'}
          </button>
          <p className="hint">
            {effectiveOpeningBalance
              ? `${effectiveOpeningBalance.as_of_date} 기준으로 저장한 ${Math.round(Number(effectiveOpeningBalance.balance)).toLocaleString()}원을 기초 잔액으로 반영했어요.`
              : '아직 기초 잔액을 입력하지 않아 0원으로 계산했어요. 이 거래처와 이 앱을 쓰기 전부터 거래해오셨다면, 입력하면 아래 누적 결제액이 더 정확해져요.'}
          </p>

          {openingBalances.length > 0 && (
            <ul className="history-list">
              {openingBalances.map((b) => (
                <li key={b.id} className="history-row">
                  <div className="history-row-main">
                    <span className="history-item">{b.as_of_date} 기준</span>
                    <div className="history-row-main-end">
                      <span>{Math.round(Number(b.balance)).toLocaleString()}원</span>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="기초 잔액 삭제"
                        onClick={() => setDeleteOpeningBalanceTarget(b)}
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  {deleteOpeningBalanceTarget?.id === b.id && (
                    <div className="price-alert-box price-alert-box-danger">
                      <p className="price-alert-title">이 기초 잔액을 삭제할까요?</p>
                      <p className="hint">잘못 입력한 기초 잔액만 지워지고, 되돌릴 수 없어요.</p>
                      <div className="invoice-form">
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => setDeleteOpeningBalanceTarget(null)}
                          disabled={deletingOpeningBalance}
                        >
                          취소
                        </button>
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={handleDeleteOpeningBalance}
                          disabled={deletingOpeningBalance}
                        >
                          {deletingOpeningBalance ? '삭제 중...' : '삭제'}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="cost-summary">
            <div className="cost-summary-row">
              <span>
                미지급금
                {anchorDate && (
                  <>
                    {' '}
                    ({anchorDate} {latestBatchWithBalance ? '명세표' : '기초 잔액'} 기준 + 이후 실시간 반영)
                  </>
                )}
              </span>
              <strong className={liveBalance > 0 ? 'alert-up' : liveBalance < 0 ? 'alert-down' : ''}>
                {Math.round(liveBalance).toLocaleString()}원
              </strong>
            </div>
            <div className="cost-summary-row">
              <span>누적 입고액(기간)</span>
              <strong>{Math.round(periodTotalAmount).toLocaleString()}원</strong>
            </div>
            <div className="cost-summary-row">
              <span>누적 결제액(추정, 기간)</span>
              {periodEstimatedPayment != null ? (
                <strong>{Math.round(periodEstimatedPayment).toLocaleString()}원</strong>
              ) : (
                <span className="hint">잔액 정보 없음</span>
              )}
            </div>
          </div>
          <p className="hint">
            미지급금은 가장 최근 명세표 잔액(또는 기초 잔액)에 그 이후의 입고·결제 기록을 실시간으로 반영한 값이에요.
            누적 결제액(추정, 기간)은 이것과 별개로, 기초 잔액 + 기간 입고액에서 기간 종료일 시점 미지급 잔액을 뺀
            참고용 추정치예요.
          </p>

          {balanceMismatch && (
            <div className="price-alert-box price-alert-box-danger">
              <p className="price-alert-title">⚠️ 결제 기록이 맞지 않으니 확인해 주세요.</p>
              <p className="hint">
                {balanceMismatch.newestDate} 명세표 잔액은 {Math.round(balanceMismatch.actual).toLocaleString()}
                원인데, 직전 명세표 잔액에 그 사이 입고·결제 기록을 반영하면{' '}
                {Math.round(balanceMismatch.expected).toLocaleString()}원이 나와요. (
                {balanceMismatch.diff > 0 ? '+' : ''}
                {Math.round(balanceMismatch.diff).toLocaleString()}원 차이)
              </p>
            </div>
          )}

          <h2 className="section-title">결제 입력</h2>
          <div className="field">
            <label htmlFor="paymentAmount">결제 금액</label>
            <input
              id="paymentAmount"
              className="input"
              inputMode="decimal"
              value={paymentAmount}
              onChange={(e) => setPaymentAmount(e.target.value)}
              placeholder="예: 200000"
            />
          </div>
          <div className="field">
            <label htmlFor="paymentDate">결제일</label>
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
          </div>
          <button type="button" className="btn-primary" onClick={handleAddPayment} disabled={savingPayment}>
            {savingPayment ? '저장 중...' : '결제 기록 추가'}
          </button>

          <h2 className="section-title">결제 내역 ({payments.length}건)</h2>
          {payments.length === 0 && <p className="hint">아직 결제 기록이 없습니다.</p>}
          <ul className="history-list">
            {payments.map((p) => (
              <li key={p.id} className="history-row">
                <div className="history-row-main">
                  <span className="history-item">{p.paid_date ?? '날짜 미입력'}</span>
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
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => navigate(`/invoices/edit/${batch.id}`)}
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

                {batch.statement_balance != null && (
                  <div className="history-row-sub">
                    <span>명세표 잔액 {Math.round(Number(batch.statement_balance)).toLocaleString()}원</span>
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
