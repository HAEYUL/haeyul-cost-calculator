import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const UNIT_LABELS = { g: 'g', kg: 'kg', ea: '개', other: '기타' }

function todayStr() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// 명세표에 적힌 입고일(invoice_date)을 우선 기준으로 삼고, 없는 옛 데이터만 저장 시각
// (created_at)의 날짜로 대신한다. 정렬·기간 필터 모두 이 기준을 따른다.
function rowDateStr(row) {
  if (row.invoice_date) return row.invoice_date
  const d = new Date(row.created_at)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function rowDateValue(row) {
  return new Date(row.invoice_date ?? row.created_at).getTime()
}

export default function InvoiceHistory({ storeCode, refreshKey }) {
  const [batches, setBatches] = useState([])
  const [legacyRows, setLegacyRows] = useState([])
  const [selectedVendor, setSelectedVendor] = useState('all')
  const [dateFrom, setDateFrom] = useState(todayStr())
  const [dateTo, setDateTo] = useState(todayStr())
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

  if (!supabase) {
    return <p className="hint">Supabase가 설정되지 않아 저장된 내역을 볼 수 없습니다.</p>
  }

  const vendorNames = [
    ...new Set([...batches.map((b) => b.vendors?.name).filter(Boolean), ...legacyRows.map((r) => r.vendor)]),
  ]
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
                <span>{Math.round(Number(row.total_amount)).toLocaleString()}원</span>
              </div>
              <div className="history-row-sub">
                {row.invoice_date && <span>{row.invoice_date}</span>}
                <span>품목 {row.invoices?.length ?? 0}개</span>
              </div>
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
