import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { latestInvoiceInfoByItem, computeMenuCost } from '../lib/costCalc'
import { computeReorderAlerts } from '../lib/reorderCalc'

const MENU_ITEMS = [
  { label: '입고 입력', path: '/invoices' },
  { label: '거래처 관리', path: '/vendors' },
  { label: '재고 관리', path: '/inventory' },
  { label: '단가 추이 조회', path: '/price-trend' },
  { label: '레시피 입력', path: '/recipes' },
  { label: '재료 매칭', path: '/ingredient-matching' },
  { label: '원가 확인', path: '/cost' },
  { label: '지출 리포트', path: '/spending-report' },
  { label: '재주문 알림', path: '/reorder-alerts' },
  { label: '소비 패턴 분석', path: '/consumption-pattern' },
  { label: '폐기/손실 리포트', path: '/waste-report' },
  { label: '알림 설정', path: '/notification-settings' },
  { label: '매장 비밀번호 변경', path: '/change-pin' },
]

const UNIT_LABELS = { g: 'g', kg: 'kg', ea: '개', box: '박스', other: '기타' }
const MARGIN_WARNING_RATIO = 40

function stockKey(itemName, unit) {
  return `${itemName}||${unit ?? ''}`
}

// 알림 카드를 확인(X)했을 때 그 시점의 내용을 문자열로 남겨서, 다음에 열었을 때 내용이
// 같으면 계속 숨기고 달라지면 다시 보여주는 데 쓴다.
function makeSignature(parts) {
  return [...parts].sort().join('|')
}

// 명세표에 적힌 입고일(invoice_date)을 우선 기준으로 삼고, 없는 옛 데이터만 저장 시각
// (created_at)의 날짜로 대신한다.
function rowDateStr(row) {
  if (row.invoice_date) return row.invoice_date
  const d = new Date(row.created_at)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
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
  const [staleVendorCount, setStaleVendorCount] = useState(0)
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
        .select('vendor_id, total_amount, invoice_date, statement_balance, created_at')
        .eq('store_code', store.code),
      supabase
        .from('invoices')
        .select('item_name, unit, quantity, unit_price, invoice_date, created_at')
        .eq('store_code', store.code),
      supabase.from('stock_usage').select('item_name, unit, used_qty').eq('store_code', store.code),
      supabase.from('waste_records').select('item_name, unit, qty').eq('store_code', store.code),
      supabase.from('stock_adjustments').select('item_name, unit, delta').eq('store_code', store.code),
      supabase.from('recipes').select('menu_name, ingredient_name, amount_g').eq('store_code', store.code),
      supabase
        .from('ingredient_mapping')
        .select('recipe_ingredient_name, invoice_item_name')
        .eq('store_code', store.code),
      supabase.from('menu_prices').select('menu_name, selling_price').eq('store_code', store.code),
      supabase.from('dashboard_dismissals').select('card_key, signature').eq('store_code', store.code),
    ]).then(([batchesRes, invoicesRes, usageRes, wasteRes, adjustmentsRes, recipesRes, mappingRes, pricesRes, dismissalsRes]) => {
      const err =
        batchesRes.error ||
        invoicesRes.error ||
        usageRes.error ||
        wasteRes.error ||
        adjustmentsRes.error ||
        recipesRes.error ||
        mappingRes.error ||
        pricesRes.error ||
        dismissalsRes.error
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }

      // 미지급금(전체 거래처 합계)과 이번 달 입고 총액
      const { start: monthStart, end: monthEnd } = monthBounds()
      const latestBalance = new Map()
      const latestAnyDateValue = new Map()
      let monthSum = 0

      for (const b of batchesRes.data ?? []) {
        const dateStr = rowDateStr(b)
        const dateValue = new Date(b.invoice_date ?? b.created_at).getTime()

        if (dateStr >= monthStart && dateStr < monthEnd) {
          monthSum += Number(b.total_amount)
        }

        const existingAnyDate = latestAnyDateValue.get(b.vendor_id)
        if (!existingAnyDate || dateValue > existingAnyDate) {
          latestAnyDateValue.set(b.vendor_id, dateValue)
        }

        if (b.statement_balance != null) {
          // 명세표에 적힌 잔액은 그날 입고분을 더하기 전의 전잔액이라, 당일 입고액을 더해야
          // 그 시점의 실제 잔액이 된다.
          const existing = latestBalance.get(b.vendor_id)
          if (!existing || dateValue > existing.dateValue) {
            latestBalance.set(b.vendor_id, { value: Number(b.statement_balance) + Number(b.total_amount), dateValue })
          }
        }
      }

      let balanceSum = 0
      let staleCount = 0
      for (const [vendorId, info] of latestBalance) {
        balanceSum += info.value
        const anyDateValue = latestAnyDateValue.get(vendorId)
        if (anyDateValue != null && anyDateValue > info.dateValue) staleCount += 1
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
      const byMenu = new Map()
      for (const r of recipesRes.data ?? []) {
        if (!byMenu.has(r.menu_name)) byMenu.set(r.menu_name, [])
        byMenu.get(r.menu_name).push(r)
      }
      const marginWarnings = [...byMenu.entries()]
        .map(([menuName, recipeRows]) => {
          const { totalCost } = computeMenuCost({ recipeRows, mappingByIngredient, infoByItem })
          const sellingPrice = sellingByMenu.get(menuName) ?? null
          const ratio = sellingPrice ? (totalCost / sellingPrice) * 100 : null
          return { menuName, ratio }
        })
        .filter((m) => m.ratio != null && m.ratio >= MARGIN_WARNING_RATIO)
        .sort((a, b) => b.ratio - a.ratio)

      const reorderAlertsResult = computeReorderAlerts(invoicesRes.data ?? [])

      setTotalBalance(balanceSum)
      setStaleVendorCount(staleCount)
      setMonthTotal(monthSum)
      setNegativeStockItems(negativeStock.slice(0, 5))
      setNegativeStockCount(negativeStock.length)
      setMarginWarningMenus(marginWarnings.slice(0, 5))
      setMarginWarningCount(marginWarnings.length)
      setReorderAlerts(reorderAlertsResult)

      setSignatures({
        balance: makeSignature([`${Math.round(balanceSum)}`, `${staleCount}`, `${Math.round(monthSum)}`]),
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
    <div className="screen">
      <div className="screen-header">
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            setStore(null)
            navigate('/')
          }}
        >
          ← 매장 변경
        </button>
      </div>
      <div className="store-badge">{store.name}</div>

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
              {staleVendorCount > 0 && (
                <p className="hint alert-up">⚠️ 거래처 {staleVendorCount}곳은 잔액이 최신이 아닐 수 있어요</p>
              )}
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
        {MENU_ITEMS.map((item) => (
          <button
            key={item.path}
            className="menu-btn"
            onClick={() => navigate(item.path)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}
