// 레시피(부재료 또는 메뉴) 하나를 새 이름으로 통째로 복사한다. recipe_meta(유형·산출량)와
// recipes(재료 줄)를 그대로 복제해서, 비슷한 신메뉴를 만들 때 처음부터 다시 입력하지 않아도 되게
// 한다. 이름이 이미 있으면(다른 레시피와 충돌) 기존 데이터가 섞이지 않도록 막는다.
export async function copyRecipe({ supabase, storeCode, fromMenuName, toMenuName }) {
  const trimmed = toMenuName.trim()
  if (!trimmed) return { error: { message: '새 이름을 입력하세요.' } }
  if (trimmed === fromMenuName) return { error: { message: '원래 이름과 다른 이름을 입력하세요.' } }

  const { data: existing, error: existErr } = await supabase
    .from('recipe_meta')
    .select('menu_name')
    .eq('store_code', storeCode)
    .eq('menu_name', trimmed)
    .maybeSingle()
  if (existErr) return { error: existErr }
  if (existing) return { error: { message: '이미 있는 이름이에요. 다른 이름을 입력하세요.' } }

  const { data: metaData, error: metaErr } = await supabase
    .from('recipe_meta')
    .select('recipe_type, yield_qty, yield_unit')
    .eq('store_code', storeCode)
    .eq('menu_name', fromMenuName)
    .maybeSingle()
  if (metaErr) return { error: metaErr }

  const { data: rows, error: rowsErr } = await supabase
    .from('recipes')
    .select('ingredient_name, amount_g, is_sub_recipe')
    .eq('store_code', storeCode)
    .eq('menu_name', fromMenuName)
  if (rowsErr) return { error: rowsErr }

  const { error: metaInsertErr } = await supabase.from('recipe_meta').insert({
    store_code: storeCode,
    menu_name: trimmed,
    recipe_type: metaData?.recipe_type ?? 'menu',
    yield_qty: metaData?.yield_qty ?? null,
    yield_unit: metaData?.yield_unit ?? null,
  })
  if (metaInsertErr) return { error: metaInsertErr }

  if (rows && rows.length > 0) {
    const { error: insertErr } = await supabase.from('recipes').insert(
      rows.map((r) => ({
        store_code: storeCode,
        menu_name: trimmed,
        ingredient_name: r.ingredient_name,
        amount_g: r.amount_g,
        is_sub_recipe: r.is_sub_recipe,
      })),
    )
    if (insertErr) return { error: insertErr }
  }

  return { error: null, menuName: trimmed }
}
