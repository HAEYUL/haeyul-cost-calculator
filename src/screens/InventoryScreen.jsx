import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'

const UNIT_LABELS = { g: 'g', kg: 'kg', ea: '개', other: '기타' }
const NO_UNIT_KEY = 'none'

function stockKey(itemName, unit) {
  return `${itemName}||${unit ?? ''}`
}

export default function InventoryScreen() {
  const { store } = useStore()
  const navigate = useNavigate()

  const [rows, setRows] = useState([])
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
      supabase.from('invoices').select('item_name, unit, quantity').eq('store_code', store.code),
      supabase.from('stock_usage').select('item_name, unit, used_qty').eq('store_code', store.code),
    ]).then(([invoicesRes, usageRes]) => {
      const err = invoicesRes.error || usageRes.error
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }

      const stock = new Map()
      const ensure = (itemName, unit) => {
        const key = stockKey(itemName, unit)
        if (!stock.has(key)) stock.set(key, { itemName, unit, received: 0, used: 0 })
        return stock.get(key)
      }

      for (const row of invoicesRes.data ?? []) {
        if (row.quantity == null) continue
        ensure(row.item_name, row.unit).received += Number(row.quantity)
      }
      for (const row of usageRes.data ?? []) {
        ensure(row.item_name, row.unit).used += Number(row.used_qty)
      }

      const list = [...stock.values()]
        .map((r) => ({ ...r, current: r.received - r.used }))
        .sort((a, b) => a.itemName.localeCompare(b.itemName))

      setRows(list)
      setLoading(false)
    })
  }, [store])

  if (!store) return null

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/menu')}>
          ← 메인 메뉴
        </button>
        <h1>재고 관리</h1>
        <p className="subtitle">{store.name} · 입고량에서 사용량을 뺀 현재고예요</p>
      </div>

      {!supabase && <p className="hint">Supabase가 설정되지 않았습니다.</p>}
      {loading && <p className="hint">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}
      {!loading && !error && rows.length === 0 && <p className="hint">입고 내역이 있어야 재고를 계산할 수 있어요.</p>}

      <ul className="history-list">
        {rows.map((r) => (
          <li key={stockKey(r.itemName, r.unit)} className="history-row">
            <button
              type="button"
              className="cost-row-btn"
              onClick={() => navigate(`/inventory/${encodeURIComponent(r.itemName)}/${r.unit ?? NO_UNIT_KEY}`)}
            >
              <div className="history-row-main">
                <span className="history-item">{r.itemName}</span>
                <span className={r.current < 0 ? 'alert-up' : ''}>
                  {r.current.toLocaleString()}
                  {r.unit ? UNIT_LABELS[r.unit] ?? r.unit : ''}
                </span>
              </div>
              <div className="history-row-sub">
                <span>입고 {r.received.toLocaleString()}</span>
                <span>사용 {r.used.toLocaleString()}</span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
