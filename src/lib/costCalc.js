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

// subUnitCostByName: 부재료(menu_name) → 1단위(개/인분/ml 등)당 단가. 부재료를 참조하는
// 줄(is_sub_recipe=true)의 원가를 계산할 때 쓴다. 메뉴가 아닌 부재료 자체의 원가를 계산할
// 때는(computeSubRecipeCost) 항상 빈 맵을 넘겨서, 부재료 안에 또 다른 부재료를 넣는 순환참조를
// 원천적으로 막는다(그런 줄은 "부재료 원가 없음"으로만 표시되고 원가에서 빠진다).
export function computeMenuCost({ recipeRows, mappingByIngredient, infoByItem, subUnitCostByName }) {
  let totalCost = 0
  let hasMissing = false
  const subMap = subUnitCostByName ?? new Map()

  const breakdown = recipeRows.map((row) => {
    const amountG = row.amount_g != null ? Number(row.amount_g) : null

    if (row.is_sub_recipe) {
      const unitCost = subMap.get(row.ingredient_name) ?? null
      let cost = null
      let status = 'ok'
      if (unitCost == null) {
        status = 'sub_no_cost'
        hasMissing = true
      } else if (amountG == null) {
        status = 'no_amount'
        hasMissing = true
      } else {
        cost = amountG * unitCost
        totalCost += cost
      }
      return {
        ingredientName: row.ingredient_name,
        amountG,
        mappedItem: null,
        unitPrice: unitCost,
        unit: null,
        cost,
        status,
        isSubRecipe: true,
      }
    }

    const mappedItem = mappingByIngredient.get(row.ingredient_name) ?? null
    const info = mappedItem != null ? (infoByItem.get(mappedItem) ?? null) : null
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

    return { ingredientName: row.ingredient_name, amountG, mappedItem, unitPrice, unit, cost, status, isSubRecipe: false }
  })

  return { totalCost, hasMissing, breakdown }
}

// 부재료(recipe_type='sub') 하나의 원가를 계산한다. 부재료는 원재료만 쓸 수 있으므로
// subUnitCostByName은 항상 빈 맵으로 넘긴다. yieldQty로 총 재료비를 나눠 1단위당 단가를 낸다.
export function computeSubRecipeCost({ recipeRows, mappingByIngredient, infoByItem, yieldQty }) {
  const { totalCost, hasMissing, breakdown } = computeMenuCost({
    recipeRows,
    mappingByIngredient,
    infoByItem,
    subUnitCostByName: new Map(),
  })
  const qty = yieldQty != null && yieldQty !== '' ? Number(yieldQty) : null
  const unitCost = qty != null && qty > 0 ? totalCost / qty : null
  return { totalCost, unitCost, hasMissing, breakdown }
}

// 매장의 모든 부재료(recipe_type='sub')의 1단위당 단가를 한 번에 계산해서 menu_name → unitCost
// 맵으로 돌려준다. 메뉴 원가를 계산하기 전에 먼저 이 맵을 만들어 subUnitCostByName으로 넘겨야
// 메뉴에 연결된 부재료 줄의 원가가 계산된다.
export function computeAllSubRecipeUnitCosts({ subRecipeRowsByMenu, subRecipeMetaByMenu, mappingByIngredient, infoByItem }) {
  const unitCostByName = new Map()
  for (const [menuName, recipeRows] of subRecipeRowsByMenu) {
    const meta = subRecipeMetaByMenu.get(menuName)
    const { unitCost } = computeSubRecipeCost({
      recipeRows,
      mappingByIngredient,
      infoByItem,
      yieldQty: meta?.yield_qty ?? null,
    })
    if (unitCost != null) unitCostByName.set(menuName, unitCost)
  }
  return unitCostByName
}
