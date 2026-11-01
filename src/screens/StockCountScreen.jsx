import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { stockKey } from '../lib/stockKey'
import { UNIT_LABELS } from '../lib/units'
import { todayStr } from '../lib/vendorLedger'

const COUNT_MEMO = '실재고 조사'

// 실재고 조사: 품목마다 실제로 남은 수량만 입력한다. 저장하면 재고 관리 화면의 [재고 실사]와 똑같이
// "실사 보정"(남은 수량 − 장부 재고)으로 기록돼 관리자 재고·사용량 계산에 바로 반영된다.
// 매니저에게는 장부 재고를 보여주지 않는다(보고 맞춰 적지 않도록). 관리자는 장부 재고도 함께 본다.
export default function StockCountScreen() {
  const { store, isAdmin } = useStore()
  const navigate = useNavigate()

  const [items, setItems] = useState([])
  const [counts, setCounts] = useState({})
  const [countDate, setCountDate] = useState(todayStr())
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    Promise.all([
      supabase.from('invoices').select('item_name, unit, quantity').eq('store_code', store.code),
      supabase.from('stock_usage').select('item_name, unit, used_qty').eq('store_code', store.code),
      supabase.from('waste_records').select('item_name, unit, qty').eq('store_code', store.code),
      supabase.from('stock_adjustments').select('item_name, unit, delta, adjusted_date').eq('store_code', store.code),
      supabase.from('pinned_items').select('item_name').eq('store_code', store.code),
    ]).then(([invoicesRes, usageRes, wasteRes, adjustmentsRes, pinsRes]) => {
      if (cancelled) return
      const err = invoicesRes.error || usageRes.error || wasteRes.error || adjustmentsRes.error || pinsRes.error
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }
      const stock = new Map()
      const ensure = (itemName, unit) => {
        const key = stockKey(itemName, unit)
        if (!stock.has(key)) stock.set(key, { key, itemName, unit, current: 0, lastCount: null })
        return stock.get(key)
      }
      for (const r of invoicesRes.data ?? []) {
        if (r.quantity == null) continue
        ensure(r.item_name, r.unit).current += Number(r.quantity)
      }
      for (const r of usageRes.data ?? []) ensure(r.item_name, r.unit).current -= Number(r.used_qty)
      for (const r of wasteRes.data ?? []) ensure(r.item_name, r.unit).current -= Number(r.qty)
      for (const r of adjustmentsRes.data ?? []) {
        const row = ensure(r.item_name, r.unit)
        row.current += Number(r.delta)
        if (r.adjusted_date && (!row.lastCount || r.adjusted_date > row.lastCount)) row.lastCount = r.adjusted_date
      }
      const pinned = new Set((pinsRes.data ?? []).map((p) => p.item_name))
      const list = [...stock.values()]
        .map((r) => ({ ...r, pinned: pinned.has(r.itemName) }))
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.itemName.localeCompare(b.itemName, 'ko'))
      setItems(list)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [store, reloadKey])

  const filtered = useMemo(() => {
    const q = search.trim()
    return q ? items.filter((r) => r.itemName.includes(q)) : items
  }, [items, search])

  const entered = items.filter((r) => counts[r.key] !== undefined && counts[r.key] !== '')

  const handleSave = async () => {
    setError('')
    setMessage('')
    if (entered.length === 0) {
      setError('남은 수량을 입력한 품목이 없어요.')
      return
    }
    if (!countDate) {
      setError('조사 날짜를 입력하세요.')
      return
    }
    const rows = entered.map((r) => {
      const counted = Number(counts[r.key])
      return {
        store_code: store.code,
        item_name: r.itemName,
        unit: r.unit,
        delta: Math.round((counted - r.current) * 1000) / 1000,
        counted_qty: counted,
        adjusted_date: countDate,
        memo: COUNT_MEMO,
      }
    })
    if (rows.some((r) => !Number.isFinite(r.counted_qty) || r.counted_qty < 0)) {
      setError('수량은 0 이상의 숫자로 입력하세요.')
      return
    }
    setSaving(true)
    const { error: err } = await supabase.from('stock_adjustments').insert(rows)
    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }
    setCounts({})
    setMessage(`${rows.length}개 품목의 실재고를 저장했어요.`)
    setReloadKey((k) => k + 1)
  }

  const unitLabel = (unit) => (unit ? (UNIT_LABELS[unit] ?? unit) : '')

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/menu')}>
          ← 메인 메뉴
        </button>
        <h1>📦 실재고 조사</h1>
        <p className="subtitle">{store.name} · 실제로 남은 수량만 입력하세요. 입력한 품목만 저장돼요.</p>
      </div>

      <div className="field">
        <label htmlFor="countDate">조사 날짜</label>
        <input id="countDate" type="date" className="input" value={countDate} onChange={(e) => setCountDate(e.target.value)} />
      </div>
      <div className="field">
        <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 품목 찾기" />
      </div>

      {loading && <p className="hint">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}
      {message && <p className="success-text">{message}</p>}
      {!loading && items.length === 0 && <p className="hint">아직 입고된 품목이 없어요. 거래명세표를 먼저 등록하세요.</p>}

      <div className="stock-count-list">
        {filtered.map((r) => (
          <div key={r.key} className="stock-count-row">
            <div className="stock-count-name">
              <strong>
                {r.pinned && '⭐ '}
                {r.itemName}
              </strong>
              <span className="hint">
                {r.lastCount ? `마지막 조사 ${r.lastCount.slice(5).replace('-', '/')}` : '조사 기록 없음'}
                {isAdmin && ` · 장부 ${Math.round(r.current * 100) / 100}${unitLabel(r.unit)}`}
              </span>
            </div>
            <div className="stock-count-input">
              <input
                className="input"
                inputMode="decimal"
                value={counts[r.key] ?? ''}
                onChange={(e) => setCounts((prev) => ({ ...prev, [r.key]: e.target.value.replace(/[^\d.]/g, '') }))}
                placeholder="수량"
                aria-label={`${r.itemName} 남은 수량`}
              />
              <span>{unitLabel(r.unit)}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="sticky-save">
        <button type="button" className="btn-primary" onClick={handleSave} disabled={saving || entered.length === 0}>
          {saving ? '저장 중...' : `저장 (${entered.length}개 품목)`}
        </button>
      </div>
    </div>
  )
}
