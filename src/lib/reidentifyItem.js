// g와 kg는 1000배 차이로 정확히 환산되지만, 개/박스/기타는 "1개(또는 1박스)가 몇 g인지" 시스템이
// 미리 알 방법이 없어서 자동으로 단가를 맞출 수 없다. 그런 경우 null을 돌려줘서 호출한 쪽이
// "과거 단가는 그대로 두고 단위만 바뀌었다"는 걸 알고 사용자에게 확인을 안내(또는 customRatio로
// 직접 입력)하게 한다.
//
// factor는 "1 fromUnit당 단가 × factor = 1 toUnit당 단가"가 되는 배율이다. kg 단위 단가는
// costCalc.unitCostPerAmount에서 1000으로 나눠 g당 단가로 쓰고, g/개/박스/기타 단위 단가는
// 나누지 않고 그대로 쓴다 — 즉 "1kg짜리 단가"를 "1g짜리 단가"로 바꾸려면 1000으로 나눠야 하고
// (kg→g: factor = 1/1000), 반대로 g→kg는 1000을 곱해야 한다(factor = 1000).
export function weightConversionFactor(fromUnit, toUnit) {
  if (fromUnit === toUnit) return 1
  if (fromUnit === 'kg' && toUnit === 'g') return 1 / 1000
  if (fromUnit === 'g' && toUnit === 'kg') return 1000
  return null
}

// 물품 하나(itemName+unit)를 다른 이름/단위로 통째로 바꾼다. "이름 수정"(단위는 그대로)과
// "물품 합치기"(다른 물품으로 완전히 흡수) 둘 다 이 함수 하나로 처리한다 — 단위가 같으면
// 이름만 바뀌는 것과 똑같이 동작한다.
//
// customRatio: g/kg가 아닌 단위쌍(박스↔개, 박스↔kg 등)은 자동 환산비를 모르니, 사용자가 "1
// fromUnit이 몇 toUnit인지"(예: 박스→개 변경 시 "1박스=12개"의 12)를 알고 있으면 넘겨받아
// factor = 1/customRatio로 직접 계산한다. 안 넘기면 기존처럼 priceNeedsReview로 안내한다.
export async function reidentifyItem({ supabase, storeCode, from, to, customRatio }) {
  const unitChanged = from.unit !== to.unit
  const autoFactor = unitChanged ? weightConversionFactor(from.unit, to.unit) : 1
  const factor =
    autoFactor ?? (unitChanged && customRatio != null && customRatio > 0 ? 1 / customRatio : null)
  const withUnitFilter = (query) => (from.unit == null ? query.is('unit', null) : query.eq('unit', from.unit))

  if (unitChanged && factor != null && factor !== 1) {
    // g<->kg처럼 정확히 환산되는 경우는 과거 단가도 같이 맞춰준다(줄 단위로 하나씩 처리해야
    // "단가 * 배율" 같은 식 연산을 클라이언트에서 안전하게 적용할 수 있다).
    const { data: invoiceRows, error: selErr } = await withUnitFilter(
      supabase.from('invoices').select('id, unit_price').eq('store_code', storeCode).eq('item_name', from.itemName),
    )
    if (selErr) return { error: selErr }
    for (const row of invoiceRows ?? []) {
      const newPrice = row.unit_price != null ? Number(row.unit_price) * factor : row.unit_price
      const { error: updErr } = await supabase
        .from('invoices')
        .update({ item_name: to.itemName, unit: to.unit, unit_price: newPrice })
        .eq('id', row.id)
      if (updErr) return { error: updErr }
    }
  } else {
    const { error: err } = await withUnitFilter(
      supabase
        .from('invoices')
        .update({ item_name: to.itemName, unit: to.unit })
        .eq('store_code', storeCode)
        .eq('item_name', from.itemName),
    )
    if (err) return { error: err }
  }

  for (const table of ['stock_usage', 'waste_records', 'stock_adjustments']) {
    const { error: err } = await withUnitFilter(
      supabase
        .from(table)
        .update({ item_name: to.itemName, unit: to.unit })
        .eq('store_code', storeCode)
        .eq('item_name', from.itemName),
    )
    if (err) return { error: err }
  }

  if (from.itemName !== to.itemName) {
    // pinned_items는 (store_code, item_name)만 유일하므로 단위와 무관하게 이름만 본다.
    const { data: pinnedOld } = await supabase
      .from('pinned_items')
      .select('id')
      .eq('store_code', storeCode)
      .eq('item_name', from.itemName)
      .maybeSingle()
    if (pinnedOld) {
      await supabase.from('pinned_items').delete().eq('id', pinnedOld.id)
      await supabase
        .from('pinned_items')
        .upsert({ store_code: storeCode, item_name: to.itemName }, { onConflict: 'store_code,item_name' })
    }

    // 재료 매칭이 예전 물품명을 가리키고 있었다면 새 물품명으로 옮겨서 연결이 끊기지 않게 한다.
    const { error: mapErr } = await supabase
      .from('ingredient_mapping')
      .update({ invoice_item_name: to.itemName })
      .eq('store_code', storeCode)
      .eq('invoice_item_name', from.itemName)
    if (mapErr) return { error: mapErr }
  }

  return {
    error: null,
    priceNeedsReview: unitChanged && factor == null,
  }
}
