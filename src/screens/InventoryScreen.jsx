import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useHistoryState } from '../hooks/usePageHistoryState'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { reidentifyItem, weightConversionFactor } from '../lib/reidentifyItem'
import { UNIT_LABELS } from '../lib/units'
import { stockKey } from '../lib/stockKey'
import { STOCK_STATUS, stockStatus } from '../lib/stockStatus'
import { downloadCsv, rowsToCsv } from '../lib/csvExport'
import ActionMenu from '../components/ActionMenu'

const NO_UNIT_KEY = 'none'

export default function InventoryScreen() {
  const { store } = useStore()
  const navigate = useNavigate()

  const [rows, setRows] = useState([])
  const [pinnedNames, setPinnedNames] = useState(new Set())
  const [recipeUnitByItem, setRecipeUnitByItem] = useState(new Map())
  // 보기(관심/전체/부족/적음)·검색어는 이 화면의 방문 기록에 남겨, 재고 상세를 보고 돌아와도 그대로 보이게 한다.
  // null이면 관심 품목이 있을 때 관심, 없을 때 전체로 시작한다.
  const [filter, setFilter] = useHistoryState('filter', null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [dataKey, setDataKey] = useState(0)
  const [searchQuery, setSearchQuery] = useHistoryState('searchQuery', '')

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
        if (!stock.has(key)) stock.set(key, { itemName, unit, received: 0, receiptCount: 0, used: 0, wasted: 0, adjusted: 0 })
        return stock.get(key)
      }

      for (const row of invoicesRes.data ?? []) {
        if (row.quantity == null) continue
        const entry = ensure(row.item_name, row.unit)
        entry.received += Number(row.quantity)
        entry.receiptCount += 1
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
        .map((r) => {
          const current = r.received - r.used - r.wasted + r.adjusted
          return { ...r, current, status: stockStatus({ current, received: r.received, receiptCount: r.receiptCount }) }
        })
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
  const shortCount = rows.filter((r) => r.status === 'short').length
  const lowCount = rows.filter((r) => r.status === 'low').length
  const pinnedCount = rows.filter((r) => pinnedNames.has(r.itemName)).length
  const activeFilter = filter ?? (pinnedCount > 0 ? 'pinned' : 'all')
  const filteredRows = rows.filter((r) => {
    if (activeFilter === 'pinned') return pinnedNames.has(r.itemName)
    if (activeFilter === 'short') return r.status === 'short'
    if (activeFilter === 'low') return r.status === 'low'
    return true
  })
  const visibleRows = trimmedQuery ? searchResults : filteredRows

  const FILTERS = [
    { key: 'all', label: '전체', count: rows.length },
    { key: 'pinned', label: '★ 관심', count: pinnedCount },
    { key: 'short', label: '부족', count: shortCount },
    { key: 'low', label: '적음', count: lowCount },
  ]

  const handleExport = () => {
    const unitLabel = (r) => (r.unit ? UNIT_LABELS[r.unit] ?? r.unit : '')
    const csv = rowsToCsv(rows, [
      { label: '품목명', value: 'itemName' },
      { label: '단위', value: unitLabel },
      { label: '현재고', value: 'current' },
      { label: '입고', value: 'received' },
      { label: '사용', value: 'used' },
      { label: '폐기', value: 'wasted' },
      { label: '실사 보정', value: 'adjusted' },
      { label: '상태', value: (r) => STOCK_STATUS[r.status].label },
      { label: '관심 품목', value: (r) => (pinnedNames.has(r.itemName) ? '★' : '') },
    ])
    const today = new Date().toISOString().slice(0, 10)
    downloadCsv(`재고현황_${store.name}_${today}.csv`, csv)
  }

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

  const detailPath = (r) => `/inventory/${encodeURIComponent(r.itemName)}/${r.unit ?? NO_UNIT_KEY}`
  const unitText = (r) => (r.unit ? UNIT_LABELS[r.unit] ?? r.unit : '')

  const renderRow = (r, { pinned }) => (
    <li key={stockKey(r.itemName, r.unit)} className="data-row inv-row">
      <div className="inv-line">
        <button
          type="button"
          className={`pin-btn${pinned ? ' pin-btn-on' : ''}`}
          aria-label={pinned ? `${r.itemName} 관심 품목에서 빼기` : `${r.itemName} 관심 품목에 추가`}
          title={pinned ? '관심 품목에서 빼기' : '관심 품목에 추가'}
          onClick={() => (pinned ? handleUnpin(r) : handlePin(r))}
        >
          {pinned ? '★' : '☆'}
        </button>
        <button type="button" className="cost-row-btn inv-main" onClick={() => navigate(detailPath(r))}>
          <span className="inv-name">
            <span className="history-item">{r.itemName}</span>
            {r.unit === 'box' && !recipeUnitByItem.has(r.itemName) && (
              <span
                className="inv-badge inv-badge-warn"
                title='박스당 개수/kg 환산 전이에요. "이름 수정" 또는 "레시피 단위"에서 등록할 수 있어요.'
              >
                📦 환산 필요
              </span>
            )}
            {recipeUnitByItem.has(r.itemName) &&
              (() => {
                const { recipeUnit, ratio } = recipeUnitByItem.get(r.itemName)
                const recipeUnitLabel = UNIT_LABELS[recipeUnit] ?? recipeUnit
                return (
                  <span className="inv-badge" title={`레시피에서는 ${recipeUnitLabel} 단위로 원가를 계산해요`}>
                    🍱 1{r.unit ? unitText(r) : '단위 없음'}={ratio}
                    {recipeUnitLabel}
                  </span>
                )
              })()}
          </span>
          <span className={`inv-current${r.current < 0 ? ' alert-up' : ''}`}>
            {r.current.toLocaleString()}
            {unitText(r)}
          </span>
          <span className="inv-num" data-label="입고">
            {r.received.toLocaleString()}
          </span>
          <span className="inv-num" data-label="사용">
            {r.used.toLocaleString()}
          </span>
          <span className="inv-num" data-label="폐기">
            {r.wasted.toLocaleString()}
          </span>
          <span className="inv-status">
            <span className={`status-tag ${STOCK_STATUS[r.status].className}`}>{STOCK_STATUS[r.status].label}</span>
          </span>
        </button>
        <div className="inv-actions">
          <ActionMenu
            items={[
              {
                label: '이름 수정',
                onClick: () => {
                  setRenameTarget({ itemName: r.itemName, unit: r.unit })
                  setRenameInput(r.itemName)
                  setRenameUnit(r.unit)
                  setRenameRatio('')
                  setRenameMessage('')
                },
              },
              { label: '합치기', onClick: () => openMergeTarget(r) },
              { label: '레시피 단위 설정', onClick: () => openRecipeUnit(r) },
              { label: '재고 실사', onClick: () => navigate(detailPath(r), { state: { scrollTo: 'stock-count' } }) },
            ]}
          />
        </div>
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
        <div className="page-title-row">
          <div>
            <h1>재고 관리</h1>
            <p className="subtitle">{store.name} · 입고량에서 사용량을 뺀 현재고예요</p>
          </div>
          {rows.length > 0 && (
            <div className="page-actions">
              <button type="button" className="action-btn" onClick={handleExport}>
                ⬇ 엑셀 저장
              </button>
            </div>
          )}
        </div>
      </div>

      {!supabase && <p className="hint">Supabase가 설정되지 않았습니다.</p>}
      {loading && <p className="hint">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}
      {renameMessage && <p className="hint">{renameMessage}</p>}
      {mergeMessage && <p className="hint">{mergeMessage}</p>}
      {!loading && !error && rows.length === 0 && <p className="hint">입고 내역이 있어야 재고를 계산할 수 있어요.</p>}

      {!loading && rows.length > 0 && (
        <>
          <div className="kpi-grid">
            <button type="button" className="kpi-card" onClick={() => setFilter('all')}>
              <span className="kpi-label">전체 품목</span>
              <strong className="kpi-value">{rows.length}개</strong>
            </button>
            <button type="button" className="kpi-card" onClick={() => setFilter('short')}>
              <span className="kpi-label">재고 부족(마이너스)</span>
              <strong className={`kpi-value${shortCount > 0 ? ' alert-up' : ''}`}>{shortCount}개</strong>
            </button>
            <button type="button" className="kpi-card" onClick={() => setFilter('low')}>
              <span className="kpi-label">재고 적음</span>
              <strong className={`kpi-value${lowCount > 0 ? ' cost-warning' : ''}`}>{lowCount}개</strong>
            </button>
            <button type="button" className="kpi-card" onClick={() => setFilter('pinned')}>
              <span className="kpi-label">관심 품목</span>
              <strong className="kpi-value">{pinnedCount}개</strong>
            </button>
          </div>

          <div className="panel">
            <div className="toolbar">
              <input
                type="search"
                className="input toolbar-search"
                placeholder="🔍 품목명으로 검색"
                aria-label="품목 검색"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <div className="toolbar-chips">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    className={`chip${!trimmedQuery && activeFilter === f.key ? ' chip-active' : ''}`}
                    onClick={() => {
                      setFilter(f.key)
                      setSearchQuery('')
                    }}
                  >
                    {f.label} {f.count}
                  </button>
                ))}
              </div>
            </div>
            <p className="hint panel-hint">
              ☆를 누르면 관심 품목에 추가돼요. 상태는 평소 한 번 입고량의 절반보다 적게 남으면 "적음", 마이너스면
              "부족"으로 표시해요.
            </p>

            {trimmedQuery && <p className="hint">검색 결과 {searchResults.length}개</p>}
            {visibleRows.length === 0 && (
              <p className="hint">
                {trimmedQuery
                  ? '일치하는 품목이 없어요.'
                  : activeFilter === 'pinned'
                    ? '아직 관심 품목이 없어요. "전체"에서 ☆를 눌러 골라주세요.'
                    : '해당하는 품목이 없어요.'}
              </p>
            )}
            {visibleRows.length > 0 && (
              <ul className="data-list">
                <li className="data-head inv-line" aria-hidden="true">
                  <span className="pin-btn-space" />
                  <span className="inv-main">
                    <span className="inv-name">품목명</span>
                    <span className="inv-current">현재고</span>
                    <span className="inv-num">입고</span>
                    <span className="inv-num">사용</span>
                    <span className="inv-num">폐기</span>
                    <span className="inv-status">상태</span>
                  </span>
                  <span className="inv-actions">관리</span>
                </li>
                {visibleRows.map((r) => renderRow(r, { pinned: pinnedNames.has(r.itemName) }))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}
