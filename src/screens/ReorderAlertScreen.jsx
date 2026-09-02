import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { computeReorderAlerts } from '../lib/reorderCalc'

const UNIT_LABELS = { g: 'g', kg: 'kg', ea: '개', other: '기타' }
const NO_UNIT_KEY = 'none'

function stockKey(itemName, unit) {
  return `${itemName}||${unit ?? ''}`
}

export default function ReorderAlertScreen() {
  const { store } = useStore()
  const navigate = useNavigate()

  const [alerts, setAlerts] = useState([])
  const [currentStockByKey, setCurrentStockByKey] = useState(new Map())
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
      supabase.from('invoices').select('item_name, unit, quantity, invoice_date').eq('store_code', store.code),
      supabase.from('stock_usage').select('item_name, unit, used_qty').eq('store_code', store.code),
      supabase.from('waste_records').select('item_name, unit, qty').eq('store_code', store.code),
      supabase.from('stock_adjustments').select('item_name, unit, delta').eq('store_code', store.code),
    ]).then(([invoicesRes, usageRes, wasteRes, adjustmentsRes]) => {
      const err = invoicesRes.error || usageRes.error || wasteRes.error || adjustmentsRes.error
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }

      const stock = new Map()
      const ensure = (itemName, unit) => {
        const key = stockKey(itemName, unit)
        if (!stock.has(key)) stock.set(key, 0)
        return key
      }
      for (const row of invoicesRes.data ?? []) {
        if (row.quantity == null) continue
        const key = ensure(row.item_name, row.unit)
        stock.set(key, stock.get(key) + Number(row.quantity))
      }
      for (const row of usageRes.data ?? []) {
        const key = ensure(row.item_name, row.unit)
        stock.set(key, stock.get(key) - Number(row.used_qty))
      }
      for (const row of wasteRes.data ?? []) {
        const key = ensure(row.item_name, row.unit)
        stock.set(key, stock.get(key) - Number(row.qty))
      }
      for (const row of adjustmentsRes.data ?? []) {
        const key = ensure(row.item_name, row.unit)
        stock.set(key, stock.get(key) + Number(row.delta))
      }

      setAlerts(computeReorderAlerts(invoicesRes.data ?? []))
      setCurrentStockByKey(stock)
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
        <h1>재주문 알림</h1>
        <p className="subtitle">{store.name} · 평소 주문 주기보다 오래된 품목을 알려드려요</p>
      </div>

      {!supabase && <p className="hint">Supabase가 설정되지 않았습니다.</p>}
      {loading && <p className="hint">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}
      {!loading && !error && supabase && alerts.length === 0 && (
        <p className="hint">
          지금은 재주문할 때가 지난 품목이 없어요. (같은 품목의 입고 기록이 3번 이상 쌓여야 주기를 계산할 수 있어요)
        </p>
      )}

      <ul className="history-list">
        {alerts.map((a) => {
          const key = stockKey(a.itemName, a.unit)
          const current = currentStockByKey.get(key)
          const unitLabel = a.unit ? UNIT_LABELS[a.unit] ?? a.unit : ''
          return (
            <li key={key} className="history-row">
              <button
                type="button"
                className="cost-row-btn"
                onClick={() => navigate(`/inventory/${encodeURIComponent(a.itemName)}/${a.unit ?? NO_UNIT_KEY}`)}
              >
                <div className="history-row-main">
                  <span className="history-item">{a.itemName}</span>
                  <span className={a.status === 'overdue' ? 'alert-up' : 'cost-warning'}>
                    {a.status === 'overdue' ? '⏰ 주문 시기 지남' : '슬슬 주문할 때'}
                  </span>
                </div>
                <div className="history-row-sub">
                  <span>평소 약 {Math.round(a.avgIntervalDays)}일마다 주문</span>
                  <span>마지막 입고 {Math.round(a.daysSinceLast)}일 전</span>
                  {current != null && (
                    <span>
                      현재고 {current.toLocaleString()}
                      {unitLabel}
                    </span>
                  )}
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
