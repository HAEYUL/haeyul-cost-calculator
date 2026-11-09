import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { analyzeReorder, groupAlertsByVendor } from '../lib/reorderCalc'
import { loadReorderInputs } from '../lib/reorderData'

// 매니저 메인 화면: "오늘 주문할 거래처" 카드. 누르면 재주문 알림 화면(거래처별)으로 간다.
// 주문할 품목이 없으면 아무것도 그리지 않는다.
export default function ManagerReorderCard({ storeCode }) {
  const navigate = useNavigate()
  const [vendors, setVendors] = useState([])

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    loadReorderInputs(storeCode)
      .then((inputs) => {
        if (cancelled) return
        setVendors(groupAlertsByVendor(analyzeReorder(inputs.invoices, inputs).alerts))
      })
      .catch(() => !cancelled && setVendors([]))
    return () => {
      cancelled = true
    }
  }, [storeCode])

  if (vendors.length === 0) return null
  return (
    <div className="dashboard manager-reorder">
      <div className="cost-summary dashboard-card" onClick={() => navigate('/reorder-alerts')}>
        <p className="price-alert-title">🔔 오늘 주문할 거래처 {vendors.length}곳</p>
        <ul className="price-alert-list">
          {vendors.slice(0, 5).map((g) => (
            <li key={g.vendor} className={g.urgentCount > 0 ? 'alert-up' : 'cost-warning'}>
              <button
                type="button"
                className="reorder-vendor-link"
                onClick={(e) => {
                  e.stopPropagation()
                  navigate(`/reorder-alerts?vendor=${encodeURIComponent(g.vendor)}`)
                }}
              >
                {g.vendor} · {g.items.length}품목{g.urgentCount > 0 ? ` (급함 ${g.urgentCount})` : ''} ›
              </button>
            </li>
          ))}
        </ul>
        {vendors.length > 5 && <p className="hint">외 {vendors.length - 5}곳 더 보기 →</p>}
      </div>
    </div>
  )
}
