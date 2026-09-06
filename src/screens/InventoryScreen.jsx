import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { reidentifyItem } from '../lib/reidentifyItem'

const UNIT_LABELS = { g: 'g', kg: 'kg', ea: '개', box: '박스', other: '기타' }
const NO_UNIT_KEY = 'none'

function stockKey(itemName, unit) {
  return `${itemName}||${unit ?? ''}`
}

export default function InventoryScreen() {
  const { store } = useStore()
  const navigate = useNavigate()

  const [rows, setRows] = useState([])
  const [pinnedNames, setPinnedNames] = useState(new Set())
  const [showAll, setShowAll] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [dataKey, setDataKey] = useState(0)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const [renameTarget, setRenameTarget] = useState(null)
  const [renameInput, setRenameInput] = useState('')
  const [renameUnit, setRenameUnit] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameMessage, setRenameMessage] = useState('')

  const [mergeTarget, setMergeTarget] = useState(null)
  const [mergeIntoKey, setMergeIntoKey] = useState('')
  const [merging, setMerging] = useState(false)
  const [mergeMessage, setMergeMessage] = useState('')

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
    ]).then(([invoicesRes, usageRes, wasteRes, adjustmentsRes, pinsRes]) => {
      const err = invoicesRes.error || usageRes.error || wasteRes.error || adjustmentsRes.error || pinsRes.error
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
    })

    setRenaming(false)
    if (err) {
      setError(err.message)
      return
    }
    if (priceNeedsReview) {
      setRenameMessage(
        '단위를 바꿨어요. 개/박스/기타처럼 자동으로 단가를 맞출 수 없는 단위라 과거 단가 숫자는 그대로 남아있어요 — 최근 입고 단가가 새 단위 기준으로 맞는지 확인해주세요.',
      )
    }
    setRenameTarget(null)
    setRenameInput('')
    setRenameUnit('')
    setDataKey((k) => k + 1)
  }

  const openMergeTarget = (r) => {
    setMergeTarget(r)
    setMergeIntoKey('')
    setMergeMessage('')
    setError('')
  }

  const closeMergeTarget = () => {
    setMergeTarget(null)
    setMergeIntoKey('')
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
          <p className="hint">
            "{r.itemName}"으로 저장된 모든 입고·사용·폐기·실사 기록이 새 이름/단위로 한 번에 바뀌어요. g↔kg 단위 변경은
            과거 단가도 자동으로 맞춰지고, 그 외 단위 변경은 단가는 그대로 두고 단위만 바뀌어요. 되돌릴 수 없어요.
          </p>
          <div className="invoice-form">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setRenameTarget(null)
                setRenameInput('')
                setRenameUnit('')
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
          {mergeIntoKey && (
            <p className="hint">
              "{r.itemName}"의 모든 입고·사용·폐기·실사 기록이 선택한 물품으로 옮겨지고, "{r.itemName}"은 사라져요.
              정말 같은 물품이 맞는지 확인해주세요 — 되돌릴 수 없어요.
            </p>
          )}
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
