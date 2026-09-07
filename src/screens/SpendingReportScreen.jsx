import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { rowDateStr } from '../lib/rowDateStr'
import { monthRange, DATE_RANGE_PRESETS as PRESETS } from '../lib/dateRange'

export default function SpendingReportScreen() {
  const { store } = useStore()
  const navigate = useNavigate()

  const [batches, setBatches] = useState([])
  const [vendorNameById, setVendorNameById] = useState(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const defaultRange = monthRange(0)
  const [dateFrom, setDateFrom] = useState(defaultRange.start)
  const [dateTo, setDateTo] = useState(defaultRange.end)
  const [activePreset, setActivePreset] = useState('thisMonth')

  useEffect(() => {
    if (!store) navigate('/', { replace: true })
  }, [store, navigate])

  useEffect(() => {
    if (!store || !supabase) return
    setLoading(true)
    setError('')
    Promise.all([
      supabase.from('vendors').select('id, name').eq('store_code', store.code),
      supabase
        .from('invoice_batches')
        .select('vendor_id, total_amount, invoice_date, created_at')
        .eq('store_code', store.code),
    ]).then(([vendorsRes, batchesRes]) => {
      const err = vendorsRes.error || batchesRes.error
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }
      setVendorNameById(new Map((vendorsRes.data ?? []).map((v) => [v.id, v.name])))
      setBatches(batchesRes.data ?? [])
      setLoading(false)
    })
  }, [store])

  if (!store) return null

  const applyPreset = (preset) => {
    const { start, end } = preset.range()
    setDateFrom(start)
    setDateTo(end)
    setActivePreset(preset.key)
  }

  const filteredBatches = batches.filter((b) => {
    const d = rowDateStr(b)
    return (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo)
  })

  const totalByVendor = new Map()
  for (const b of filteredBatches) {
    totalByVendor.set(b.vendor_id, (totalByVendor.get(b.vendor_id) ?? 0) + Number(b.total_amount))
  }

  const grandTotal = [...totalByVendor.values()].reduce((sum, v) => sum + v, 0)

  const rows = [...totalByVendor.entries()]
    .map(([vendorId, amount]) => ({
      vendorId,
      name: vendorNameById.get(vendorId) ?? '거래처 미지정',
      amount,
      pct: grandTotal > 0 ? (amount / grandTotal) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount)

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/menu')}>
          ← 메인 메뉴
        </button>
        <h1>지출 리포트</h1>
        <p className="subtitle">{store.name} · 기간을 골라 거래처별 지출을 비교해요</p>
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
              onChange={(e) => {
                setDateFrom(e.target.value)
                setActivePreset(null)
              }}
              aria-label="시작일"
            />
            <span className="date-range-sep">~</span>
            <input
              type="date"
              className="input"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value)
                setActivePreset(null)
              }}
              aria-label="종료일"
            />
          </div>

          <div className="cost-summary">
            <div className="cost-summary-row">
              <span>이 기간 총 지출</span>
              <strong>{Math.round(grandTotal).toLocaleString()}원</strong>
            </div>
          </div>

          <h2 className="section-title">거래처별 지출 ({rows.length}곳)</h2>
          {rows.length === 0 && <p className="hint">이 기간에 입고 내역이 없습니다.</p>}

          <ul className="history-list">
            {rows.map((r) => (
              <li key={r.vendorId} className="history-row">
                <button type="button" className="cost-row-btn" onClick={() => navigate(`/vendors/${r.vendorId}`)}>
                  <div className="history-row-main">
                    <span className="history-item">{r.name}</span>
                    <span>{Math.round(r.amount).toLocaleString()}원</span>
                  </div>
                  <div className="spend-bar-track">
                    <div className="spend-bar-fill" style={{ width: `${r.pct}%` }} />
                  </div>
                  <div className="history-row-sub">
                    <span>전체의 {r.pct.toFixed(1)}%</span>
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
