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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

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
        .select('id, invoice_date, total_amount, created_at, invoices(id, item_name, quantity, unit_price, unit, amount)')
        .eq('store_code', store.code)
        .eq('vendor_id', vendorId)
        .order('invoice_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false }),
    ]).then(([vendorRes, batchesRes]) => {
      const err = vendorRes.error || batchesRes.error
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }
      setVendor(vendorRes.data)
      setBatches(batchesRes.data ?? [])
      setLoading(false)
    })
  }, [store, vendorId])

  if (!store) return null

  const totalAmount = batches.reduce((sum, b) => sum + Number(b.total_amount), 0)

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/vendors')}>
          ← 거래처 목록
        </button>
        <h1>{vendor?.name ?? '거래처'}</h1>
        <p className="subtitle">{store.name} · 날짜별 입고 내역</p>
      </div>

      {!supabase && <p className="hint">Supabase가 설정되지 않았습니다.</p>}
      {loading && <p className="hint">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}

      {!loading && supabase && (
        <>
          <div className="cost-summary">
            <div className="cost-summary-row">
              <span>누적 입고액</span>
              <strong>{Math.round(totalAmount).toLocaleString()}원</strong>
            </div>
          </div>

          <h2 className="section-title">입고 내역 ({batches.length}건)</h2>
          {batches.length === 0 && <p className="hint">아직 입고 내역이 없습니다.</p>}

          <ul className="history-list">
            {batches.map((batch) => (
              <li key={batch.id} className="history-row">
                <div className="history-row-main">
                  <span className="history-item">{batch.invoice_date ?? '날짜 미입력'}</span>
                  <span>{Math.round(Number(batch.total_amount)).toLocaleString()}원</span>
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
          </ul>
        </>
      )}
    </div>
  )
}
