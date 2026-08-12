import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'

export default function PriceAlertsScreen() {
  const { store } = useStore()
  const navigate = useNavigate()
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!store) navigate('/', { replace: true })
  }, [store, navigate])

  useEffect(() => {
    if (!store || !supabase) return
    setLoading(true)
    setError('')
    supabase
      .from('price_changes')
      .select('id, vendor, item_name, previous_price, new_price, changed_at')
      .eq('store_code', store.code)
      .order('changed_at', { ascending: false })
      .then(({ data, error: err }) => {
        if (err) setError(err.message)
        else setAlerts(data ?? [])
        setLoading(false)
      })
  }, [store])

  if (!store) return null

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/invoices')}>
          ← 입고 입력
        </button>
        <h1>단가 변동 알림함</h1>
        <p className="subtitle">{store.name} · 단가가 바뀐 품목 모음</p>
      </div>

      {!supabase && <p className="hint">Supabase가 설정되지 않았습니다.</p>}
      {loading && <p className="hint">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}
      {!loading && !error && supabase && alerts.length === 0 && (
        <p className="hint">아직 단가가 변동된 품목이 없습니다.</p>
      )}

      <ul className="history-list">
        {alerts.map((a) => {
          const prev = Number(a.previous_price)
          const next = Number(a.new_price)
          const diff = next - prev
          const pct = prev !== 0 ? (diff / prev) * 100 : null
          const up = diff > 0

          return (
            <li key={a.id} className="history-row">
              <div className="history-row-main">
                <span className="history-vendor">{a.vendor}</span>
                <span className="history-item">{a.item_name}</span>
              </div>
              <div className={up ? 'alert-up' : 'alert-down'}>
                {prev.toLocaleString()}원 → {next.toLocaleString()}원
                {pct !== null && ` (${up ? '▲' : '▼'}${Math.abs(pct).toFixed(1)}%)`}
              </div>
              <div className="history-row-sub">
                <span>{new Date(a.changed_at).toLocaleDateString('ko-KR')}</span>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
