import { UNIT_LABELS } from './units'

// 기간 안에 들어온 양·금액 합계. 단위가 섞여 있으면 단위별로 따로 더한다.
export function summarizeReceipts(rows) {
  const qtyByUnit = new Map()
  let amount = 0
  let hasAmount = false
  let count = 0
  for (const r of rows) {
    count += 1
    const q = Number(r.quantity)
    if (r.quantity != null && Number.isFinite(q)) {
      const unit = r.unit ?? ''
      qtyByUnit.set(unit, (qtyByUnit.get(unit) ?? 0) + q)
    }
    const a = Number(r.amount)
    if (r.amount != null && Number.isFinite(a)) {
      amount += a
      hasAmount = true
    }
  }
  return { count, qtyByUnit, amount: hasAmount ? amount : null }
}

export function formatQtyByUnit(qtyByUnit) {
  if (qtyByUnit.size === 0) return '-'
  return [...qtyByUnit.entries()]
    .map(([unit, q]) => `${(Math.round(q * 100) / 100).toLocaleString()}${unit ? UNIT_LABELS[unit] ?? unit : ''}`)
    .join(' + ')
}
