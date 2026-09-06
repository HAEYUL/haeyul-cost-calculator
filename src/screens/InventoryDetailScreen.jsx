import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { reidentifyItem, weightConversionFactor } from '../lib/reidentifyItem'

const UNIT_LABELS = { g: 'g', kg: 'kg', ea: '개', box: '박스', other: '기타' }
const NO_UNIT_KEY = 'none'
const WASTE_REASONS = ['상함/부패', '유통기한 경과', '조리 실수', '기타']

function stockKey(name, u) {
  return `${name}||${u ?? ''}`
}

export default function InventoryDetailScreen() {
  const { store } = useStore()
  const navigate = useNavigate()
  const { itemName: encodedItemName, unit: unitParam } = useParams()
  const itemName = decodeURIComponent(encodedItemName ?? '')
  const unit = unitParam === NO_UNIT_KEY ? null : unitParam

  const [receipts, setReceipts] = useState([])
  const [usageRows, setUsageRows] = useState([])
  const [wasteRows, setWasteRows] = useState([])
  const [adjustmentRows, setAdjustmentRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [dataKey, setDataKey] = useState(0)

  const [usageQty, setUsageQty] = useState('')
  const [usageDate, setUsageDate] = useState('')
  const [usageMemo, setUsageMemo] = useState('')
  const [saving, setSaving] = useState(false)

  const [deleteUsageTarget, setDeleteUsageTarget] = useState(null)
  const [deletingUsage, setDeletingUsage] = useState(false)

  const [wasteQty, setWasteQty] = useState('')
  const [wasteDate, setWasteDate] = useState('')
  const [wasteReason, setWasteReason] = useState(WASTE_REASONS[0])
  const [wasteMemo, setWasteMemo] = useState('')
  const [savingWaste, setSavingWaste] = useState(false)

  const [deleteWasteTarget, setDeleteWasteTarget] = useState(null)
  const [deletingWaste, setDeletingWaste] = useState(false)

  const [countedQty, setCountedQty] = useState('')
  const [adjustedDate, setAdjustedDate] = useState('')
  const [adjustMemo, setAdjustMemo] = useState('')
  const [savingAdjustment, setSavingAdjustment] = useState(false)

  const [deleteAdjustmentTarget, setDeleteAdjustmentTarget] = useState(null)
  const [deletingAdjustment, setDeletingAdjustment] = useState(false)

  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const [otherItems, setOtherItems] = useState([])

  const [showRename, setShowRename] = useState(false)
  const [renameInput, setRenameInput] = useState(itemName)
  const [renameUnit, setRenameUnit] = useState(unit)
  const [renameRatio, setRenameRatio] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameMessage, setRenameMessage] = useState('')

  const [showMerge, setShowMerge] = useState(false)
  const [mergeIntoKey, setMergeIntoKey] = useState('')
  const [mergeRatio, setMergeRatio] = useState('')
  const [merging, setMerging] = useState(false)

  const [recipeUnitConfig, setRecipeUnitConfig] = useState(null)
  const [showRecipeUnit, setShowRecipeUnit] = useState(false)
  const [recipeUnitSelect, setRecipeUnitSelect] = useState('ea')
  const [recipeUnitRatio, setRecipeUnitRatio] = useState('')
  const [savingRecipeUnit, setSavingRecipeUnit] = useState(false)

  useEffect(() => {
    if (!store) navigate('/', { replace: true })
  }, [store, navigate])

  useEffect(() => {
    if (!store || !supabase) return
    setLoading(true)
    setError('')

    let receiptsQuery = supabase
      .from('invoices')
      .select('id, quantity, unit_price, invoice_date, created_at, vendor')
      .eq('store_code', store.code)
      .eq('item_name', itemName)
      .order('created_at', { ascending: false })
    receiptsQuery = unit == null ? receiptsQuery.is('unit', null) : receiptsQuery.eq('unit', unit)

    let usageQuery = supabase
      .from('stock_usage')
      .select('id, used_qty, used_date, memo, created_at')
      .eq('store_code', store.code)
      .eq('item_name', itemName)
      .order('created_at', { ascending: false })
    usageQuery = unit == null ? usageQuery.is('unit', null) : usageQuery.eq('unit', unit)

    let wasteQuery = supabase
      .from('waste_records')
      .select('id, qty, waste_date, reason, memo, created_at')
      .eq('store_code', store.code)
      .eq('item_name', itemName)
      .order('created_at', { ascending: false })
    wasteQuery = unit == null ? wasteQuery.is('unit', null) : wasteQuery.eq('unit', unit)

    let adjustmentQuery = supabase
      .from('stock_adjustments')
      .select('id, delta, counted_qty, adjusted_date, memo, created_at')
      .eq('store_code', store.code)
      .eq('item_name', itemName)
      .order('created_at', { ascending: false })
    adjustmentQuery = unit == null ? adjustmentQuery.is('unit', null) : adjustmentQuery.eq('unit', unit)

    Promise.all([receiptsQuery, usageQuery, wasteQuery, adjustmentQuery]).then(
      ([receiptsRes, usageRes, wasteRes, adjustmentRes]) => {
        const err = receiptsRes.error || usageRes.error || wasteRes.error || adjustmentRes.error
        if (err) {
          setError(err.message)
          setLoading(false)
          return
        }
        setReceipts(receiptsRes.data ?? [])
        setUsageRows(usageRes.data ?? [])
        setWasteRows(wasteRes.data ?? [])
        setAdjustmentRows(adjustmentRes.data ?? [])
        setLoading(false)
      },
    )
  }, [store, itemName, unit, dataKey])

  useEffect(() => {
    if (!store || !supabase) return
    supabase
      .from('invoices')
      .select('item_name, unit')
      .eq('store_code', store.code)
      .then(({ data, error: err }) => {
        if (err) return
        const seen = new Map()
        for (const r of data ?? []) {
          const key = stockKey(r.item_name, r.unit)
          if (key !== stockKey(itemName, unit)) seen.set(key, { itemName: r.item_name, unit: r.unit })
        }
        setOtherItems([...seen.values()].sort((a, b) => a.itemName.localeCompare(b.itemName)))
      })
  }, [store, itemName, unit, dataKey])

  useEffect(() => {
    if (!store || !supabase) return
    supabase
      .from('item_recipe_units')
      .select('recipe_unit, ratio')
      .eq('store_code', store.code)
      .eq('item_name', itemName)
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (err) return
        setRecipeUnitConfig(data ? { recipeUnit: data.recipe_unit, ratio: Number(data.ratio) } : null)
      })
  }, [store, itemName, dataKey])

  if (!store) return null

  const totalReceived = receipts.reduce((sum, r) => sum + (r.quantity != null ? Number(r.quantity) : 0), 0)
  const totalUsed = usageRows.reduce((sum, r) => sum + Number(r.used_qty), 0)
  const totalWasted = wasteRows.reduce((sum, r) => sum + Number(r.qty), 0)
  const totalAdjustment = adjustmentRows.reduce((sum, r) => sum + Number(r.delta), 0)
  const currentStock = totalReceived - totalUsed - totalWasted + totalAdjustment
  const unitLabel = unit ? UNIT_LABELS[unit] ?? unit : ''

  const handleAddUsage = async () => {
    const qty = Number(usageQty)
    if (!usageQty || !Number.isFinite(qty) || qty <= 0 || !supabase) {
      setError('사용량을 0보다 크게 입력하세요.')
      return
    }
    setSaving(true)
    setError('')
    const { error: err } = await supabase.from('stock_usage').insert({
      store_code: store.code,
      item_name: itemName,
      unit,
      used_qty: qty,
      used_date: usageDate || null,
      memo: usageMemo.trim() || null,
    })
    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }
    setUsageQty('')
    setUsageDate('')
    setUsageMemo('')
    setDataKey((k) => k + 1)
  }

  const handleDeleteUsage = async () => {
    if (!deleteUsageTarget || !supabase) return
    setDeletingUsage(true)
    setError('')

    const { error: err } = await supabase.from('stock_usage').delete().eq('id', deleteUsageTarget.id)
    setDeletingUsage(false)
    if (err) {
      setError(err.message)
      return
    }

    setDeleteUsageTarget(null)
    setDataKey((k) => k + 1)
  }

  const handleAddWaste = async () => {
    const qty = Number(wasteQty)
    if (!wasteQty || !Number.isFinite(qty) || qty <= 0 || !supabase) {
      setError('폐기 수량을 0보다 크게 입력하세요.')
      return
    }
    setSavingWaste(true)
    setError('')
    const { error: err } = await supabase.from('waste_records').insert({
      store_code: store.code,
      item_name: itemName,
      unit,
      qty,
      waste_date: wasteDate || null,
      reason: wasteReason,
      memo: wasteMemo.trim() || null,
    })
    setSavingWaste(false)
    if (err) {
      setError(err.message)
      return
    }
    setWasteQty('')
    setWasteDate('')
    setWasteReason(WASTE_REASONS[0])
    setWasteMemo('')
    setDataKey((k) => k + 1)
  }

  const handleDeleteWaste = async () => {
    if (!deleteWasteTarget || !supabase) return
    setDeletingWaste(true)
    setError('')

    const { error: err } = await supabase.from('waste_records').delete().eq('id', deleteWasteTarget.id)
    setDeletingWaste(false)
    if (err) {
      setError(err.message)
      return
    }

    setDeleteWasteTarget(null)
    setDataKey((k) => k + 1)
  }

  const handleAddAdjustment = async () => {
    const counted = Number(countedQty)
    if (countedQty === '' || !Number.isFinite(counted) || !supabase) {
      setError('실제 확인한 수량을 입력하세요.')
      return
    }
    const delta = counted - currentStock
    if (delta === 0) {
      setError('실제 수량이 계산상 재고와 같아서 보정할 내용이 없어요.')
      return
    }
    setSavingAdjustment(true)
    setError('')
    const { error: err } = await supabase.from('stock_adjustments').insert({
      store_code: store.code,
      item_name: itemName,
      unit,
      delta,
      counted_qty: counted,
      adjusted_date: adjustedDate || null,
      memo: adjustMemo.trim() || null,
    })
    setSavingAdjustment(false)
    if (err) {
      setError(err.message)
      return
    }
    setCountedQty('')
    setAdjustedDate('')
    setAdjustMemo('')
    setDataKey((k) => k + 1)
  }

  const handleDeleteAdjustment = async () => {
    if (!deleteAdjustmentTarget || !supabase) return
    setDeletingAdjustment(true)
    setError('')

    const { error: err } = await supabase.from('stock_adjustments').delete().eq('id', deleteAdjustmentTarget.id)
    setDeletingAdjustment(false)
    if (err) {
      setError(err.message)
      return
    }

    setDeleteAdjustmentTarget(null)
    setDataKey((k) => k + 1)
  }

  // 이름/단위를 바꾸면 이 URL(itemName+unit)이 더 이상 존재하지 않는 물품을 가리키게 되므로,
  // 바뀐 뒤에는 새 이름/단위 페이지로 이동한다.
  const handleRename = async () => {
    const newName = renameInput.trim()
    if (!newName || !supabase) return
    if (newName === itemName && renameUnit === unit) {
      setShowRename(false)
      return
    }
    setRenaming(true)
    setError('')
    setRenameMessage('')
    const { error: err, priceNeedsReview } = await reidentifyItem({
      supabase,
      storeCode: store.code,
      from: { itemName, unit },
      to: { itemName: newName, unit: renameUnit },
      customRatio: renameRatio ? Number(renameRatio) : null,
    })
    setRenaming(false)
    if (err) {
      setError(err.message)
      return
    }
    if (priceNeedsReview) {
      setRenameMessage(
        '단위를 바꿨어요. 자동으로(또는 입력한 환산값으로) 단가를 맞출 수 없는 단위라 과거 단가 숫자는 그대로 남아있어요 — 최근 입고 단가가 새 단위 기준으로 맞는지 확인해주세요.',
      )
    }
    navigate(`/inventory/${encodeURIComponent(newName)}/${renameUnit ?? NO_UNIT_KEY}`, { replace: true })
  }

  const handleMerge = async () => {
    if (!mergeIntoKey || !supabase) return
    const into = otherItems.find((r) => stockKey(r.itemName, r.unit) === mergeIntoKey)
    if (!into) return
    setMerging(true)
    setError('')
    const { error: err } = await reidentifyItem({
      supabase,
      storeCode: store.code,
      from: { itemName, unit },
      to: { itemName: into.itemName, unit: into.unit },
      customRatio: mergeRatio ? Number(mergeRatio) : null,
    })
    setMerging(false)
    if (err) {
      setError(err.message)
      return
    }
    navigate(`/inventory/${encodeURIComponent(into.itemName)}/${into.unit ?? NO_UNIT_KEY}`, { replace: true })
  }

  const openRecipeUnit = () => {
    setShowRecipeUnit(true)
    setShowRename(false)
    setShowMerge(false)
    setRecipeUnitSelect(recipeUnitConfig?.recipeUnit ?? 'ea')
    setRecipeUnitRatio(recipeUnitConfig ? String(recipeUnitConfig.ratio) : '')
    setError('')
  }

  // 입고 단위(예: 박스)는 그대로 두고, 레시피에서만 다른 단위(예: 개)로 원가를 계산하고 싶을 때
  // 쓰는 환산 설정. "1 입고단위 = ratio 레시피단위"로 저장해두면, 이 물품을 매칭한 재료의 원가는
  // (입고 단가 ÷ ratio)로 계산된다. 물품 단위 자체는 안 바뀌고, 명세표 입력은 지금처럼 그대로다.
  const handleSaveRecipeUnit = async () => {
    if (!supabase) return
    const ratio = Number(recipeUnitRatio)
    if (!recipeUnitRatio || !Number.isFinite(ratio) || ratio <= 0) {
      setError('환산값을 0보다 크게 입력하세요.')
      return
    }
    setSavingRecipeUnit(true)
    setError('')
    const { error: err } = await supabase
      .from('item_recipe_units')
      .upsert({ store_code: store.code, item_name: itemName, recipe_unit: recipeUnitSelect, ratio }, { onConflict: 'store_code,item_name' })
    setSavingRecipeUnit(false)
    if (err) {
      setError(err.message)
      return
    }
    setShowRecipeUnit(false)
    setDataKey((k) => k + 1)
  }

  const handleDeleteRecipeUnit = async () => {
    if (!supabase) return
    setSavingRecipeUnit(true)
    setError('')
    const { error: err } = await supabase
      .from('item_recipe_units')
      .delete()
      .eq('store_code', store.code)
      .eq('item_name', itemName)
    setSavingRecipeUnit(false)
    if (err) {
      setError(err.message)
      return
    }
    setShowRecipeUnit(false)
    setDataKey((k) => k + 1)
  }

  const inRange = (dateStr) => (!dateFrom || !dateStr || dateStr >= dateFrom) && (!dateTo || !dateStr || dateStr <= dateTo)
  const visibleUsageRows = usageRows.filter((r) => inRange(r.used_date))
  const visibleWasteRows = wasteRows.filter((r) => inRange(r.waste_date))
  const visibleAdjustmentRows = adjustmentRows.filter((r) => inRange(r.adjusted_date))
  const visibleReceipts = receipts.filter((r) => inRange(r.invoice_date))

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/inventory')}>
          ← 재고 관리
        </button>
        <h1>{itemName}</h1>
        <p className="subtitle">{store.name} · {unitLabel ? `${unitLabel} 단위 재고` : '재고'}</p>
      </div>

      <div className="inventory-row-actions">
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            setShowRename((v) => !v)
            setShowMerge(false)
            setRenameInput(itemName)
            setRenameUnit(unit)
            setRenameRatio('')
            setRenameMessage('')
          }}
        >
          이름/단위 수정
        </button>
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            setShowMerge((v) => !v)
            setShowRename(false)
            setMergeIntoKey('')
            setMergeRatio('')
          }}
        >
          합치기
        </button>
        <button type="button" className="link-btn" onClick={openRecipeUnit}>
          레시피 단위 설정
        </button>
      </div>

      {unit === 'box' && !recipeUnitConfig && (
        <p className="hint">📦 박스당 개수/kg 환산 전이에요 · "이름/단위 수정" 또는 "레시피 단위 설정"에서 등록할 수 있어요</p>
      )}
      {recipeUnitConfig && (
        <p className="hint">
          🍱 레시피 단위: {UNIT_LABELS[recipeUnitConfig.recipeUnit] ?? recipeUnitConfig.recipeUnit} (1{unitLabel || '단위 없음'} ={' '}
          {recipeUnitConfig.ratio} {UNIT_LABELS[recipeUnitConfig.recipeUnit] ?? recipeUnitConfig.recipeUnit})
        </p>
      )}

      {showRecipeUnit && (
        <div className="price-alert-box">
          <p className="price-alert-title">레시피 단위 설정</p>
          <p className="hint">
            입고는 지금처럼 "{unitLabel || '단위 없음'}"으로 그대로 하고, 레시피에서만 다른 단위로 원가를 계산해요.
            물품의 입고 단위 자체는 안 바뀝니다.
          </p>
          <div className="field">
            <select className="select select-block" value={recipeUnitSelect} onChange={(e) => setRecipeUnitSelect(e.target.value)}>
              {Object.entries(UNIT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="recipeUnitRatio">
              1{unitLabel || '단위 없음'} = 몇 {UNIT_LABELS[recipeUnitSelect] ?? recipeUnitSelect}인가요?
            </label>
            <input
              id="recipeUnitRatio"
              className="input"
              inputMode="decimal"
              value={recipeUnitRatio}
              onChange={(e) => setRecipeUnitRatio(e.target.value)}
              placeholder="예: 120"
            />
          </div>
          <div className="invoice-form">
            <button type="button" className="btn-secondary" onClick={() => setShowRecipeUnit(false)} disabled={savingRecipeUnit}>
              취소
            </button>
            {recipeUnitConfig && (
              <button type="button" className="btn-secondary" onClick={handleDeleteRecipeUnit} disabled={savingRecipeUnit}>
                설정 삭제
              </button>
            )}
            <button type="button" className="btn-primary" onClick={handleSaveRecipeUnit} disabled={savingRecipeUnit}>
              {savingRecipeUnit ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      )}

      {showRename && (
        <div className="price-alert-box">
          <p className="price-alert-title">물품명/단위 일괄 변경</p>
          <div className="field">
            <input
              className="input"
              value={renameInput}
              onChange={(e) => setRenameInput(e.target.value)}
              placeholder="새 물품명"
              autoFocus
            />
          </div>
          <div className="field">
            <select className="select select-block" value={renameUnit ?? ''} onChange={(e) => setRenameUnit(e.target.value || null)}>
              {Object.entries(UNIT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {renameUnit !== unit && weightConversionFactor(unit, renameUnit) == null && (
            <div className="field">
              <label htmlFor="renameRatio">
                1{unit ? UNIT_LABELS[unit] ?? unit : '단위 없음'} = 몇 {UNIT_LABELS[renameUnit] ?? renameUnit}인가요?
                (선택)
              </label>
              <input
                id="renameRatio"
                className="input"
                inputMode="decimal"
                value={renameRatio}
                onChange={(e) => setRenameRatio(e.target.value)}
                placeholder="예: 12 (모르면 비워두세요)"
              />
            </div>
          )}
          <p className="hint">
            "{itemName}"으로 저장된 모든 입고·사용·폐기·실사 기록이 새 이름/단위로 한 번에 바뀌어요. g↔kg 단위 변경은
            과거 단가도 자동으로 맞춰지고, 그 외 단위 변경은 위에 환산값을 입력하면 그 값으로, 안 입력하면 단가는
            그대로 두고 단위만 바뀌어요. 되돌릴 수 없어요.
          </p>
          <div className="invoice-form">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setShowRename(false)
                setRenameRatio('')
              }}
              disabled={renaming}
            >
              취소
            </button>
            <button type="button" className="btn-primary" onClick={handleRename} disabled={renaming || !renameInput.trim()}>
              {renaming ? '변경 중...' : '변경'}
            </button>
          </div>
        </div>
      )}

      {showMerge && (
        <div className="price-alert-box price-alert-box-danger">
          <p className="price-alert-title">"{itemName}"을(를) 어느 물품과 합칠까요?</p>
          <div className="field">
            <select className="select select-block" value={mergeIntoKey} onChange={(e) => setMergeIntoKey(e.target.value)}>
              <option value="">합칠 물품을 선택하세요</option>
              {otherItems.map((r) => (
                <option key={stockKey(r.itemName, r.unit)} value={stockKey(r.itemName, r.unit)}>
                  {r.itemName} ({r.unit ? UNIT_LABELS[r.unit] ?? r.unit : '단위 없음'})
                </option>
              ))}
            </select>
          </div>
          {mergeIntoKey &&
            (() => {
              const into = otherItems.find((r) => stockKey(r.itemName, r.unit) === mergeIntoKey)
              const needsRatio = into && into.unit !== unit && weightConversionFactor(unit, into.unit) == null
              return (
                <>
                  {needsRatio && (
                    <div className="field">
                      <label htmlFor="mergeRatio">
                        1{unit ? UNIT_LABELS[unit] ?? unit : '단위 없음'} = 몇{' '}
                        {into.unit ? UNIT_LABELS[into.unit] ?? into.unit : '단위 없음'}인가요? (선택)
                      </label>
                      <input
                        id="mergeRatio"
                        className="input"
                        inputMode="decimal"
                        value={mergeRatio}
                        onChange={(e) => setMergeRatio(e.target.value)}
                        placeholder="예: 12 (모르면 비워두세요)"
                      />
                    </div>
                  )}
                  <p className="hint">
                    "{itemName}"의 모든 입고·사용·폐기·실사 기록이 선택한 물품으로 옮겨지고, "{itemName}"은 사라져요.
                    정말 같은 물품이 맞는지 확인해주세요 — 되돌릴 수 없어요.
                  </p>
                </>
              )
            })()}
          <div className="invoice-form">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setShowMerge(false)
                setMergeRatio('')
              }}
              disabled={merging}
            >
              취소
            </button>
            <button type="button" className="btn-primary" onClick={handleMerge} disabled={merging || !mergeIntoKey}>
              {merging ? '합치는 중...' : '합치기'}
            </button>
          </div>
        </div>
      )}

      {!supabase && <p className="hint">Supabase가 설정되지 않았습니다.</p>}
      {loading && <p className="hint">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}
      {renameMessage && <p className="hint">{renameMessage}</p>}

      {!loading && supabase && (
        <>
          <div className="cost-summary">
            <div className="cost-summary-row">
              <span>현재고</span>
              <strong className={currentStock < 0 ? 'alert-up' : ''}>
                {currentStock.toLocaleString()}
                {unitLabel}
              </strong>
            </div>
            <div className="cost-summary-row">
              <span>누적 입고</span>
              <strong>
                {totalReceived.toLocaleString()}
                {unitLabel}
              </strong>
            </div>
            <div className="cost-summary-row">
              <span>누적 사용</span>
              <strong>
                {totalUsed.toLocaleString()}
                {unitLabel}
              </strong>
            </div>
            <div className="cost-summary-row">
              <span>누적 폐기</span>
              <strong>
                {totalWasted.toLocaleString()}
                {unitLabel}
              </strong>
            </div>
            {totalAdjustment !== 0 && (
              <div className="cost-summary-row">
                <span>실사 보정</span>
                <strong className={totalAdjustment < 0 ? 'alert-up' : ''}>
                  {totalAdjustment > 0 ? '+' : ''}
                  {totalAdjustment.toLocaleString()}
                  {unitLabel}
                </strong>
              </div>
            )}
          </div>

          <h2 className="section-title">오늘 사용량 기록</h2>
          <div className="field">
            <label htmlFor="usageQty">사용량{unitLabel ? ` (${unitLabel})` : ''}</label>
            <input
              id="usageQty"
              className="input"
              inputMode="decimal"
              value={usageQty}
              onChange={(e) => setUsageQty(e.target.value)}
              placeholder="예: 3"
            />
          </div>
          <div className="field">
            <label htmlFor="usageDate">사용일</label>
            <input
              id="usageDate"
              className="input"
              type="date"
              value={usageDate}
              onChange={(e) => setUsageDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="usageMemo">메모</label>
            <input
              id="usageMemo"
              className="input"
              value={usageMemo}
              onChange={(e) => setUsageMemo(e.target.value)}
              placeholder="선택사항"
            />
          </div>
          <button type="button" className="btn-primary" onClick={handleAddUsage} disabled={saving}>
            {saving ? '저장 중...' : '사용량 기록'}
          </button>

          <h2 className="section-title">폐기/손실 기록</h2>
          <div className="field">
            <label htmlFor="wasteQty">폐기 수량{unitLabel ? ` (${unitLabel})` : ''}</label>
            <input
              id="wasteQty"
              className="input"
              inputMode="decimal"
              value={wasteQty}
              onChange={(e) => setWasteQty(e.target.value)}
              placeholder="예: 2"
            />
          </div>
          <div className="field">
            <label htmlFor="wasteReason">사유</label>
            <select
              id="wasteReason"
              className="select select-block"
              value={wasteReason}
              onChange={(e) => setWasteReason(e.target.value)}
            >
              {WASTE_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="wasteDate">폐기일</label>
            <input
              id="wasteDate"
              className="input"
              type="date"
              value={wasteDate}
              onChange={(e) => setWasteDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="wasteMemo">메모</label>
            <input
              id="wasteMemo"
              className="input"
              value={wasteMemo}
              onChange={(e) => setWasteMemo(e.target.value)}
              placeholder="선택사항"
            />
          </div>
          <button type="button" className="btn-secondary" onClick={handleAddWaste} disabled={savingWaste}>
            {savingWaste ? '저장 중...' : '폐기 기록'}
          </button>

          <h2 className="section-title">재고 실사(실물 확인)</h2>
          <p className="hint">
            직접 세어본 실제 수량을 입력하면, 계산상 재고({currentStock.toLocaleString()}
            {unitLabel})와 차이나는 만큼 자동으로 보정해요.
          </p>
          <div className="field">
            <label htmlFor="countedQty">실제 확인한 수량{unitLabel ? ` (${unitLabel})` : ''}</label>
            <input
              id="countedQty"
              className="input"
              inputMode="decimal"
              value={countedQty}
              onChange={(e) => setCountedQty(e.target.value)}
              placeholder="예: 15"
            />
          </div>
          <div className="field">
            <label htmlFor="adjustedDate">확인일</label>
            <input
              id="adjustedDate"
              className="input"
              type="date"
              value={adjustedDate}
              onChange={(e) => setAdjustedDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="adjustMemo">메모</label>
            <input
              id="adjustMemo"
              className="input"
              value={adjustMemo}
              onChange={(e) => setAdjustMemo(e.target.value)}
              placeholder="선택사항"
            />
          </div>
          <button type="button" className="btn-secondary" onClick={handleAddAdjustment} disabled={savingAdjustment}>
            {savingAdjustment ? '저장 중...' : '실사 결과 반영'}
          </button>

          <div className="date-range">
            <input
              type="date"
              className="input"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              aria-label="시작일"
            />
            <span className="date-range-sep">~</span>
            <input
              type="date"
              className="input"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              aria-label="종료일"
            />
          </div>
          <p className="hint">
            위 현재고·누적 수치는 항상 전체 기간 기준이고, 아래 내역 목록만 이 기간으로 좁혀서 볼 수 있어요.
          </p>

          <h2 className="section-title">사용 내역 ({visibleUsageRows.length}건)</h2>
          {usageRows.length === 0 && <p className="hint">아직 기록된 사용량이 없습니다.</p>}
          {usageRows.length > 0 && visibleUsageRows.length === 0 && (
            <p className="hint">이 기간에 사용 기록이 없습니다.</p>
          )}
          <ul className="history-list">
            {visibleUsageRows.map((r) => (
              <li key={r.id} className="history-row">
                <div className="history-row-main">
                  <span className="history-item">{r.used_date ?? '날짜 미입력'}</span>
                  <div className="history-row-main-end">
                    <span>
                      -{Number(r.used_qty).toLocaleString()}
                      {unitLabel}
                    </span>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="사용 내역 삭제"
                      onClick={() => setDeleteUsageTarget(r)}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                {r.memo && (
                  <div className="history-row-sub">
                    <span>{r.memo}</span>
                  </div>
                )}

                {deleteUsageTarget?.id === r.id && (
                  <div className="price-alert-box price-alert-box-danger">
                    <p className="price-alert-title">이 사용 내역을 삭제할까요?</p>
                    <p className="hint">잘못 입력한 사용량 기록만 지워지고, 되돌릴 수 없어요.</p>
                    <div className="invoice-form">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setDeleteUsageTarget(null)}
                        disabled={deletingUsage}
                      >
                        취소
                      </button>
                      <button type="button" className="btn-primary" onClick={handleDeleteUsage} disabled={deletingUsage}>
                        {deletingUsage ? '삭제 중...' : '삭제'}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>

          <h2 className="section-title">폐기 내역 ({visibleWasteRows.length}건)</h2>
          {wasteRows.length === 0 && <p className="hint">아직 기록된 폐기가 없습니다.</p>}
          {wasteRows.length > 0 && visibleWasteRows.length === 0 && (
            <p className="hint">이 기간에 폐기 기록이 없습니다.</p>
          )}
          <ul className="history-list">
            {visibleWasteRows.map((r) => (
              <li key={r.id} className="history-row">
                <div className="history-row-main">
                  <span className="history-item">{r.waste_date ?? '날짜 미입력'}</span>
                  <div className="history-row-main-end">
                    <span className="alert-up">
                      -{Number(r.qty).toLocaleString()}
                      {unitLabel}
                    </span>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="폐기 내역 삭제"
                      onClick={() => setDeleteWasteTarget(r)}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <div className="history-row-sub">
                  {r.reason && <span>{r.reason}</span>}
                  {r.memo && <span>{r.memo}</span>}
                </div>

                {deleteWasteTarget?.id === r.id && (
                  <div className="price-alert-box price-alert-box-danger">
                    <p className="price-alert-title">이 폐기 내역을 삭제할까요?</p>
                    <p className="hint">잘못 입력한 폐기 기록만 지워지고, 되돌릴 수 없어요.</p>
                    <div className="invoice-form">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setDeleteWasteTarget(null)}
                        disabled={deletingWaste}
                      >
                        취소
                      </button>
                      <button type="button" className="btn-primary" onClick={handleDeleteWaste} disabled={deletingWaste}>
                        {deletingWaste ? '삭제 중...' : '삭제'}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>

          <h2 className="section-title">실사 내역 ({visibleAdjustmentRows.length}건)</h2>
          {adjustmentRows.length === 0 && <p className="hint">아직 실사 기록이 없습니다.</p>}
          {adjustmentRows.length > 0 && visibleAdjustmentRows.length === 0 && (
            <p className="hint">이 기간에 실사 기록이 없습니다.</p>
          )}
          <ul className="history-list">
            {visibleAdjustmentRows.map((r) => (
              <li key={r.id} className="history-row">
                <div className="history-row-main">
                  <span className="history-item">{r.adjusted_date ?? '날짜 미입력'}</span>
                  <div className="history-row-main-end">
                    <span className={Number(r.delta) < 0 ? 'alert-up' : ''}>
                      {Number(r.delta) > 0 ? '+' : ''}
                      {Number(r.delta).toLocaleString()}
                      {unitLabel}
                    </span>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="실사 내역 삭제"
                      onClick={() => setDeleteAdjustmentTarget(r)}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <div className="history-row-sub">
                  {r.counted_qty != null && (
                    <span>
                      실사 결과 {Number(r.counted_qty).toLocaleString()}
                      {unitLabel}
                    </span>
                  )}
                  {r.memo && <span>{r.memo}</span>}
                </div>

                {deleteAdjustmentTarget?.id === r.id && (
                  <div className="price-alert-box price-alert-box-danger">
                    <p className="price-alert-title">이 실사 내역을 삭제할까요?</p>
                    <p className="hint">삭제하면 이 보정만큼 현재고 계산에서 다시 빠져요. 되돌릴 수 없어요.</p>
                    <div className="invoice-form">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setDeleteAdjustmentTarget(null)}
                        disabled={deletingAdjustment}
                      >
                        취소
                      </button>
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={handleDeleteAdjustment}
                        disabled={deletingAdjustment}
                      >
                        {deletingAdjustment ? '삭제 중...' : '삭제'}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>

          <h2 className="section-title">입고 내역 ({visibleReceipts.length}건)</h2>
          {receipts.length === 0 && <p className="hint">아직 입고 내역이 없습니다.</p>}
          {receipts.length > 0 && visibleReceipts.length === 0 && (
            <p className="hint">이 기간에 입고 내역이 없습니다.</p>
          )}
          <ul className="history-list">
            {visibleReceipts.map((r) => (
              <li key={r.id} className="history-row">
                <div className="history-row-main">
                  <span className="history-vendor">{r.vendor}</span>
                  <span>
                    +{r.quantity != null ? Number(r.quantity).toLocaleString() : '-'}
                    {unitLabel}
                  </span>
                </div>
                <div className="history-row-sub">
                  {r.invoice_date && <span>{r.invoice_date}</span>}
                  {r.unit_price != null && <span>단가 {Number(r.unit_price).toLocaleString()}원</span>}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
