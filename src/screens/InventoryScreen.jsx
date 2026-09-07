import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { reidentifyItem, weightConversionFactor } from '../lib/reidentifyItem'
import { UNIT_LABELS } from '../lib/units'
import { stockKey } from '../lib/stockKey'

const NO_UNIT_KEY = 'none'

export default function InventoryScreen() {
  const { store } = useStore()
  const navigate = useNavigate()

  const [rows, setRows] = useState([])
  const [pinnedNames, setPinnedNames] = useState(new Set())
  const [recipeUnitByItem, setRecipeUnitByItem] = useState(new Map())
  const [showAll, setShowAll] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [dataKey, setDataKey] = useState(0)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const [renameTarget, setRenameTarget] = useState(null)
  const [renameInput, setRenameInput] = useState('')
  const [renameUnit, setRenameUnit] = useState('')
  const [renameRatio, setRenameRatio] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameMessage, setRenameMessage] = useState('')

  const [mergeTarget, setMergeTarget] = useState(null)
  const [mergeIntoKey, setMergeIntoKey] = useState('')
  const [mergeRatio, setMergeRatio] = useState('')
  const [merging, setMerging] = useState(false)
  const [mergeMessage, setMergeMessage] = useState('')

  const [recipeUnitTarget, setRecipeUnitTarget] = useState(null)
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
    Promise.all([
      supabase.from('invoices').select('item_name, unit, quantity').eq('store_code', store.code),
      supabase.from('stock_usage').select('item_name, unit, used_qty').eq('store_code', store.code),
      supabase.from('waste_records').select('item_name, unit, qty').eq('store_code', store.code),
      supabase.from('stock_adjustments').select('item_name, unit, delta').eq('store_code', store.code),
      supabase.from('pinned_items').select('item_name').eq('store_code', store.code),
      supabase.from('item_recipe_units').select('item_name, recipe_unit, ratio').eq('store_code', store.code),
    ]).then(([invoicesRes, usageRes, wasteRes, adjustmentsRes, pinsRes, recipeUnitsRes]) => {
      const err =
        invoicesRes.error || usageRes.error || wasteRes.error || adjustmentsRes.error || pinsRes.error || recipeUnitsRes.error
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }

      const stock = new Map()
      const ensure = (itemName, unit) => {
        const key = stockKey(itemName, unit)
        if (!stock.has(key)) stock.set(key, { itemName, unit, received: 0, used: 0, wasted: 0, adjusted: 0 })
        return stock.get(key)
      }

      for (const row of invoicesRes.data ?? []) {
        if (row.quantity == null) continue
        ensure(row.item_name, row.unit).received += Number(row.quantity)
      }
      for (const row of usageRes.data ?? []) {
        ensure(row.item_name, row.unit).used += Number(row.used_qty)
      }
      for (const row of wasteRes.data ?? []) {
        ensure(row.item_name, row.unit).wasted += Number(row.qty)
      }
      for (const row of adjustmentsRes.data ?? []) {
        ensure(row.item_name, row.unit).adjusted += Number(row.delta)
      }

      const list = [...stock.values()]
        .map((r) => ({ ...r, current: r.received - r.used - r.wasted + r.adjusted }))
        .sort((a, b) => a.itemName.localeCompare(b.itemName))

      setRows(list)
      setPinnedNames(new Set((pinsRes.data ?? []).map((p) => p.item_name)))
      setRecipeUnitByItem(
        new Map((recipeUnitsRes.data ?? []).map((r) => [r.item_name, { recipeUnit: r.recipe_unit, ratio: Number(r.ratio) }])),
      )
      setLoading(false)
    })
  }, [store, dataKey])

  if (!store) return null

  const trimmedQuery = searchQuery.trim()
  const searchResults = trimmedQuery ? rows.filter((r) => r.itemName.includes(trimmedQuery)) : []
  const pinnedRows = rows.filter((r) => pinnedNames.has(r.itemName))
  const otherRows = rows.filter((r) => !pinnedNames.has(r.itemName))
  const effectiveShowAll = showAll || pinnedNames.size === 0

  const handlePin = async (r) => {
    if (!supabase) return
    const { error: err } = await supabase
      .from('pinned_items')
      .upsert({ store_code: store.code, item_name: r.itemName }, { onConflict: 'store_code,item_name' })
    if (err) {
      setError(err.message)
      return
    }
    setDataKey((k) => k + 1)
  }

  const handleUnpin = async (r) => {
    if (!supabase) return
    const { error: err } = await supabase
      .from('pinned_items')
      .delete()
      .eq('store_code', store.code)
      .eq('item_name', r.itemName)
    if (err) {
      setError(err.message)
      return
    }
    setDataKey((k) => k + 1)
  }

  // 물품명(+단위)으로 저장된 모든 과거 기록(입고·사용·폐기·실사 보정, 관심 품목, 재료 매칭)에
  // 걸쳐 한 번에 새 이름/단위로 바꾼다. 오타·표기 차이로 흩어진 같은 물품을 하나로 정리하거나,
  // 잘못 고른 단위를 바로잡기 위함이다.
  const handleRename = async () => {
    const newName = renameInput.trim()
    if (!renameTarget || !newName || !supabase) return
    if (newName === renameTarget.itemName && renameUnit === renameTarget.unit) {
      setRenameTarget(null)
      return
    }
    setRenaming(true)
    setError('')
    setRenameMessage('')

    const { error: err, priceNeedsReview } = await reidentifyItem({
      supabase,
      storeCode: store.code,
      from: renameTarget,
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
    setRenameTarget(null)
    setRenameInput('')
    setRenameUnit('')
    setRenameRatio('')
    setDataKey((k) => k + 1)
  }

  const openMergeTarget = (r) => {
    setMergeTarget(r)
    setMergeIntoKey('')
    setMergeRatio('')
    setMergeMessage('')
    setError('')
  }

  const closeMergeTarget = () => {
    setMergeTarget(null)
    setMergeIntoKey('')
    setMergeRatio('')
  }

  // 다른 이름/단위로 잘못 인식된 같은 물품을 하나로 합친다. 되돌릴 수 없는 작업이라 대상을
  // 고른 뒤 한 번 더 확인받는다.
  const handleMerge = async () => {
    if (!mergeTarget || !mergeIntoKey || !supabase) return
    const into = rows.find((r) => stockKey(r.itemName, r.unit) === mergeIntoKey)
    if (!into) return

    setMerging(true)
    setError('')
    setMergeMessage('')

    const { error: err, priceNeedsReview } = await reidentifyItem({
      supabase,
      storeCode: store.code,
      from: { itemName: mergeTarget.itemName, unit: mergeTarget.unit },
      to: { itemName: into.itemName, unit: into.unit },
      customRatio: mergeRatio ? Number(mergeRatio) : null,
    })

    setMerging(false)
    if (err) {
      setError(err.message)
      return
    }
    if (priceNeedsReview) {
      setMergeMessage(
        '합쳤어요. 단위가 달라서 과거 단가 숫자는 자동으로 못 맞췄어요 — 최근 입고 단가가 맞는지 확인해주세요.',
      )
    }
    closeMergeTarget()
    setDataKey((k) => k + 1)
  }

  const openRecipeUnit = (r) => {
    const existing = recipeUnitByItem.get(r.itemName)
    setRecipeUnitTarget(r)
    setRecipeUnitSelect(existing?.recipeUnit ?? 'ea')
    setRecipeUnitRatio(existing ? String(existing.ratio) : '')
    setError('')
  }

  const closeRecipeUnit = () => {
    setRecipeUnitTarget(null)
    setRecipeUnitRatio('')
  }

  // 입고 단위(예: 박스)는 그대로 두고, 레시피에서만 다른 단위(예: 개)로 원가를 계산하고 싶을 때
  // 쓰는 환산 설정. "1 입고단위 = ratio 레시피단위"로 저장해두면, 이 물품을 매칭한 재료의 원가는
  // (입고 단가 ÷ ratio)로 계산된다. 물품 단위 자체는 안 바뀌고, 명세표 입력은 지금처럼 그대로다.
  const handleSaveRecipeUnit = async () => {
    if (!recipeUnitTarget || !supabase) return
    const ratio = Number(recipeUnitRatio)
    if (!recipeUnitRatio || !Number.isFinite(ratio) || ratio <= 0) {
      setError('환산값을 0보다 크게 입력하세요.')
      return
    }
    setSavingRecipeUnit(true)
    setError('')
    const { error: err } = await supabase.from('item_recipe_units').upsert(
      { store_code: store.code, item_name: recipeUnitTarget.itemName, recipe_unit: recipeUnitSelect, ratio },
      { onConflict: 'store_code,item_name' },
    )
    setSavingRecipeUnit(false)
    if (err) {
      setError(err.message)
      return
    }
    closeRecipeUnit()
    setDataKey((k) => k + 1)
  }

  const handleDeleteRecipeUnit = async () => {
    if (!recipeUnitTarget || !supabase) return
    setSavingRecipeUnit(true)
    setError('')
    const { error: err } = await supabase
      .from('item_recipe_units')
      .delete()
      .eq('store_code', store.code)
      .eq('item_name', recipeUnitTarget.itemName)
    setSavingRecipeUnit(false)
    if (err) {
      setError(err.message)
      return
    }
    closeRecipeUnit()
    setDataKey((k) => k + 1)
  }

  const renderRow = (r, { pinned }) => (
    <li key={stockKey(r.itemName, r.unit)} className="history-row">
      <button
        type="button"
        className="cost-row-btn"
        onClick={() => navigate(`/inventory/${encodeURIComponent(r.itemName)}/${r.unit ?? NO_UNIT_KEY}`)}
      >
        <div className="history-row-main">
          <span className="history-item">{r.itemName}</span>
          <span className={r.current < 0 ? 'alert-up' : ''}>
            {r.current.toLocaleString()}
            {r.unit ? UNIT_LABELS[r.unit] ?? r.unit : ''}
          </span>
        </div>
        <div className="history-row-sub">
          <span>입고 {r.received.toLocaleString()}</span>
          <span>사용 {r.used.toLocaleString()}</span>
          {r.wasted > 0 && <span>폐기 {r.wasted.toLocaleString()}</span>}
        </div>
        {r.unit === 'box' && !recipeUnitByItem.has(r.itemName) && (
          <p className="hint">📦 박스당 개수/kg 환산 전이에요 · "이름 수정" 또는 "레시피 단위 설정"에서 등록할 수 있어요</p>
        )}
        {recipeUnitByItem.has(r.itemName) && (
          <p className="hint">
            🍱 레시피 단위: {UNIT_LABELS[recipeUnitByItem.get(r.itemName).recipeUnit] ?? recipeUnitByItem.get(r.itemName).recipeUnit}
            {' '}(1{r.unit ? UNIT_LABELS[r.unit] ?? r.unit : '단위 없음'} = {recipeUnitByItem.get(r.itemName).ratio}
            {UNIT_LABELS[recipeUnitByItem.get(r.itemName).recipeUnit] ?? recipeUnitByItem.get(r.itemName).recipeUnit})
          </p>
        )}
      </button>
      <div className="inventory-row-actions">
        <button
          type="button"
          className="link-btn"
          onClick={(e) => {
            e.stopPropagation()
            setRenameTarget({ itemName: r.itemName, unit: r.unit })
            setRenameInput(r.itemName)
            setRenameUnit(r.unit)
            setRenameRatio('')
            setRenameMessage('')
          }}
        >
          이름 수정
        </button>
        <button
          type="button"
          className="link-btn"
          onClick={(e) => {
            e.stopPropagation()
            openMergeTarget(r)
          }}
        >
          합치기
        </button>
        <button
          type="button"
          className="link-btn"
          onClick={(e) => {
            e.stopPropagation()
            openRecipeUnit(r)
          }}
        >
          레시피 단위 설정
        </button>
        <button
          type="button"
          className="link-btn"
          onClick={(e) => {
            e.stopPropagation()
            if (pinned) {
              handleUnpin(r)
            } else {
              handlePin(r)
            }
          }}
        >
          {pinned ? '숨기기' : '+ 관심 품목에 추가'}
        </button>
      </div>

      {renameTarget && renameTarget.itemName === r.itemName && renameTarget.unit === r.unit && (
        <div className="price-alert-box" onClick={(e) => e.stopPropagation()}>
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
          {renameUnit !== r.unit && weightConversionFactor(r.unit, renameUnit) == null && (
            <div className="field">
              <label htmlFor="renameRatio">
                1{r.unit ? UNIT_LABELS[r.unit] ?? r.unit : '단위 없음'} = 몇 {UNIT_LABELS[renameUnit] ?? renameUnit}
                인가요? (선택)
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
            "{r.itemName}"으로 저장된 모든 입고·사용·폐기·실사 기록이 새 이름/단위로 한 번에 바뀌어요. g↔kg 단위 변경은
            과거 단가도 자동으로 맞춰지고, 그 외 단위 변경은 위에 환산값을 입력하면 그 값으로, 안 입력하면 단가는
            그대로 두고 단위만 바뀌어요. 되돌릴 수 없어요.
          </p>
          <div className="invoice-form">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setRenameTarget(null)
                setRenameInput('')
                setRenameUnit('')
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

      {mergeTarget && mergeTarget.itemName === r.itemName && mergeTarget.unit === r.unit && (
        <div className="price-alert-box price-alert-box-danger" onClick={(e) => e.stopPropagation()}>
          <p className="price-alert-title">"{r.itemName}"을(를) 어느 물품과 합칠까요?</p>
          <div className="field">
            <select className="select select-block" value={mergeIntoKey} onChange={(e) => setMergeIntoKey(e.target.value)}>
              <option value="">합칠 물품을 선택하세요</option>
              {rows
                .filter((other) => stockKey(other.itemName, other.unit) !== stockKey(r.itemName, r.unit))
                .map((other) => (
                  <option key={stockKey(other.itemName, other.unit)} value={stockKey(other.itemName, other.unit)}>
                    {other.itemName} ({other.unit ? UNIT_LABELS[other.unit] ?? other.unit : '단위 없음'})
                  </option>
                ))}
            </select>
          </div>
          {mergeIntoKey &&
            (() => {
              const into = rows.find((other) => stockKey(other.itemName, other.unit) === mergeIntoKey)
              const needsRatio = into && into.unit !== r.unit && weightConversionFactor(r.unit, into.unit) == null
              return (
                <>
                  {needsRatio && (
                    <div className="field">
                      <label htmlFor="mergeRatio">
                        1{r.unit ? UNIT_LABELS[r.unit] ?? r.unit : '단위 없음'} = 몇{' '}
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
                    "{r.itemName}"의 모든 입고·사용·폐기·실사 기록이 선택한 물품으로 옮겨지고, "{r.itemName}"은
                    사라져요. 정말 같은 물품이 맞는지 확인해주세요 — 되돌릴 수 없어요.
                  </p>
                </>
              )
            })()}
          <div className="invoice-form">
            <button type="button" className="btn-secondary" onClick={closeMergeTarget} disabled={merging}>
              취소
            </button>
            <button type="button" className="btn-primary" onClick={handleMerge} disabled={merging || !mergeIntoKey}>
              {merging ? '합치는 중...' : '합치기'}
            </button>
          </div>
        </div>
      )}

      {recipeUnitTarget && recipeUnitTarget.itemName === r.itemName && recipeUnitTarget.unit === r.unit && (
        <div className="price-alert-box" onClick={(e) => e.stopPropagation()}>
          <p className="price-alert-title">레시피 단위 설정</p>
          <p className="hint">
            입고는 지금처럼 "{r.unit ? UNIT_LABELS[r.unit] ?? r.unit : '단위 없음'}"으로 그대로 하고, 레시피에서만 다른
            단위로 원가를 계산해요. 물품의 입고 단위 자체는 안 바뀝니다.
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
              1{r.unit ? UNIT_LABELS[r.unit] ?? r.unit : '단위 없음'} = 몇 {UNIT_LABELS[recipeUnitSelect] ?? recipeUnitSelect}
              인가요?
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
            <button type="button" className="btn-secondary" onClick={closeRecipeUnit} disabled={savingRecipeUnit}>
              취소
            </button>
            {recipeUnitByItem.has(r.itemName) && (
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
    </li>
  )

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/menu')}>
          ← 메인 메뉴
        </button>
        <h1>재고 관리</h1>
        <p className="subtitle">{store.name} · 입고량에서 사용량을 뺀 현재고예요</p>
      </div>

      {!supabase && <p className="hint">Supabase가 설정되지 않았습니다.</p>}
      {loading && <p className="hint">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}
      {renameMessage && <p className="hint">{renameMessage}</p>}
      {mergeMessage && <p className="hint">{mergeMessage}</p>}
      {!loading && !error && rows.length === 0 && <p className="hint">입고 내역이 있어야 재고를 계산할 수 있어요.</p>}

      {!loading && rows.length > 0 && (
        <>
          <div className="history-header">
            <h2 className="section-title">관심 품목</h2>
            <button
              type="button"
              className="icon-btn"
              aria-label="품목 검색"
              onClick={() => {
                setSearchOpen((v) => !v)
                setSearchQuery('')
              }}
            >
              🔍
            </button>
          </div>

          {searchOpen && (
            <div className="field">
              <input
                type="text"
                className="input"
                placeholder="품목명으로 검색"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />
            </div>
          )}

          {trimmedQuery ? (
            <>
              <p className="hint">검색 결과 {searchResults.length}개</p>
              {searchResults.length === 0 && <p className="hint">일치하는 품목이 없어요.</p>}
              <ul className="history-list">
                {searchResults.map((r) => renderRow(r, { pinned: pinnedNames.has(r.itemName) }))}
              </ul>
            </>
          ) : (
            <>
              {pinnedNames.size === 0 && <p className="hint">아직 선택한 품목이 없어요. 아래 전체 목록에서 골라주세요.</p>}
              {pinnedNames.size > 0 && (
                <ul className="history-list">{pinnedRows.map((r) => renderRow(r, { pinned: true }))}</ul>
              )}

              {effectiveShowAll && (
                <>
                  {pinnedNames.size > 0 && <h2 className="section-title">전체 품목</h2>}
                  <ul className="history-list">{otherRows.map((r) => renderRow(r, { pinned: false }))}</ul>
                  {pinnedNames.size > 0 && otherRows.length === 0 && (
                    <p className="hint">모든 품목을 관심 품목에 추가했어요.</p>
                  )}
                </>
              )}

              {pinnedNames.size > 0 && (
                <button type="button" className="btn-secondary" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? '접기' : `품목 모두보기 (전체 ${rows.length}개)`}
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
