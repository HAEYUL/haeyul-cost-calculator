import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { latestInvoiceInfoByItem, computeMenuCost, computeAllSubRecipeUnitCosts } from '../lib/costCalc'
import { computeReorderAlerts } from '../lib/reorderCalc'
import { UNIT_LABELS } from '../lib/units'
import { stockKey } from '../lib/stockKey'
import { rowDateStr } from '../lib/rowDateStr'
import { groupByVendor, makeLedger } from '../lib/vendorLedger'
import { MENU_SECTIONS } from '../data/menuSections'

const MARGIN_WARNING_RATIO = 40

// 알림 카드를 확인(X)했을 때 그 시점의 내용을 문자열로 남겨서, 다음에 열었을 때 내용이
// 같으면 계속 숨기고 달라지면 다시 보여주는 데 쓴다.
function makeSignature(parts) {
  return [...parts].sort().join('|')
}

// 이번 달의 [시작일, 다음 달 시작일) 범위
function monthBounds() {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const start = `${y}-${String(m + 1).padStart(2, '0')}-01`
  const next = new Date(y, m + 1, 1)
  const end = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`
  return { start, end }
}

export default function MainMenuScreen() {
  const { store, setStore } = useStore()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [totalBalance, setTotalBalance] = useState(0)
  const [monthTotal, setMonthTotal] = useState(0)
  const [negativeStockItems, setNegativeStockItems] = useState([])
  const [negativeStockCount, setNegativeStockCount] = useState(0)
  const [marginWarningMenus, setMarginWarningMenus] = useState([])
  const [marginWarningCount, setMarginWarningCount] = useState(0)
  const [reorderAlerts, setReorderAlerts] = useState([])
  const [signatures, setSignatures] = useState({})
  const [dismissals, setDismissals] = useState(new Map())

  useEffect(() => {
    if (!store) navigate('/', { replace: true })
  }, [store, navigate])

  useEffect(() => {
    if (!store || !supabase) return
    setLoading(true)
    setError('')
    Promise.all([
      supabase
        .from('invoice_batches')
        .select('vendor_id, total_amount, invoice_date, statement_balance, current_balance, created_at')
        .eq('store_code', store.code),
      supabase.from('vendor_payments').select('vendor_id, amount, paid_date').eq('store_code', store.code),
      supabase.from('vendor_opening_balances').select('vendor_id, as_of_date, balance').eq('store_code', store.code),
      supabase
        .from('invoices')
        .select('item_name, unit, quantity, unit_price, vat_included_unit_price, invoice_date, created_at')
        .eq('store_code', store.code),
      supabase.from('stock_usage').select('item_name, unit, used_qty').eq('store_code', store.code),
      supabase.from('waste_records').select('item_name, unit, qty').eq('store_code', store.code),
      supabase.from('stock_adjustments').select('item_name, unit, delta').eq('store_code', store.code),
      supabase.from('recipes').select('menu_name, ingredient_name, amount_g, is_sub_recipe').eq('store_code', store.code),
      supabase.from('recipe_meta').select('menu_name, recipe_type, yield_qty').eq('store_code', store.code),
      supabase
        .from('ingredient_mapping')
        .select('recipe_ingredient_name, invoice_item_name')
        .eq('store_code', store.code),
      supabase.from('menu_prices').select('menu_name, selling_price').eq('store_code', store.code),
      supabase.from('dashboard_dismissals').select('card_key, signature').eq('store_code', store.code),
    ]).then(
      ([
        batchesRes,
        paymentsRes,
        openingRes,
        invoicesRes,
        usageRes,
        wasteRes,
        adjustmentsRes,
        recipesRes,
        metaRes,
        mappingRes,
        pricesRes,
        dismissalsRes,
      ]) => {
      const err =
        batchesRes.error ||
        paymentsRes.error ||
        openingRes.error ||
        invoicesRes.error ||
        usageRes.error ||
        wasteRes.error ||
        adjustmentsRes.error ||
        recipesRes.error ||
        metaRes.error ||
        mappingRes.error ||
        pricesRes.error ||
        dismissalsRes.error
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }

      // 미지급금(전체 거래처 합계)과 이번 달 입고 총액. 거래처 목록·상세 화면과 같은 장부
      // 계산(장부 시작 잔액 + 입고 − 결제)을 써야 화면마다 숫자가 어긋나지 않는다.
      const { start: monthStart, end: monthEnd } = monthBounds()
      let monthSum = 0

      const batchesByVendor = groupByVendor(batchesRes.data)
      const paymentsByVendor = groupByVendor(paymentsRes.data)
      const openingByVendor = groupByVendor(openingRes.data)
      for (const b of batchesRes.data ?? []) {
        const dateStr = rowDateStr(b)
        if (dateStr >= monthStart && dateStr < monthEnd) {
          monthSum += Number(b.total_amount)
        }
      }

      let balanceSum = 0
      const vendorIds = new Set([...batchesByVendor.keys(), ...paymentsByVendor.keys(), ...openingByVendor.keys()])
      for (const vendorId of vendorIds) {
        balanceSum += makeLedger({
          batches: batchesByVendor.get(vendorId),
          payments: paymentsByVendor.get(vendorId),
          openings: openingByVendor.get(vendorId),
        }).current
      }

      // 재고 부족(마이너스) 품목
      const stock = new Map()
      const ensure = (itemName, unit) => {
        const key = stockKey(itemName, unit)
        if (!stock.has(key)) stock.set(key, { itemName, unit, received: 0, used: 0, wasted: 0, adjusted: 0 })
        return stock.get(key)
      }
      for (const row of invoicesRes.data ?? []) {
        if (row.quantity == null) continue
        ensure(row.item_name, row.unit).received += Number(row.quantity)
      }
      for (const row of usageRes.data ?? []) {
        ensure(row.item_name, row.unit).used += Number(row.used_qty)
      }
      for (const row of wasteRes.data ?? []) {
        ensure(row.item_name, row.unit).wasted += Number(row.qty)
      }
      for (const row of adjustmentsRes.data ?? []) {
        ensure(row.item_name, row.unit).adjusted += Number(row.delta)
      }
      const negativeStock = [...stock.values()]
        .map((r) => ({ ...r, current: r.received - r.used - r.wasted + r.adjusted }))
        .filter((r) => r.current < 0)
        .sort((a, b) => a.current - b.current)

      // 원가율이 높은(마진이 낮은) 메뉴
      const mappingByIngredient = new Map(
        (mappingRes.data ?? []).map((m) => [m.recipe_ingredient_name, m.invoice_item_name]),
      )
      const infoByItem = latestInvoiceInfoByItem(invoicesRes.data ?? [])
      const sellingByMenu = new Map((pricesRes.data ?? []).map((p) => [p.menu_name, Number(p.selling_price)]))
      const rowsByMenu = new Map()
      for (const r of recipesRes.data ?? []) {
        if (!rowsByMenu.has(r.menu_name)) rowsByMenu.set(r.menu_name, [])
        rowsByMenu.get(r.menu_name).push(r)
      }
      const menuMeta = (metaRes.data ?? []).filter((m) => m.recipe_type === 'menu')
      const subMeta = (metaRes.data ?? []).filter((m) => m.recipe_type === 'sub')
      const subRecipeRowsByMenu = new Map(subMeta.map((m) => [m.menu_name, rowsByMenu.get(m.menu_name) ?? []]))
      const subRecipeMetaByMenu = new Map(subMeta.map((m) => [m.menu_name, m]))
      const subUnitCostByName = computeAllSubRecipeUnitCosts({
        subRecipeRowsByMenu,
        subRecipeMetaByMenu,
        mappingByIngredient,
        infoByItem,
      })
      const marginWarnings = menuMeta
        .map((meta) => {
          const recipeRows = rowsByMenu.get(meta.menu_name) ?? []
          const { totalCost } = computeMenuCost({ recipeRows, mappingByIngredient, infoByItem, subUnitCostByName })
          const sellingPrice = sellingByMenu.get(meta.menu_name) ?? null
          const ratio = sellingPrice ? (totalCost / sellingPrice) * 100 : null
          return { menuName: meta.menu_name, ratio }
        })
        .filter((m) => m.ratio != null && m.ratio >= MARGIN_WARNING_RATIO)
        .sort((a, b) => b.ratio - a.ratio)

      const reorderAlertsResult = computeReorderAlerts(invoicesRes.data ?? [])

      setTotalBalance(balanceSum)
      setMonthTotal(monthSum)
      setNegativeStockItems(negativeStock.slice(0, 5))
      setNegativeStockCount(negativeStock.length)
      setMarginWarningMenus(marginWarnings.slice(0, 5))
      setMarginWarningCount(marginWarnings.length)
      setReorderAlerts(reorderAlertsResult)

      setSignatures({
        balance: makeSignature([`${Math.round(balanceSum)}`, `${Math.round(monthSum)}`]),
        negativeStock: makeSignature(negativeStock.map((r) => `${stockKey(r.itemName, r.unit)}:${r.current}`)),
        marginWarning: makeSignature(marginWarnings.map((m) => `${m.menuName}:${m.ratio.toFixed(1)}`)),
        reorder: makeSignature(reorderAlertsResult.map((a) => `${stockKey(a.itemName, a.unit)}:${a.status}`)),
      })
      setDismissals(new Map((dismissalsRes.data ?? []).map((d) => [d.card_key, d.signature])))
      setLoading(false)
    })
  }, [store])

  const handleDismiss = async (e, cardKey) => {
    e.stopPropagation()
    if (!supabase) return
    const signature = signatures[cardKey] ?? ''
    setDismissals((prev) => new Map(prev).set(cardKey, signature))
    const { error: err } = await supabase
      .from('dashboard_dismissals')
      .upsert(
        { store_code: store.code, card_key: cardKey, signature, dismissed_at: new Date().toISOString() },
        { onConflict: 'store_code,card_key' },
      )
    if (err) setError(err.message)
  }

  const isDismissed = (cardKey) => signatures[cardKey] != null && dismissals.get(cardKey) === signatures[cardKey]

  if (!store) return null

  return (
    <div className="screen screen-menu">
      <div className="menu-topbar">
        <button
          type="button"
          className="link-btn menu-change-store"
          onClick={() => {
            setStore(null)
            navigate('/')
          }}
        >
          ← 매장 변경
        </button>
        <div className="store-badge">{store.name}</div>
      </div>

      {!loading && !error && supabase && (
        <div className="dashboard">
          {!isDismissed('balance') && (
            <div className="cost-summary dashboard-card" onClick={() => navigate('/vendors')}>
              <button
                type="button"
                className="dashboard-card-dismiss"
                aria-label="미지급금 알림 닫기"
                onClick={(e) => handleDismiss(e, 'balance')}
              >
                ✕
              </button>
              <div className="cost-summary-row">
                <span>전체 미지급금</span>
                <strong className={totalBalance > 0 ? 'alert-up' : ''}>
                  {Math.round(totalBalance).toLocaleString()}원
                </strong>
              </div>
              <div className="cost-summary-row">
                <span>이번 달 입고 총액</span>
                <strong>{Math.round(monthTotal).toLocaleString()}원</strong>
              </div>
            </div>
          )}

          {negativeStockCount > 0 && !isDismissed('negativeStock') && (
            <div className="price-alert-box price-alert-box-danger dashboard-card" onClick={() => navigate('/inventory')}>
              <button
                type="button"
                className="dashboard-card-dismiss"
                aria-label="재고 부족 알림 닫기"
                onClick={(e) => handleDismiss(e, 'negativeStock')}
              >
                ✕
              </button>
              <p className="price-alert-title">⚠️ 재고 부족 품목 {negativeStockCount}개</p>
              <ul className="price-alert-list">
                {negativeStockItems.map((r) => (
                  <li key={stockKey(r.itemName, r.unit)}>
                    {r.itemName}: {r.current.toLocaleString()}
                    {r.unit ? UNIT_LABELS[r.unit] ?? r.unit : ''}
                  </li>
                ))}
              </ul>
              {negativeStockCount > negativeStockItems.length && (
                <p className="hint">외 {negativeStockCount - negativeStockItems.length}개 더 보기 →</p>
              )}
            </div>
          )}

          {marginWarningCount > 0 && !isDismissed('marginWarning') && (
            <div className="price-alert-box price-alert-box-danger dashboard-card" onClick={() => navigate('/cost')}>
              <button
                type="button"
                className="dashboard-card-dismiss"
                aria-label="원가율 경고 닫기"
                onClick={(e) => handleDismiss(e, 'marginWarning')}
              >
                ✕
              </button>
              <p className="price-alert-title">⚠️ 원가율 {MARGIN_WARNING_RATIO}% 이상 메뉴 {marginWarningCount}개</p>
              <ul className="price-alert-list">
                {marginWarningMenus.map((m) => (
                  <li key={m.menuName}>
                    {m.menuName}: {m.ratio.toFixed(1)}%
                  </li>
                ))}
              </ul>
              {marginWarningCount > marginWarningMenus.length && (
                <p className="hint">외 {marginWarningCount - marginWarningMenus.length}개 더 보기 →</p>
              )}
            </div>
          )}

          {reorderAlerts.length > 0 && !isDismissed('reorder') && (
            <div className="cost-summary dashboard-card" onClick={() => navigate('/reorder-alerts')}>
              <button
                type="button"
                className="dashboard-card-dismiss"
                aria-label="재주문 알림 닫기"
                onClick={(e) => handleDismiss(e, 'reorder')}
              >
                ✕
              </button>
              <p className="price-alert-title">🔔 재주문할 때가 된 품목 {reorderAlerts.length}개</p>
              <ul className="price-alert-list">
                {reorderAlerts.slice(0, 5).map((a) => (
                  <li key={stockKey(a.itemName, a.unit)} className={a.status === 'overdue' ? 'alert-up' : 'cost-warning'}>
                    {a.itemName}
                  </li>
                ))}
              </ul>
              {reorderAlerts.length > 5 && <p className="hint">외 {reorderAlerts.length - 5}개 더 보기 →</p>}
            </div>
          )}
        </div>
      )}

      <div className="menu-list">
        {MENU_SECTIONS.map((section) => (
          <div key={section.title} className={`menu-group menu-group-${section.area}`}>
            <p className="menu-group-title">
              <span aria-hidden="true">{section.icon}</span> {section.title}
            </p>
            <div className="menu-group-items">
              {section.items.map((item) => (
                <button
                  key={item.path}
                  className="menu-btn"
                  onClick={() => navigate(item.path)}
                >
                  <span className="menu-btn-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span className="menu-btn-label">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
