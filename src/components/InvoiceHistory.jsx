import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { UNIT_LABELS } from '../lib/units'
import { rowDateStr } from '../lib/rowDateStr'
import { canRecordBatchPayment, paidBatchIds, recordBatchPayment } from '../lib/batchPayment'
import { useHistoryState } from '../hooks/usePageHistoryState'

function todayStr() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function rowDateValue(row) {
  return new Date(row.invoice_date ?? row.created_at).getTime()
}

export default function InvoiceHistory({ storeCode, refreshKey }) {
  const navigate = useNavigate()
  const [batches, setBatches] = useState([])
  const [legacyRows, setLegacyRows] = useState([])
  const [payments, setPayments] = useState([])
  const [payTarget, setPayTarget] = useState(null)
  const [paying, setPaying] = useState(false)
  const [paymentsKey, setPaymentsKey] = useState(0)
  const [selectedVendor, setSelectedVendor] = useHistoryState('historyVendor', 'all')
  const [dateFrom, setDateFrom] = useHistoryState('historyDateFrom', () => todayStr())
  const [dateTo, setDateTo] = useHistoryState('historyDateTo', () => todayStr())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supabase) return
    setLoading(true)
    setError('')
    Promise.all([
      supabase
        .from('invoice_batches')
        .select('id, invoice_date, total_amount, created_at, vendors(id, name), invoices(id, item_name, quantity, unit_price, unit, amount)')
        .eq('store_code', storeCode)
        .order('created_at', { ascending: false }),
      supabase
        .from('invoices')
        .select('id, vendor, item_name, quantity, unit_price, unit, amount, invoice_date, created_at')
        .eq('store_code', storeCode)
        .is('batch_id', null)
        .order('created_at', { ascending: false }),
    ]).then(([batchesRes, legacyRes]) => {
      const err = batchesRes.error || legacyRes.error
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }
      setBatches(batchesRes.data ?? [])
      setLegacyRows(legacyRes.data ?? [])
      setLoading(false)
    })
  }, [storeCode, refreshKey])

  // 결제 기록은 [결제완료]를 누를 때마다 다시 불러와야 해서, 명세표 목록과 따로 불러온다.
  useEffect(() => {
    if (!supabase) return
    supabase
      .from('vendor_payments')
      .select('vendor_id, amount, paid_date')
      .eq('store_code', storeCode)
      .then(({ data, error: err }) => {
        if (err) {
          setError(err.message)
          return
        }
        setPayments(data ?? [])
      })
  }, [storeCode, refreshKey, paymentsKey])

  const handlePay = async () => {
    if (!payTarget) return
    setPaying(true)
    setError('')
    const { error: err } = await recordBatchPayment({
      storeCode,
      vendorId: payTarget.vendors.id,
      batch: payTarget,
    })
    setPaying(false)
    if (err) {
      setError(err.message)
      return
    }
    setPayTarget(null)
    setPaymentsKey((k) => k + 1)
  }

  // 기간·거래처 필터는 이 화면의 방문 기록에 남아 있어, 수정 화면에서 저장·취소하고 돌아오면 그대로 보인다.
  const openEdit = (batchId) => navigate(`/invoices/edit/${batchId}`)

  if (!supabase) {
    return <p className="hint">Supabase가 설정되지 않아 저장된 내역을 볼 수 없습니다.</p>
  }

  const vendorNames = [
    ...new Set([...batches.map((b) => b.vendors?.name).filter(Boolean), ...legacyRows.map((r) => r.vendor)]),
  ]
  const paidIds = paidBatchIds(batches, payments)
  const inVendor = (name) => selectedVendor === 'all' || name === selectedVendor
  const inRange = (row) => {
    const d = rowDateStr(row)
    return (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo)
  }

  // 전표(batch)와 옛 낱개 기록(legacy)을 하나로 합쳐서 입고일 기준으로 최신순 정렬한다.
  const rows = [
    ...batches.filter((b) => inVendor(b.vendors?.name) && inRange(b)).map((b) => ({ kind: 'batch', ...b })),
    ...legacyRows.filter((r) => inVendor(r.vendor) && inRange(r)).map((r) => ({ kind: 'legacy', ...r })),
  ].sort((a, b) => rowDateValue(b) - rowDateValue(a))

  return (
    <div className="history">
      <div className="history-header">
        <h2>저장된 입고 내역</h2>
        {vendorNames.length > 0 && (
          <select className="select" value={selectedVendor} onChange={(e) => setSelectedVendor(e.target.value)}>
            <option value="all">전체 거래처</option>
            {vendorNames.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        )}
      </div>

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
      <p className="hint">기본으로 오늘 입고분만 보여요. 기간을 바꾸면 다른 날짜도 볼 수 있어요.</p>

      {loading && <p className="hint">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}
      {!loading && !error && rows.length === 0 && <p className="hint">이 기간에 저장된 입고 내역이 없습니다.</p>}

      <ul className="history-list">
        {rows.map((row) =>
          row.kind === 'batch' ? (
            <li key={`batch-${row.id}`} className="history-row">
              <div className="history-row-main">
                <span className="history-vendor">{row.vendors?.name ?? '거래처 미지정'}</span>
                <div className="history-row-main-end">
                  <span>{Math.round(Number(row.total_amount)).toLocaleString()}원</span>
                  {paidIds.has(row.id) ? (
                    <span className="paid-badge">✓ 결제됨</span>
                  ) : (
                    row.vendors?.id &&
                    canRecordBatchPayment(row) && (
                      <button type="button" className="link-btn" onClick={() => setPayTarget(row)}>
                        결제완료
                      </button>
                    )
                  )}
                  <button type="button" className="link-btn" onClick={() => openEdit(row.id)}>
                    수정
                  </button>
                </div>
              </div>
              <div className="history-row-sub">
                {row.invoice_date && <span>{row.invoice_date}</span>}
                <span>품목 {row.invoices?.length ?? 0}개</span>
              </div>
              {payTarget?.id === row.id && (
                <div className="price-alert-box">
                  <p className="price-alert-title">
                    {Math.round(Number(row.total_amount)).toLocaleString()}원을 {row.invoice_date} 결제로 기록할까요?
                  </p>
                  <p className="hint">입고 때 "바로 결제 완료"를 체크한 것과 똑같이 결제 기록이 남아요.</p>
                  <div className="invoice-form">
                    <button type="button" className="btn-secondary" onClick={() => setPayTarget(null)} disabled={paying}>
                      취소
                    </button>
                    <button type="button" className="btn-primary" onClick={handlePay} disabled={paying}>
                      {paying ? '저장 중...' : '확인'}
                    </button>
                  </div>
                </div>
              )}
              {row.invoices?.length > 0 && (
                <ul className="batch-items">
                  {row.invoices.map((item) => (
                    <li key={item.id} className="batch-item-row">
                      <span>{item.item_name}</span>
                      <span>
                        {item.quantity != null && `${item.quantity} · `}
                        {item.unit_price != null &&
                          `단가 ${Number(item.unit_price).toLocaleString()}원${item.unit ? `/${UNIT_LABELS[item.unit] ?? item.unit}` : ''} · `}
                        {item.amount != null && `${Number(item.amount).toLocaleString()}원`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ) : (
            <li key={`legacy-${row.id}`} className="history-row">
              <div className="history-row-main">
                <span className="history-vendor">{row.vendor}</span>
                <span className="history-item">{row.item_name}</span>
              </div>
              <div className="history-row-sub">
                {row.quantity != null && <span>{row.quantity}개</span>}
                {row.unit_price != null && (
                  <span>
                    단가 {Number(row.unit_price).toLocaleString()}원{row.unit ? `/${UNIT_LABELS[row.unit] ?? row.unit}` : ''}
                  </span>
                )}
                {row.amount != null && <span>{Number(row.amount).toLocaleString()}원</span>}
                {row.invoice_date && <span>{row.invoice_date}</span>}
              </div>
            </li>
          ),
        )}
      </ul>
    </div>
  )
}
