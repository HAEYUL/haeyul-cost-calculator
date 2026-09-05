import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { latestInvoiceInfoByItem, computeMenuCost, computeAllSubRecipeUnitCosts } from '../lib/costCalc'
import AmountInput from '../components/AmountInput'

const STATUS_LABEL = {
  unmapped: '재료 매칭 필요',
  no_price: '입고 단가 없음',
  no_amount: '사용량 미입력',
  unit_mismatch: '단가 환산 불가 (개/기타 단위)',
  sub_no_cost: '부재료 원가 계산 안 됨',
}

function emptyItem() {
  return { name: '', amountG: '', isSubRecipe: false }
}

export default function CostDetailScreen() {
  const { store } = useStore()
  const navigate = useNavigate()
  const { menuName: encoded } = useParams()
  const menuName = decodeURIComponent(encoded ?? '')

  const [items, setItems] = useState([])
  const [subRecipeNames, setSubRecipeNames] = useState([])
  const [mappingByIngredient, setMappingByIngredient] = useState(new Map())
  const [infoByItem, setInfoByItem] = useState(new Map())
  const [subUnitCostByName, setSubUnitCostByName] = useState(new Map())

  const [sellingPrice, setSellingPrice] = useState(null)
  const [priceInput, setPriceInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [savingPrice, setSavingPrice] = useState(false)
  const [savingItems, setSavingItems] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const [dataKey, setDataKey] = useState(0)

  useEffect(() => {
    if (!store) navigate('/', { replace: true })
  }, [store, navigate])

  useEffect(() => {
    if (!store || !supabase) return
    setLoading(true)
    setError('')
    Promise.all([
      supabase
        .from('recipes')
        .select('ingredient_name, amount_g, is_sub_recipe')
        .eq('store_code', store.code)
        .eq('menu_name', menuName),
      supabase.from('recipe_meta').select('menu_name, recipe_type, yield_qty').eq('store_code', store.code),
      supabase.from('recipes').select('menu_name, ingredient_name, amount_g, is_sub_recipe').eq('store_code', store.code),
      supabase.from('ingredient_mapping').select('recipe_ingredient_name, invoice_item_name').eq('store_code', store.code),
      supabase.from('invoices').select('item_name, unit_price, unit, created_at').eq('store_code', store.code),
      supabase
        .from('menu_prices')
        .select('selling_price')
        .eq('store_code', store.code)
        .eq('menu_name', menuName)
        .maybeSingle(),
    ]).then(([myRowsRes, metaRes, allRowsRes, mappingRes, invoicesRes, priceRes]) => {
      const err =
        myRowsRes.error || metaRes.error || allRowsRes.error || mappingRes.error || invoicesRes.error || priceRes.error
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }

      const mapping = new Map((mappingRes.data ?? []).map((m) => [m.recipe_ingredient_name, m.invoice_item_name]))
      const info = latestInvoiceInfoByItem(invoicesRes.data ?? [])

      const rowsByMenu = new Map()
      for (const r of allRowsRes.data ?? []) {
        if (!rowsByMenu.has(r.menu_name)) rowsByMenu.set(r.menu_name, [])
        rowsByMenu.get(r.menu_name).push(r)
      }
      const subMeta = (metaRes.data ?? []).filter((m) => m.recipe_type === 'sub' && m.menu_name !== menuName)
      const subRecipeRowsByMenu = new Map(subMeta.map((m) => [m.menu_name, rowsByMenu.get(m.menu_name) ?? []]))
      const subRecipeMetaByMenu = new Map(subMeta.map((m) => [m.menu_name, m]))
      const subUnitCosts = computeAllSubRecipeUnitCosts({
        subRecipeRowsByMenu,
        subRecipeMetaByMenu,
        mappingByIngredient: mapping,
        infoByItem: info,
      })

      setSubRecipeNames(subMeta.map((m) => m.menu_name).sort((a, b) => a.localeCompare(b)))
      setMappingByIngredient(mapping)
      setInfoByItem(info)
      setSubUnitCostByName(subUnitCosts)

      setItems(
        (myRowsRes.data ?? []).map((row) => ({
          name: row.ingredient_name,
          amountG: row.amount_g != null ? String(row.amount_g) : '',
          isSubRecipe: row.is_sub_recipe,
        })),
      )

      const sp = priceRes.data?.selling_price != null ? Number(priceRes.data.selling_price) : null
      setSellingPrice(sp)
      setPriceInput(sp != null ? String(sp) : '')
      setLoading(false)
    })
  }, [store, menuName, dataKey])

  if (!store) return null

  const recipeRowsForCalc = items.map((it) => ({
    ingredient_name: it.name.trim(),
    amount_g: it.amountG === '' ? null : Number(it.amountG),
    is_sub_recipe: it.isSubRecipe,
  }))
  const { totalCost, hasMissing, breakdown } = computeMenuCost({
    recipeRows: recipeRowsForCalc,
    mappingByIngredient,
    infoByItem,
    subUnitCostByName,
  })

  const previewPrice = priceInput === '' ? null : Number(priceInput)
  const effectivePrice = Number.isFinite(previewPrice) && previewPrice > 0 ? previewPrice : null
  const ratio = effectivePrice ? (totalCost / effectivePrice) * 100 : null
  const margin = effectivePrice ? effectivePrice - totalCost : null

  const updateItem = (index, field, value) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)))
  }
  const toggleItemType = (index, isSubRecipe) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, isSubRecipe, name: '' } : item)))
  }
  const addItem = () => setItems((prev) => [...prev, emptyItem()])
  const removeItem = (index) => setItems((prev) => prev.filter((_, i) => i !== index))

  const handleSaveItems = async () => {
    if (!supabase) return
    setSavingItems(true)
    setError('')
    setSaveMessage('')
    const validItems = items.filter((item) => item.name.trim())

    const { error: delErr } = await supabase.from('recipes').delete().eq('store_code', store.code).eq('menu_name', menuName)
    if (delErr) {
      setSavingItems(false)
      setError(delErr.message)
      return
    }

    if (validItems.length > 0) {
      const rows = validItems.map((item) => ({
        store_code: store.code,
        menu_name: menuName,
        ingredient_name: item.name.trim(),
        amount_g: item.amountG === '' ? null : Number(item.amountG),
        is_sub_recipe: item.isSubRecipe,
      }))
      const { error: insErr } = await supabase.from('recipes').insert(rows)
      if (insErr) {
        setSavingItems(false)
        setError(insErr.message)
        return
      }
    }

    setSavingItems(false)
    setSaveMessage('재료 구성을 저장했습니다.')
    setDataKey((k) => k + 1)
  }

  const handleSavePrice = async () => {
    if (!supabase) return
    if (effectivePrice == null) {
      setError('판매가를 0보다 크게 입력하세요.')
      return
    }
    setSavingPrice(true)
    setError('')
    setSaveMessage('')
    const { error: err } = await supabase.from('menu_prices').upsert(
      {
        store_code: store.code,
        menu_name: menuName,
        selling_price: effectivePrice,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'store_code,menu_name' },
    )
    setSavingPrice(false)
    if (err) {
      setError(err.message)
      return
    }
    setSaveMessage('판매가를 저장했습니다.')
    setDataKey((k) => k + 1)
  }

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/cost')}>
          ← 메뉴별 원가확인
        </button>
        <h1>{menuName}</h1>
        <p className="subtitle">{store.name} · 재료 구성과 원가</p>
      </div>

      {!supabase && <p className="hint">Supabase가 설정되지 않았습니다.</p>}
      {loading && <p className="hint">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}

      {!loading && supabase && (
        <>
          <div className="cost-summary">
            <div className="cost-summary-row">
              <span>재료 원가</span>
              <strong>{Math.round(totalCost).toLocaleString()}원</strong>
            </div>

            <div className="field">
              <label htmlFor="sellingPrice">판매가</label>
              <AmountInput
                id="sellingPrice"
                className="input"
                value={priceInput}
                onChange={setPriceInput}
                placeholder="예: 15,000"
              />
            </div>
            <button type="button" className="btn-secondary" onClick={handleSavePrice} disabled={savingPrice}>
              {savingPrice ? '저장 중...' : sellingPrice != null ? '판매가 수정' : '판매가 저장'}
            </button>

            {ratio != null ? (
              <>
                <div className="cost-summary-row">
                  <span>원가율</span>
                  <strong className={ratio >= 40 ? 'alert-up' : ratio <= 25 ? 'alert-down' : ''}>
                    {ratio.toFixed(1)}%
                  </strong>
                </div>
                <div className="cost-summary-row">
                  <span>마진</span>
                  <strong>{Math.round(margin).toLocaleString()}원</strong>
                </div>
              </>
            ) : (
              <p className="hint">판매가를 입력하면 원가율과 마진이 계산됩니다.</p>
            )}

            {hasMissing && <p className="hint">일부 재료는 매칭 또는 단가 정보가 없어 원가에서 제외됐습니다.</p>}
          </div>

          {saveMessage && <p className="success-text">{saveMessage}</p>}

          <h2 className="section-title">재료 구성</h2>
          {items.length === 0 && <p className="hint">아직 재료가 없습니다. 아래에서 추가하세요.</p>}

          {items.length > 0 && (
            <div className="item-table-wrap">
              <div className="item-table item-table-cost">
                <div className="item-row item-row-cost item-row-head">
                  <span>유형</span>
                  <span>품목</span>
                  <span>재료량</span>
                  <span>매칭/단가</span>
                  <span />
                </div>
                {items.map((item, index) => {
                  const row = breakdown[index]
                  return (
                    <div className="item-row item-row-cost" key={index}>
                      <select
                        className="select"
                        value={item.isSubRecipe ? 'sub' : 'raw'}
                        onChange={(e) => toggleItemType(index, e.target.value === 'sub')}
                      >
                        <option value="raw">원재료</option>
                        <option value="sub">부재료</option>
                      </select>
                      {item.isSubRecipe ? (
                        <select
                          className="select"
                          value={item.name}
                          onChange={(e) => updateItem(index, 'name', e.target.value)}
                        >
                          <option value="">부재료 선택...</option>
                          {subRecipeNames.map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className="input"
                          value={item.name}
                          onChange={(e) => updateItem(index, 'name', e.target.value)}
                          placeholder="재료명"
                        />
                      )}
                      <input
                        className="input"
                        inputMode="decimal"
                        value={item.amountG}
                        onChange={(e) => updateItem(index, 'amountG', e.target.value)}
                        placeholder={item.isSubRecipe ? '사용량' : 'g'}
                      />
                      <span className="row-value">
                        {row?.cost != null
                          ? `${Math.round(row.cost).toLocaleString()}원`
                          : row?.status
                            ? STATUS_LABEL[row.status]
                            : ''}
                        {!item.isSubRecipe && row?.mappedItem && (
                          <span className="hint"> · {row.mappedItem}</span>
                        )}
                      </span>
                      <button type="button" className="icon-btn" onClick={() => removeItem(index)} aria-label="행 삭제">
                        ✕
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="invoice-form">
            <button type="button" className="btn-secondary" onClick={addItem}>
              + 품목 추가
            </button>
            <button type="button" className="btn-primary" onClick={handleSaveItems} disabled={savingItems}>
              {savingItems ? '저장 중...' : '재료 구성 저장'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
