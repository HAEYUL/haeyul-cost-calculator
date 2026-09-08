import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { monthRange, DATE_RANGE_PRESETS as PRESETS } from '../lib/dateRange'

export default function VendorPaymentReportScreen() {
  const { store } = useStore()
  const navigate = useNavigate()
  const location = useLocation()

  const [payments, setPayments] = useState([])
  const [vendorNameById, setVendorNameById] = useState(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [dateFrom, setDateFrom] = useState(() => location.state?.dateRange?.dateFrom ?? monthRange().start)
  const [dateTo, setDateTo] = useState(() => location.state?.dateRange?.dateTo ?? monthRange().end)
  const [activePreset, setActivePreset] = useState(null)

  useEffect(() => {
    if (!store) navigate('/', { replace: true })
  }, [store, navigate])

  useEffect(() => {
    if (!store || !supabase) return
    setLoading(true)
    setError('')
    Promise.all([
      supabase.from('vendors').select('id, name').eq('store_code', store.code),
      supabase.from('vendor_payments').select('vendor_id, amount, paid_date').eq('store_code', store.code),
    ]).then(([vendorsRes, paymentsRes]) => {
      const err = vendorsRes.error || paymentsRes.error
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }
      setVendorNameById(new Map((vendorsRes.data ?? []).map((v) => [v.id, v.name])))
      setPayments(paymentsRes.data ?? [])
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

  // 결제일이 없는 기록은 어느 기간 것인지 알 수 없어서 제외한다 — 거래처 상세, 거래처 관리
  // 전체 입금액 박스와 같은 기준이다.
  const filteredPayments = payments.filter(
    (p) => p.paid_date && (!dateFrom || p.paid_date >= dateFrom) && (!dateTo || p.paid_date <= dateTo),
  )

  const totalByVendor = new Map()
  for (const p of filteredPayments) {
    totalByVendor.set(p.vendor_id, (totalByVendor.get(p.vendor_id) ?? 0) + Number(p.amount))
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

  const undatedCount = payments.filter((p) => !p.paid_date).length

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/menu')}>
          ← 메인 메뉴
        </button>
        <h1>거래처별 결제액</h1>
        <p className="subtitle">{store.name} · 기간을 골라 거래처별 결제(입금)액을 비교해요</p>
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
              <span>이 기간 총 결제액</span>
              <strong>{Math.round(grandTotal).toLocaleString()}원</strong>
            </div>
          </div>
          {undatedCount > 0 && (
            <p className="hint">
              결제일 없는 기록이 {undatedCount}건 있어서 이 리포트에서 빠졌어요. 거래처 상세에서 날짜를 등록해주세요.
            </p>
          )}

          <h2 className="section-title">거래처별 결제액 ({rows.length}곳)</h2>
          {rows.length === 0 && <p className="hint">이 기간에 결제 기록이 없습니다.</p>}

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
