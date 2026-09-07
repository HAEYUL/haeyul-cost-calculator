import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { latestInvoiceInfoByItem } from '../lib/costCalc'
import { UNIT_LABELS } from '../lib/units'
import { stockKey } from '../lib/stockKey'
import { monthRange, DATE_RANGE_PRESETS as PRESETS } from '../lib/dateRange'
import { useRememberedDateRange } from '../hooks/useRememberedDateRange'

export default function WasteReportScreen() {
  const { store } = useStore()
  const navigate = useNavigate()

  const [wasteRows, setWasteRows] = useState([])
  const [infoByItem, setInfoByItem] = useState(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const { dateFrom, dateTo, activePreset, setDateFrom, setDateTo, applyPreset } = useRememberedDateRange(
    'waste-report',
    { ...monthRange(0), activePreset: 'thisMonth' },
  )

  useEffect(() => {
    if (!store) navigate('/', { replace: true })
  }, [store, navigate])

  useEffect(() => {
    if (!store || !supabase) return
    setLoading(true)
    setError('')
    Promise.all([
      supabase
        .from('waste_records')
        .select('item_name, unit, qty, waste_date, reason, created_at')
        .eq('store_code', store.code),
      supabase.from('invoices').select('item_name, unit_price, unit, created_at').eq('store_code', store.code),
    ]).then(([wasteRes, invoicesRes]) => {
      const err = wasteRes.error || invoicesRes.error
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }
      setWasteRows(wasteRes.data ?? [])
      setInfoByItem(latestInvoiceInfoByItem(invoicesRes.data ?? []))
      setLoading(false)
    })
  }, [store])

  if (!store) return null

  const filteredWaste = wasteRows.filter((r) => {
    const d = r.waste_date ?? r.created_at.slice(0, 10)
    return (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo)
  })

  const totalsByItem = new Map()
  for (const r of filteredWaste) {
    const key = stockKey(r.item_name, r.unit)
    if (!totalsByItem.has(key)) totalsByItem.set(key, { itemName: r.item_name, unit: r.unit, qty: 0 })
    totalsByItem.get(key).qty += Number(r.qty)
  }

  const rows = [...totalsByItem.values()]
    .map((r) => {
      const info = infoByItem.get(r.itemName)
      const cost = info?.unitPrice != null ? r.qty * info.unitPrice : null
      return { ...r, unitPrice: info?.unitPrice ?? null, cost }
    })
    .sort((a, b) => {
      if (a.cost == null && b.cost == null) return b.qty - a.qty
      if (a.cost == null) return 1
      if (b.cost == null) return -1
      return b.cost - a.cost
    })

  const totalCost = rows.reduce((sum, r) => sum + (r.cost ?? 0), 0)
  const hasUnknownCost = rows.some((r) => r.cost == null)

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/menu')}>
          ← 메인 메뉴
        </button>
        <h1>폐기/손실 리포트</h1>
        <p className="subtitle">{store.name} · 기간을 골라 버린 물량과 손실 금액을 확인해요</p>
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

          <div className="cost-summary">
            <div className="cost-summary-row">
              <span>이 기간 손실 추정 금액</span>
              <strong className="alert-up">{Math.round(totalCost).toLocaleString()}원</strong>
            </div>
          </div>
          {hasUnknownCost && (
            <p className="hint">단가 정보가 없는 품목은 금액 계산에서 빠졌어요 (입고 단가는 알 수 있어요).</p>
          )}

          <h2 className="section-title">품목별 폐기 ({rows.length}개)</h2>
          {rows.length === 0 && <p className="hint">이 기간에 폐기 기록이 없습니다.</p>}

          <ul className="history-list">
            {rows.map((r) => (
              <li key={stockKey(r.itemName, r.unit)} className="history-row">
                <button
                  type="button"
                  className="cost-row-btn"
                  onClick={() => navigate(`/inventory/${encodeURIComponent(r.itemName)}/${r.unit ?? 'none'}`)}
                >
                  <div className="history-row-main">
                    <span className="history-item">{r.itemName}</span>
                    <span>{r.cost != null ? `${Math.round(r.cost).toLocaleString()}원` : '단가 정보 없음'}</span>
                  </div>
                  <div className="history-row-sub">
                    <span>
                      {r.qty.toLocaleString()}
                      {r.unit ? UNIT_LABELS[r.unit] ?? r.unit : ''} 폐기
                    </span>
                    {r.unitPrice != null && (
                      <span>
                        단가 {r.unitPrice.toLocaleString()}원{r.unit ? `/${UNIT_LABELS[r.unit] ?? r.unit}` : ''}
                      </span>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
