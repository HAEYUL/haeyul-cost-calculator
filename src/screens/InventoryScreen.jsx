import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'

const UNIT_LABELS = { g: 'g', kg: 'kg', ea: '개', other: '기타' }
const NO_UNIT_KEY = 'none'

function stockKey(itemName, unit) {
  return `${itemName}||${unit ?? ''}`
}

function unitEqFilter(query, unit) {
  return unit == null ? query.is('unit', null) : query.eq('unit', unit)
}

export default function InventoryScreen() {
  const { store } = useStore()
  const navigate = useNavigate()

  const [rows, setRows] = useState([])
  const [pinnedKeys, setPinnedKeys] = useState(new Set())
  const [showAll, setShowAll] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [dataKey, setDataKey] = useState(0)

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
      supabase.from('inventory_pins').select('item_name, unit').eq('store_code', store.code),
    ]).then(([invoicesRes, usageRes, pinsRes]) => {
      const err = invoicesRes.error || usageRes.error || pinsRes.error
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }

      const stock = new Map()
      const ensure = (itemName, unit) => {
        const key = stockKey(itemName, unit)
        if (!stock.has(key)) stock.set(key, { itemName, unit, received: 0, used: 0 })
        return stock.get(key)
      }

      for (const row of invoicesRes.data ?? []) {
        if (row.quantity == null) continue
        ensure(row.item_name, row.unit).received += Number(row.quantity)
      }
      for (const row of usageRes.data ?? []) {
        ensure(row.item_name, row.unit).used += Number(row.used_qty)
      }

      const list = [...stock.values()]
        .map((r) => ({ ...r, current: r.received - r.used }))
        .sort((a, b) => a.itemName.localeCompare(b.itemName))

      setRows(list)
      setPinnedKeys(new Set((pinsRes.data ?? []).map((p) => stockKey(p.item_name, p.unit))))
      setLoading(false)
    })
  }, [store, dataKey])

  if (!store) return null

  const pinnedRows = rows.filter((r) => pinnedKeys.has(stockKey(r.itemName, r.unit)))
  const otherRows = rows.filter((r) => !pinnedKeys.has(stockKey(r.itemName, r.unit)))
  const effectiveShowAll = showAll || pinnedKeys.size === 0

  const handlePin = async (r) => {
    if (!supabase) return
    const { error: err } = await supabase
      .from('inventory_pins')
      .upsert({ store_code: store.code, item_name: r.itemName, unit: r.unit }, { onConflict: 'store_code,item_name,unit' })
    if (err) {
      setError(err.message)
      return
    }
    setDataKey((k) => k + 1)
  }

  const handleUnpin = async (r) => {
    if (!supabase) return
    let query = supabase.from('inventory_pins').delete().eq('store_code', store.code).eq('item_name', r.itemName)
    query = unitEqFilter(query, r.unit)
    const { error: err } = await query
    if (err) {
      setError(err.message)
      return
    }
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
        </div>
      </button>
      <div className="inventory-row-actions">
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
      {!loading && !error && rows.length === 0 && <p className="hint">입고 내역이 있어야 재고를 계산할 수 있어요.</p>}

      {!loading && rows.length > 0 && (
        <>
          <h2 className="section-title">관심 품목</h2>
          {pinnedKeys.size === 0 && <p className="hint">아직 선택한 품목이 없어요. 아래 전체 목록에서 골라주세요.</p>}
          {pinnedKeys.size > 0 && (
            <ul className="history-list">{pinnedRows.map((r) => renderRow(r, { pinned: true }))}</ul>
          )}

          {pinnedKeys.size > 0 && (
            <button type="button" className="btn-secondary" onClick={() => setShowAll((v) => !v)}>
              {showAll ? '접기' : `품목 모두보기 (전체 ${rows.length}개)`}
            </button>
          )}

          {effectiveShowAll && (
            <>
              {pinnedKeys.size > 0 && <h2 className="section-title">전체 품목</h2>}
              <ul className="history-list">{otherRows.map((r) => renderRow(r, { pinned: false }))}</ul>
              {pinnedKeys.size > 0 && otherRows.length === 0 && <p className="hint">모든 품목을 관심 품목에 추가했어요.</p>}
            </>
          )}
        </>
      )}
    </div>
  )
}
