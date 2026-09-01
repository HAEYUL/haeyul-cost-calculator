import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'

const UNIT_LABELS = { g: 'g', kg: 'kg', ea: '개', other: '기타' }

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

  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentDate, setPaymentDate] = useState('')
  const [paymentMemo, setPaymentMemo] = useState('')
  const [savingPayment, setSavingPayment] = useState(false)

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
          'id, invoice_date, total_amount, statement_balance, created_at, invoices(id, item_name, quantity, unit_price, unit, amount)',
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
    ]).then(([vendorRes, batchesRes, paymentsRes]) => {
      const err = vendorRes.error || batchesRes.error || paymentsRes.error
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }
      setVendor(vendorRes.data)
      setBatches(batchesRes.data ?? [])
      setPayments(paymentsRes.data ?? [])
      setLoading(false)
    })
  }, [store, vendorId, dataKey])

  if (!store) return null

  const totalAmount = batches.reduce((sum, b) => sum + Number(b.total_amount), 0)
  const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0)

  // 미지급금은 결제 기록 기반 계산 대신, 가장 최근 명세표에 인쇄된 잔액을 우선 보여준다.
  // batches는 이미 최신순으로 정렬돼 있으니 잔액이 기록된 첫 항목을 찾으면 된다.
  const latestBatchWithBalance = batches.find((b) => b.statement_balance != null)

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
          <div className="cost-summary">
            <div className="cost-summary-row">
              <span>미지급금{latestBatchWithBalance ? ` (${latestBatchWithBalance.invoice_date ?? '날짜 미입력'} 명세표 기준)` : ''}</span>
              {latestBatchWithBalance ? (
                <strong className={Number(latestBatchWithBalance.statement_balance) > 0 ? 'alert-up' : ''}>
                  {Math.round(Number(latestBatchWithBalance.statement_balance)).toLocaleString()}원
                </strong>
              ) : (
                <span className="hint">명세표 잔액 정보 없음</span>
              )}
            </div>
            <div className="cost-summary-row">
              <span>누적 입고액</span>
              <strong>{Math.round(totalAmount).toLocaleString()}원</strong>
            </div>
            <div className="cost-summary-row">
              <span>누적 결제액</span>
              <strong>{Math.round(totalPaid).toLocaleString()}원</strong>
            </div>
          </div>

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
                  <span>{Math.round(Number(p.amount)).toLocaleString()}원</span>
                </div>
                {p.memo && (
                  <div className="history-row-sub">
                    <span>{p.memo}</span>
                  </div>
                )}
              </li>
            ))}
          </ul>

          <h2 className="section-title">입고 내역 ({batches.length}건)</h2>
          {batches.length === 0 && <p className="hint">아직 입고 내역이 없습니다.</p>}

          <ul className="history-list">
            {batches.map((batch) => (
              <li key={batch.id} className="history-row">
                <div className="history-row-main">
                  <span className="history-item">{batch.invoice_date ?? '날짜 미입력'}</span>
                  <span>{Math.round(Number(batch.total_amount)).toLocaleString()}원</span>
                </div>
                {batch.statement_balance != null && (
                  <div className="history-row-sub">
                    <span>명세표 잔액 {Math.round(Number(batch.statement_balance)).toLocaleString()}원</span>
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
