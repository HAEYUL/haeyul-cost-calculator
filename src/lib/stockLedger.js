import { stockKey } from './stockKey'

// 품목(물품명+단위)별 현재고 = 입고 − 사용 − 폐기 + 재고조정(실사).
// tracked: 사용량이나 재고실사 기록이 한 번이라도 있는 품목. 이런 기록이 없으면 현재고가
// "지금까지 들어온 양의 합"일 뿐이라 실제 남은 양으로 믿을 수 없다.
export function buildStockLedger({ invoices = [], usage = [], waste = [], adjustments = [] }) {
  const stock = new Map()
  const ensure = (itemName, unit) => {
    const key = stockKey(itemName, unit)
    if (!stock.has(key)) {
      stock.set(key, { itemName, unit: unit ?? null, received: 0, receiptCount: 0, used: 0, wasted: 0, adjusted: 0, tracked: false })
    }
    return stock.get(key)
  }
  for (const row of invoices) {
    if (row.quantity == null) continue
    const e = ensure(row.item_name, row.unit)
    e.received += Number(row.quantity)
    e.receiptCount += 1
  }
  for (const row of usage) {
    const e = ensure(row.item_name, row.unit)
    e.used += Number(row.used_qty)
    e.tracked = true
  }
  for (const row of waste) {
    ensure(row.item_name, row.unit).wasted += Number(row.qty)
  }
  for (const row of adjustments) {
    const e = ensure(row.item_name, row.unit)
    e.adjusted += Number(row.delta)
    e.tracked = true
  }
  for (const e of stock.values()) e.current = e.received - e.used - e.wasted + e.adjusted
  return stock
}
