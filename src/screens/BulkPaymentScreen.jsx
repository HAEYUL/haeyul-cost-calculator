import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import AmountInput from '../components/AmountInput'
import { groupByVendor, makeLedger, todayStr } from '../lib/vendorLedger'

const PAYMENT_MEMO_PRESETS = ['계좌이체', '카드', '현금']
const fmt = (n) => Math.round(Number(n)).toLocaleString()

// 결제일 일괄 입력: 15일·말일처럼 여러 거래처에 한꺼번에 송금한 날, 거래처별 송금액을 한 화면에서
// 적고 한 번에 저장한다. 미지급이 남은 거래처만 보여주므로 즉시 결제 거래처(항상 0원)는 저절로 빠진다.
export default function BulkPaymentScreen() {
  const { store } = useStore()
  const navigate = useNavigate()

  const [rows, setRows] = useState([])
  const [existingPayments, setExistingPayments] = useState([])
  const [confirmDuplicates, setConfirmDuplicates] = useState(false)
  const [amounts, setAmounts] = useState({})
  const [paidDate, setPaidDate] = useState(() => todayStr())
  const [memo, setMemo] = useState('계좌이체')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!store) navigate('/', { replace: true })
  }, [store, navigate])

  // 송금액·결제일을 바꾸면 "이미 입력된 결제" 확인은 다시 받는다.
  useEffect(() => {
    setConfirmDuplicates(false)
  }, [amounts, paidDate])

  useEffect(() => {
    if (!store || !supabase) return
    setLoading(true)
    setError('')
    Promise.all([
      supabase.from('vendors').select('id, name').eq('store_code', store.code),
      supabase
        .from('invoice_batches')
        .select('id, vendor_id, total_amount, invoice_date, statement_balance, current_balance, created_at')
        .eq('store_code', store.code),
      supabase.from('vendor_payments').select('vendor_id, amount, paid_date').eq('store_code', store.code),
      supabase.from('vendor_opening_balances').select('vendor_id, as_of_date, balance').eq('store_code', store.code),
    ]).then(([vendorsRes, batchesRes, paymentsRes, openingRes]) => {
      const err = vendorsRes.error || batchesRes.error || paymentsRes.error || openingRes.error
      setLoading(false)
      if (err) {
        setError(err.message)
        return
      }
      const batchesByVendor = groupByVendor(batchesRes.data)
      const paymentsByVendor = groupByVendor(paymentsRes.data)
      const openingByVendor = groupByVendor(openingRes.data)
      const nextRows = (vendorsRes.data ?? [])
        .map((v) => ({
          ...v,
          balance: makeLedger({
            batches: batchesByVendor.get(v.id),
            payments: paymentsByVendor.get(v.id),
            openings: openingByVendor.get(v.id),
          }).current,
        }))
        .filter((v) => Math.round(v.balance) >= 1)
        .sort((a, b) => b.balance - a.balance)
      setRows(nextRows)
      setExistingPayments(paymentsRes.data ?? [])
    })
  }, [store])

  if (!store) return null

  const amountOf = (id) => Number(amounts[id] || 0)
  const setAmount = (id, value) => setAmounts((prev) => ({ ...prev, [id]: value }))
  const fillAll = () => setAmounts(Object.fromEntries(rows.map((r) => [r.id, String(Math.round(r.balance))])))
  const clearAll = () => setAmounts({})

  const filledRows = rows.filter((r) => amountOf(r.id) > 0)
  const total = filledRows.reduce((sum, r) => sum + amountOf(r.id), 0)
  // 같은 결제일에 같은 금액 결제가 이미 있는 거래처(두 번 저장하려는 것일 수 있음)
  const isDuplicate = (r) =>
    existingPayments.some(
      (p) => p.vendor_id === r.id && p.paid_date === paidDate && Math.round(Number(p.amount)) === Math.round(amountOf(r.id)),
    )
  const duplicateRows = filledRows.filter(isDuplicate)

  const handleSave = async () => {
    if (!supabase || filledRows.length === 0) return
    if (!paidDate) {
      setError('결제일을 넣어주세요.')
      return
    }
    if (duplicateRows.length > 0 && !confirmDuplicates) {
      setConfirmDuplicates(true)
      return
    }
    setSaving(true)
    setError('')
    const { error: err } = await supabase.from('vendor_payments').insert(
      filledRows.map((r) => ({
        store_code: store.code,
        vendor_id: r.id,
        amount: amountOf(r.id),
        paid_date: paidDate,
        memo: memo.trim() || null,
      })),
    )
    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }
    navigate('/vendors')
  }

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/vendors')}>
          ← 거래처 관리
        </button>
        <h1>일괄 결제 입력</h1>
        <p className="subtitle">{store.name} · 15일·말일 송금을 거래처별로 한 번에 기록해요</p>
      </div>

      <div className="field">
        <label htmlFor="bulkPaidDate">결제일</label>
        <input
          id="bulkPaidDate"
          type="date"
          className="input"
          value={paidDate}
          onChange={(e) => setPaidDate(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="bulkMemo">메모</label>
        <input id="bulkMemo" className="input" value={memo} onChange={(e) => setMemo(e.target.value)} />
        <div className="preset-row" style={{ marginTop: 8 }}>
          {PAYMENT_MEMO_PRESETS.map((m) => (
            <button key={m} type="button" className={`chip${memo === m ? ' chip-active' : ''}`} onClick={() => setMemo(m)}>
              {m}
            </button>
          ))}
        </div>
      </div>

      {!supabase && <p className="hint">Supabase가 설정되지 않았습니다.</p>}
      {loading && <p className="hint">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}
      {!loading && !error && rows.length === 0 && <p className="hint">미지급이 남은 거래처가 없어요.</p>}

      {rows.length > 0 && (
        <>
          <div className="preset-row" style={{ marginTop: 16 }}>
            <button type="button" className="chip" onClick={fillAll}>
              모두 전액
            </button>
            <button type="button" className="chip" onClick={clearAll}>
              모두 지우기
            </button>
          </div>
          <p className="hint">송금액을 비워 둔 거래처는 저장되지 않고 미지급이 그대로 남아요.</p>

          <ul className="history-list">
            {rows.map((r) => {
              const remaining = r.balance - amountOf(r.id)
              return (
                <li key={r.id} className="history-row">
                  <div className="history-row-main">
                    <span className="history-item">{r.name}</span>
                    <span className="alert-up">미지급 {fmt(r.balance)}원</span>
                  </div>
                  <div className="bulk-payment-input">
                    <AmountInput
                      className="input"
                      value={amounts[r.id] ?? ''}
                      onChange={(value) => setAmount(r.id, value)}
                      placeholder="송금액"
                      aria-label={`${r.name} 송금액`}
                    />
                    <button type="button" className="chip" onClick={() => setAmount(r.id, String(Math.round(r.balance)))}>
                      전액
                    </button>
                  </div>
                  <div className="history-row-sub">
                    <span className={remaining < 0 ? 'alert-up' : ''}>
                      남는 잔액 {fmt(remaining)}원{remaining < 0 ? ' (미지급보다 많이 보냈어요)' : ''}
                    </span>
                    {amountOf(r.id) > 0 && isDuplicate(r) && (
                      <span className="alert-up">⚠️ 같은 날 같은 금액 결제가 이미 있어요</span>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>

          <div className="cost-summary">
            <div className="cost-summary-row">
              <span>송금 합계 ({filledRows.length}곳)</span>
              <strong>{fmt(total)}원</strong>
            </div>
          </div>
          {confirmDuplicates && duplicateRows.length > 0 && (
            <div className="price-alert-box price-alert-box-danger">
              <p className="price-alert-title">이미 입력된 결제 같아요 ({duplicateRows.map((r) => r.name).join(', ')})</p>
              <p className="hint">
                {paidDate}에 같은 금액 결제 기록이 이미 있어요. 실제로 두 번 송금했으면 아래 버튼을 다시 눌러 저장하고,
                아니면 그 거래처 송금액을 지워주세요.
              </p>
            </div>
          )}
          <button
            type="button"
            className="btn-primary"
            onClick={handleSave}
            disabled={saving || filledRows.length === 0 || !paidDate}
          >
            {saving
              ? '저장 중...'
              : confirmDuplicates && duplicateRows.length > 0
                ? '그래도 모두 저장'
                : `${filledRows.length}곳 결제 모두 저장`}
          </button>
        </>
      )}
    </div>
  )
}
