import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const UNIT_LABELS = { g: 'g', kg: 'kg', ea: '개', other: '기타' }

export default function InvoiceHistory({ storeCode, refreshKey }) {
  const [invoices, setInvoices] = useState([])
  const [selectedVendor, setSelectedVendor] = useState('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supabase) return
    setLoading(true)
    setError('')
    supabase
      .from('invoices')
      .select('id, vendor, item_name, quantity, unit_price, unit, amount, invoice_date, created_at')
      .eq('store_code', storeCode)
      .order('created_at', { ascending: false })
      .then(({ data, error: err }) => {
        if (err) setError(err.message)
        else setInvoices(data ?? [])
        setLoading(false)
      })
  }, [storeCode, refreshKey])

  if (!supabase) {
    return <p className="hint">Supabase가 설정되지 않아 저장된 내역을 볼 수 없습니다.</p>
  }

  const vendors = [...new Set(invoices.map((row) => row.vendor))]
  const filtered = selectedVendor === 'all' ? invoices : invoices.filter((row) => row.vendor === selectedVendor)

  return (
    <div className="history">
      <div className="history-header">
        <h2>저장된 입고 내역</h2>
        {vendors.length > 0 && (
          <select className="select" value={selectedVendor} onChange={(e) => setSelectedVendor(e.target.value)}>
            <option value="all">전체 거래처</option>
            {vendors.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        )}
      </div>

      {loading && <p className="hint">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}
      {!loading && !error && filtered.length === 0 && <p className="hint">저장된 입고 내역이 없습니다.</p>}

      <ul className="history-list">
        {filtered.map((row) => (
          <li key={row.id} className="history-row">
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
        ))}
      </ul>
    </div>
  )
}
