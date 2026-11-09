import { supabase } from './supabaseClient'
import { buildStockLedger } from './stockLedger'
import { mutedKeysFromDismissals, orderedMarksFromDismissals } from './reorderCalc'

// 재주문 계산에 필요한 데이터를 한 번에 불러온다. 재주문 알림 화면과 매니저 홈 카드가 같이 쓴다.
// 모두 매장 단위 권한이라 매니저도 자기 매장 것을 읽을 수 있다. 레시피 연결(ingredient_mapping)만
// 관리자 전용이라 매니저는 빈 목록이 되고, 우선순위에서 "레시피 재료" 기준만 빠진다.
export async function loadReorderInputs(storeCode) {
  const [invoicesRes, usageRes, wasteRes, adjustmentsRes, marksRes, pinsRes, mappingRes] = await Promise.all([
    supabase.from('invoices').select('item_name, unit, quantity, invoice_date, vendor').eq('store_code', storeCode),
    supabase.from('stock_usage').select('item_name, unit, used_qty').eq('store_code', storeCode),
    supabase.from('waste_records').select('item_name, unit, qty').eq('store_code', storeCode),
    supabase.from('stock_adjustments').select('item_name, unit, delta').eq('store_code', storeCode),
    supabase.from('dashboard_dismissals').select('card_key, signature').eq('store_code', storeCode).like('card_key', 'reorder-%'),
    supabase.from('pinned_items').select('item_name').eq('store_code', storeCode),
    supabase.from('ingredient_mapping').select('invoice_item_name').eq('store_code', storeCode),
  ])
  const err = invoicesRes.error || usageRes.error || wasteRes.error || adjustmentsRes.error || marksRes.error
  if (err) throw err
  const invoices = invoicesRes.data ?? []
  return {
    invoices,
    stockByKey: buildStockLedger({
      invoices,
      usage: usageRes.data ?? [],
      waste: wasteRes.data ?? [],
      adjustments: adjustmentsRes.data ?? [],
    }),
    pinnedNames: new Set((pinsRes.error ? [] : pinsRes.data ?? []).map((p) => p.item_name)),
    recipeItemNames: new Set((mappingRes.error ? [] : mappingRes.data ?? []).map((m) => m.invoice_item_name)),
    mutedKeys: mutedKeysFromDismissals(marksRes.data),
    orderedMarks: orderedMarksFromDismissals(marksRes.data),
  }
}
