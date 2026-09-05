import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'

// 명세표상 입고일을 기준으로 정렬·표시한다. 입고일이 없는(예전) 기록만 저장한 시각으로 대신한다.
function rowDateValue(row) {
  return new Date(row.invoice_date ?? row.changed_at).getTime()
}

// 이 물품(invoiceItemName)이 어떤 메뉴 원가에 영향을 주는지 찾는다. 재료 매칭으로 물품 →
// 재료명을 거꾸로 찾고, 그 재료를 직접 쓰는 메뉴/부재료를 찾고(1단계), 부재료라면 그걸 다시
// 쓰는 메뉴까지 한 단계 더 따라간다(2단계, A안: 부재료는 원재료만 쓰므로 이 정도면 충분하다).
function affectedMenus(invoiceItemName, { mappings, recipeRows, menuTypeByName }) {
  const ingredientNames = mappings
    .filter((m) => m.invoice_item_name === invoiceItemName)
    .map((m) => m.recipe_ingredient_name)
  if (ingredientNames.length === 0) return []

  const directMenus = new Set(
    recipeRows.filter((r) => !r.is_sub_recipe && ingredientNames.includes(r.ingredient_name)).map((r) => r.menu_name),
  )

  const result = new Set()
  for (const name of directMenus) {
    if (menuTypeByName.get(name) === 'sub') {
      for (const r of recipeRows) {
        if (r.is_sub_recipe && r.ingredient_name === name) result.add(r.menu_name)
      }
    } else {
      result.add(name)
    }
  }
  return [...result].sort((a, b) => a.localeCompare(b))
}

export default function PriceAlertsScreen() {
  const { store } = useStore()
  const navigate = useNavigate()
  const [alerts, setAlerts] = useState([])
  const [mappings, setMappings] = useState([])
  const [recipeRows, setRecipeRows] = useState([])
  const [menuTypeByName, setMenuTypeByName] = useState(new Map())
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
      supabase
        .from('price_changes')
        .select('id, vendor, item_name, previous_price, new_price, changed_at, invoice_date')
        .eq('store_code', store.code),
      supabase.from('ingredient_mapping').select('recipe_ingredient_name, invoice_item_name').eq('store_code', store.code),
      supabase.from('recipes').select('menu_name, ingredient_name, is_sub_recipe').eq('store_code', store.code),
      supabase.from('recipe_meta').select('menu_name, recipe_type').eq('store_code', store.code),
    ]).then(([alertsRes, mappingRes, recipesRes, metaRes]) => {
      const err = alertsRes.error || mappingRes.error || recipesRes.error || metaRes.error
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }
      setAlerts((alertsRes.data ?? []).sort((a, b) => rowDateValue(b) - rowDateValue(a)))
      setMappings(mappingRes.data ?? [])
      setRecipeRows(recipesRes.data ?? [])
      setMenuTypeByName(new Map((metaRes.data ?? []).map((m) => [m.menu_name, m.recipe_type])))
      setLoading(false)
    })
  }, [store])

  if (!store) return null

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <div className="screen-header-row">
          <button type="button" className="link-btn" onClick={() => navigate('/invoices')}>
            ← 입고 입력
          </button>
          <button type="button" className="link-btn" onClick={() => navigate('/price-trend')}>
            단가 추이 조회 →
          </button>
        </div>
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
          const menus = affectedMenus(a.item_name, { mappings, recipeRows, menuTypeByName })

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
                <span>{a.invoice_date ?? new Date(a.changed_at).toLocaleDateString('ko-KR')}</span>
              </div>
              {menus.length > 0 && (
                <p className="hint">연결된 메뉴 {menus.length}개 원가에 영향: {menus.join(', ')}</p>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
