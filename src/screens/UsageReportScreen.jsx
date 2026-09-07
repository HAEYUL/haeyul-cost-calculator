import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { latestInvoiceInfoByItem } from '../lib/costCalc'
import { UNIT_LABELS } from '../lib/units'
import { stockKey } from '../lib/stockKey'
import { monthRange, DATE_RANGE_PRESETS as PRESETS } from '../lib/dateRange'
import { useRememberedDateRange } from '../hooks/useRememberedDateRange'

const HIGH_WASTE_RATIO = 15 // 이 비율(%) 이상 폐기되면 눈에 띄게 표시

export default function UsageReportScreen() {
  const { store } = useStore()
  const navigate = useNavigate()

  const [invoiceRows, setInvoiceRows] = useState([])
  const [usageRows, setUsageRows] = useState([])
  const [wasteRows, setWasteRows] = useState([])
  const [infoByItem, setInfoByItem] = useState(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const { dateFrom, dateTo, activePreset, setDateFrom, setDateTo, applyPreset } = useRememberedDateRange(
    'usage-report',
    { ...monthRange(0), activePreset: 'thisMonth' },
  )
  const [sortBy, setSortBy] = useState('used') // 'used' | 'wasteRatio'

  useEffect(() => {
    if (!store) navigate('/', { replace: true })
  }, [store, navigate])

  useEffect(() => {
    if (!store || !supabase) return
    setLoading(true)
    setError('')
    Promise.all([
      supabase.from('invoices').select('item_name, unit, quantity, unit_price, invoice_date, created_at').eq('store_code', store.code),
      supabase.from('stock_usage').select('item_name, unit, used_qty, used_date, created_at').eq('store_code', store.code),
      supabase.from('waste_records').select('item_name, unit, qty, waste_date, created_at').eq('store_code', store.code),
    ]).then(([invoicesRes, usageRes, wasteRes]) => {
      const err = invoicesRes.error || usageRes.error || wasteRes.error
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }
      setInvoiceRows(invoicesRes.data ?? [])
      setUsageRows(usageRes.data ?? [])
      setWasteRows(wasteRes.data ?? [])
      setInfoByItem(latestInvoiceInfoByItem(invoicesRes.data ?? []))
      setLoading(false)
    })
  }, [store])

  if (!store) return null

  const inRange = (dateStr, createdAt) => {
    const d = dateStr ?? createdAt.slice(0, 10)
    return (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo)
  }

  const totals = new Map()
  const ensure = (itemName, unit) => {
    const key = stockKey(itemName, unit)
    if (!totals.has(key)) totals.set(key, { itemName, unit, received: 0, used: 0, wasted: 0 })
    return totals.get(key)
  }

  for (const r of invoiceRows) {
    if (r.quantity == null || !inRange(r.invoice_date, r.created_at)) continue
    ensure(r.item_name, r.unit).received += Number(r.quantity)
  }
  for (const r of usageRows) {
    if (!inRange(r.used_date, r.created_at)) continue
    ensure(r.item_name, r.unit).used += Number(r.used_qty)
  }
  for (const r of wasteRows) {
    if (!inRange(r.waste_date, r.created_at)) continue
    ensure(r.item_name, r.unit).wasted += Number(r.qty)
  }

  const rows = [...totals.values()]
    .filter((r) => r.received > 0 || r.used > 0 || r.wasted > 0)
    .map((r) => {
      const info = infoByItem.get(r.itemName)
      const usedCost = info?.unitPrice != null ? r.used * info.unitPrice : null
      const usedRatio = r.received > 0 ? (r.used / r.received) * 100 : null
      const wasteRatio = r.received > 0 ? (r.wasted / r.received) * 100 : null
      return { ...r, usedCost, usedRatio, wasteRatio }
    })
    .sort((a, b) => {
      if (sortBy === 'wasteRatio') return (b.wasteRatio ?? -1) - (a.wasteRatio ?? -1)
      return b.used - a.used
    })

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/menu')}>
          ← 메인 메뉴
        </button>
        <h1>품목별 사용 리포트</h1>
        <p className="subtitle">{store.name} · 기간을 골라 실제 입고·사용·폐기량을 확인해요</p>
      </div>

      {!supabase && <p className="hint">Supabase가 설정되지 않았습니다.</p>}
      {loading && <p className="hint">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}

      {!loading && supabase && (
        <>
          <div className="preset-row">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                className={activePreset === p.key ? 'chip chip-active' : 'chip'}
                onClick={() => applyPreset(p)}
              >
                {p.label}
              </button>
            ))}
          </div>

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
            사용률 = 이 기간 사용량 ÷ 입고량, 폐기율 = 이 기간 폐기량 ÷ 입고량이에요. 이 기간에 입고가 없으면 비율은
            계산하지 않아요.
          </p>

          <div className="preset-row">
            <button
              type="button"
              className={sortBy === 'used' ? 'chip chip-active' : 'chip'}
              onClick={() => setSortBy('used')}
            >
              사용량순
            </button>
            <button
              type="button"
              className={sortBy === 'wasteRatio' ? 'chip chip-active' : 'chip'}
              onClick={() => setSortBy('wasteRatio')}
            >
              폐기율순
            </button>
          </div>

          <h2 className="section-title">품목별 현황 ({rows.length}개)</h2>
          {rows.length === 0 && <p className="hint">이 기간에 입고·사용·폐기 기록이 없습니다.</p>}

          <ul className="history-list">
            {rows.map((r) => {
              const unitLabel = r.unit ? UNIT_LABELS[r.unit] ?? r.unit : ''
              const highWaste = r.wasteRatio != null && r.wasteRatio >= HIGH_WASTE_RATIO
              return (
                <li key={stockKey(r.itemName, r.unit)} className="history-row">
                  <button
                    type="button"
                    className="cost-row-btn"
                    onClick={() => navigate(`/inventory/${encodeURIComponent(r.itemName)}/${r.unit ?? 'none'}`)}
                  >
                    <div className="history-row-main">
                      <span className="history-item">{r.itemName}</span>
                      <span>
                        사용 {r.used.toLocaleString()}
                        {unitLabel}
                        {r.usedCost != null ? ` · ${Math.round(r.usedCost).toLocaleString()}원` : ''}
                      </span>
                    </div>
                    <div className="history-row-sub">
                      <span>입고 {r.received.toLocaleString()}{unitLabel}</span>
                      {r.usedRatio != null && <span>사용률 {r.usedRatio.toFixed(0)}%</span>}
                      {r.wasted > 0 && (
                        <span className={highWaste ? 'alert-up' : ''}>
                          폐기 {r.wasted.toLocaleString()}
                          {unitLabel}
                          {r.wasteRatio != null ? ` (${r.wasteRatio.toFixed(0)}%)` : ''}
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
