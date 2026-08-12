import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { latestInvoiceInfoByItem, computeMenuCost } from '../lib/costCalc'

function ratioClass(ratio) {
  if (ratio == null) return 'hint'
  if (ratio >= 40) return 'alert-up'
  if (ratio <= 25) return 'alert-down'
  return ''
}

export default function CostScreen() {
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
      supabase.from('recipes').select('menu_name, ingredient_name, amount_g').eq('store_code', store.code),
      supabase.from('ingredient_mapping').select('recipe_ingredient_name, invoice_item_name').eq('store_code', store.code),
      supabase.from('invoices').select('item_name, unit_price, unit, created_at').eq('store_code', store.code),
      supabase.from('menu_prices').select('menu_name, selling_price').eq('store_code', store.code),
    ]).then(([recipesRes, mappingRes, invoicesRes, pricesRes]) => {
      const err = recipesRes.error || mappingRes.error || invoicesRes.error || pricesRes.error
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }

      const mappingByIngredient = new Map(
        (mappingRes.data ?? []).map((m) => [m.recipe_ingredient_name, m.invoice_item_name]),
      )
      const infoByItem = latestInvoiceInfoByItem(invoicesRes.data ?? [])
      const sellingByMenu = new Map((pricesRes.data ?? []).map((p) => [p.menu_name, Number(p.selling_price)]))

      const byMenu = new Map()
      for (const r of recipesRes.data ?? []) {
        if (!byMenu.has(r.menu_name)) byMenu.set(r.menu_name, [])
        byMenu.get(r.menu_name).push(r)
      }

      const computed = [...byMenu.entries()].map(([menuName, recipeRows]) => {
        const { totalCost, hasMissing } = computeMenuCost({ recipeRows, mappingByIngredient, infoByItem })
        const sellingPrice = sellingByMenu.get(menuName) ?? null
        const ratio = sellingPrice ? (totalCost / sellingPrice) * 100 : null
        return { menuName, totalCost, hasMissing, sellingPrice, ratio }
      })

      computed.sort((a, b) => {
        if (a.ratio == null && b.ratio == null) return a.menuName.localeCompare(b.menuName)
        if (a.ratio == null) return 1
        if (b.ratio == null) return -1
        return b.ratio - a.ratio
      })

      setRows(computed)
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
        <h1>원가 확인</h1>
        <p className="subtitle">{store.name} · 원가율이 높은 메뉴부터 정렬했어요</p>
      </div>

      {!supabase && <p className="hint">Supabase가 설정되지 않았습니다.</p>}
      {loading && <p className="hint">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}
      {!loading && !error && supabase && rows.length === 0 && <p className="hint">저장된 레시피가 없습니다.</p>}

      <ul className="history-list">
        {rows.map((row) => (
          <li key={row.menuName} className="history-row">
            <button
              type="button"
              className="cost-row-btn"
              onClick={() => navigate(`/cost/${encodeURIComponent(row.menuName)}`)}
            >
              <div className="history-row-main">
                <span className="history-item">{row.menuName}</span>
                <span className={ratioClass(row.ratio)}>
                  {row.ratio != null ? `${row.ratio.toFixed(1)}%` : '판매가 미입력'}
                </span>
              </div>
              <div className="history-row-sub">
                <span>원가 {Math.round(row.totalCost).toLocaleString()}원</span>
                {row.sellingPrice != null && <span>판매가 {row.sellingPrice.toLocaleString()}원</span>}
                {row.hasMissing && <span className="cost-warning">일부 재료 매칭/단가 필요</span>}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
