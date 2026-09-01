import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const UNIT_LABELS = { g: 'g', kg: 'kg', ea: '개', other: '기타' }

export default function InvoiceHistory({ storeCode, refreshKey }) {
  const [batches, setBatches] = useState([])
  const [legacyRows, setLegacyRows] = useState([])
  const [selectedVendor, setSelectedVendor] = useState('all')
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
  const filteredBatches =
    selectedVendor === 'all' ? batches : batches.filter((b) => b.vendors?.name === selectedVendor)
  const filteredLegacy =
    selectedVendor === 'all' ? legacyRows : legacyRows.filter((r) => r.vendor === selectedVendor)

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

      {loading && <p className="hint">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}
      {!loading && !error && filteredBatches.length === 0 && filteredLegacy.length === 0 && (
        <p className="hint">저장된 입고 내역이 없습니다.</p>
      )}

      <ul className="history-list">
        {filteredBatches.map((batch) => (
          <li key={batch.id} className="history-row">
            <div className="history-row-main">
              <span className="history-vendor">{batch.vendors?.name ?? '거래처 미지정'}</span>
              <span>{Math.round(Number(batch.total_amount)).toLocaleString()}원</span>
            </div>
            <div className="history-row-sub">
              {batch.invoice_date && <span>{batch.invoice_date}</span>}
              <span>품목 {batch.invoices?.length ?? 0}개</span>
            </div>
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

        {filteredLegacy.map((row) => (
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
