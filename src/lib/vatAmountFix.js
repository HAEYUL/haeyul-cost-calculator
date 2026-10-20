// 명세표에 "공급가 · 부가세 · 금액(공급가+부가세)" 칸이 모두 있는데 품목 금액에 공급가만 들어간 경우를
// 찾는다. 단가가 부가세 포함이라 수량×단가 = 금액 + 부가세가 딱 맞으면 공급가만 들어간 것이다.
// "부가세 별도" 거래처는 반대로 금액이 공급가여야 하므로, 금액에 부가세가 이미 들어간 경우를 찾는다.
const TOLERANCE = 1

const num = (v) => (v === '' || v == null ? null : Number(v))

export function findVatAmountFixes(items, vatSeparate) {
  return items
    .map((item, index) => {
      const quantity = num(item.quantity)
      const unitPrice = num(item.unitPrice)
      const amount = num(item.amount)
      const vat = num(item.vat)
      if (!item.name?.trim() || quantity == null || unitPrice == null || amount == null || !vat) return null
      const expected = quantity * unitPrice
      if (Math.abs(expected - amount) <= TOLERANCE) return null
      if (!vatSeparate && Math.abs(expected - (amount + vat)) <= TOLERANCE) {
        return { index, name: item.name.trim(), from: amount, to: amount + vat }
      }
      if (vatSeparate && Math.abs(expected + vat - amount) <= TOLERANCE) {
        return { index, name: item.name.trim(), from: amount, to: amount - vat }
      }
      return null
    })
    .filter(Boolean)
}

// 저장된 명세표(invoices 품목 포함) 중 위 문제가 있는 것만 골라, 고칠 품목과 빠진(또는 더 들어간)
// 부가세 합계를 붙여서 돌려준다. vatSeparateByVendor: 거래처 id → 부가세 별도 여부
export function findBatchesNeedingVatFix(batches, vatSeparateByVendor) {
  return (batches ?? [])
    .map((batch) => {
      const items = (batch.invoices ?? []).map((row) => ({
        name: row.item_name ?? '',
        quantity: row.quantity ?? '',
        unitPrice: row.unit_price ?? '',
        amount: row.amount ?? '',
        vat: row.vat ?? '',
      }))
      const fixes = findVatAmountFixes(items, vatSeparateByVendor.get(batch.vendor_id) ?? false)
      if (fixes.length === 0) return null
      return { ...batch, fixes, diff: fixes.reduce((sum, f) => sum + f.to - f.from, 0) }
    })
    .filter(Boolean)
}
