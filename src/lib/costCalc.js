// 입고 내역의 단가는 매장이 입력한 "단위" 기준(g/kg/개/기타)이고, 레시피 사용량은 항상 g이므로
// 두 값을 그대로 곱하면 안 된다. 여기서 kg→g만 자동 환산하고, 개(ea)·기타(other)처럼 무게가
// 아닌 단위는 원가에서 제외하고 'unit_mismatch'로 표시해 사장님이 직접 확인하게 한다.
export function latestInvoiceInfoByItem(invoiceRows) {
  const map = new Map()
  const sorted = [...invoiceRows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  for (const row of sorted) {
    if (!map.has(row.item_name) && row.unit_price != null) {
      map.set(row.item_name, { unitPrice: Number(row.unit_price), unit: row.unit ?? null })
    }
  }
  return map
}

function pricePerGram(unitPrice, unit) {
  if (unit === 'g') return unitPrice
  if (unit === 'kg') return unitPrice / 1000
  return null
}

export function computeMenuCost({ recipeRows, mappingByIngredient, infoByItem }) {
  let totalCost = 0
  let hasMissing = false

  const breakdown = recipeRows.map((row) => {
    const mappedItem = mappingByIngredient.get(row.ingredient_name) ?? null
    const info = mappedItem != null ? (infoByItem.get(mappedItem) ?? null) : null
    const amountG = row.amount_g != null ? Number(row.amount_g) : null
    const unitPrice = info?.unitPrice ?? null
    const unit = info?.unit ?? null

    let cost = null
    let status = 'ok'
    if (!mappedItem) {
      status = 'unmapped'
      hasMissing = true
    } else if (unitPrice == null) {
      status = 'no_price'
      hasMissing = true
    } else if (amountG == null) {
      status = 'no_amount'
      hasMissing = true
    } else {
      const perGram = pricePerGram(unitPrice, unit)
      if (perGram == null) {
        status = 'unit_mismatch'
        hasMissing = true
      } else {
        cost = amountG * perGram
        totalCost += cost
      }
    }

    return { ingredientName: row.ingredient_name, amountG, mappedItem, unitPrice, unit, cost, status }
  })

  return { totalCost, hasMissing, breakdown }
}
