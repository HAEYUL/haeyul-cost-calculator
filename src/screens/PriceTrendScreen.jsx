import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'

const UNIT_LABELS = { g: 'g', kg: 'kg', ea: '개', other: '기타' }

// 명세표의 실제 입고일(invoice_date)이 있으면 그걸 기준으로, 없으면 저장 시각(created_at)으로
// 정렬한다. created_at은 사진을 "언제 업로드했는지"라 늦게 업로드된 예전 명세표가 있으면
// invoice_date와 순서가 어긋날 수 있어 정렬 기준으로 쓰면 안 된다.
function rowDateValue(row) {
  return row.invoice_date ? new Date(row.invoice_date).getTime() : new Date(row.created_at).getTime()
}

export default function PriceTrendScreen() {
  const { store } = useStore()
  const navigate = useNavigate()

  const [invoiceIndex, setInvoiceIndex] = useState([])
  const [itemFilterVendor, setItemFilterVendor] = useState('')
  const [selectedItem, setSelectedItem] = useState('')
  const [rows, setRows] = useState([])
  const [loadingItems, setLoadingItems] = useState(false)
  const [loadingRows, setLoadingRows] = useState(false)
  const [error, setError] = useState('')

  const [vendorFilter, setVendorFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  useEffect(() => {
    if (!store) navigate('/', { replace: true })
  }, [store, navigate])

  useEffect(() => {
    if (!store || !supabase) return
    setLoadingItems(true)
    setError('')
    supabase
      .from('invoices')
      .select('item_name, vendor')
      .eq('store_code', store.code)
      .then(({ data, error: err }) => {
        if (err) {
          setError(err.message)
          setLoadingItems(false)
          return
        }
        setInvoiceIndex(data ?? [])
        setLoadingItems(false)
      })
  }, [store])

  useEffect(() => {
    if (!store || !supabase || !selectedItem) {
      setRows([])
      return
    }
    setLoadingRows(true)
    setError('')
    setVendorFilter('all')
    supabase
      .from('invoices')
      .select('vendor, unit_price, unit, invoice_date, created_at')
      .eq('store_code', store.code)
      .eq('item_name', selectedItem)
      .order('created_at', { ascending: true })
      .then(({ data, error: err }) => {
        if (err) {
          setError(err.message)
          setLoadingRows(false)
          return
        }
        setRows((data ?? []).filter((r) => r.unit_price != null))
        setLoadingRows(false)
      })
  }, [store, selectedItem])

  if (!store) return null

  // 거래처를 고르면 그 거래처가 납품한 물품으로만 물품 목록을 좁혀서 찾기 쉽게 한다.
  // (아래 "거래처별 단가 비교"는 이 필터와 무관하게 항상 전체 거래처를 비교한다)
  const itemFilterVendors = [...new Set(invoiceIndex.map((r) => r.vendor))].sort((a, b) => a.localeCompare(b))
  const itemNames = [
    ...new Set(
      invoiceIndex
        .filter((r) => !itemFilterVendor || r.vendor === itemFilterVendor)
        .map((r) => r.item_name),
    ),
  ].sort((a, b) => a.localeCompare(b))

  const handleItemFilterVendorChange = (value) => {
    setItemFilterVendor(value)
    setSelectedItem('')
  }

  // 거래처별 최신 단가 비교: 거래처마다 가장 최근 입고 단가를 뽑아 저렴한 순으로 정렬
  const latestByVendor = new Map()
  for (const r of rows) {
    const existing = latestByVendor.get(r.vendor)
    if (!existing || rowDateValue(r) > rowDateValue(existing)) {
      latestByVendor.set(r.vendor, r)
    }
  }
  const comparisonRows = [...latestByVendor.entries()]
    .map(([vendor, r]) => ({ vendor, ...r }))
    .sort((a, b) => a.unit_price - b.unit_price)

  const vendorNames = [...latestByVendor.keys()].sort((a, b) => a.localeCompare(b))

  // 가격 추이: 거래처/기간으로 좁혀서 입고일 기준 오름차순으로 정리 (변동률 계산용)
  const trendRows = rows
    .filter((r) => vendorFilter === 'all' || r.vendor === vendorFilter)
    .filter((r) => !dateFrom || (r.invoice_date && r.invoice_date >= dateFrom))
    .filter((r) => !dateTo || (r.invoice_date && r.invoice_date <= dateTo))
    .sort((a, b) => rowDateValue(a) - rowDateValue(b))

  const firstPrice = trendRows[0]?.unit_price
  const lastPrice = trendRows[trendRows.length - 1]?.unit_price
  const trendDiff = firstPrice != null && lastPrice != null ? lastPrice - firstPrice : null
  const trendPct = trendDiff != null && firstPrice !== 0 ? (trendDiff / firstPrice) * 100 : null

  // 목록 표시는 최신 날짜가 위로 오도록 내림차순
  const trendRowsDesc = [...trendRows].reverse()

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/menu')}>
          ← 메인 메뉴
        </button>
        <h1>단가 추이 조회</h1>
        <p className="subtitle">{store.name} · 거래처별 단가를 비교하고 기간별 추이를 확인해요</p>
      </div>

      {!supabase && <p className="hint">Supabase가 설정되지 않았습니다.</p>}
      {error && <p className="error-text">{error}</p>}

      <div className="field">
        <label htmlFor="itemFilterVendor">거래처 선택</label>
        <select
          id="itemFilterVendor"
          className="select select-block"
          value={itemFilterVendor}
          onChange={(e) => handleItemFilterVendorChange(e.target.value)}
        >
          <option value="">전체 거래처</option>
          {itemFilterVendors.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="itemSelect">물품 선택</label>
        <select
          id="itemSelect"
          className="select select-block"
          value={selectedItem}
          onChange={(e) => setSelectedItem(e.target.value)}
        >
          <option value="">물품 선택...</option>
          {itemNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>

      {loadingItems && <p className="hint">물품 목록을 불러오는 중...</p>}

      {selectedItem && (
        <>
          <h2 className="section-title">거래처별 단가 비교</h2>
          {loadingRows && <p className="hint">불러오는 중...</p>}
          {!loadingRows && comparisonRows.length === 0 && <p className="hint">이 물품의 입고 단가 기록이 없습니다.</p>}
          <ul className="history-list">
            {comparisonRows.map((r, i) => (
              <li key={r.vendor} className="history-row">
                <div className="history-row-main">
                  <span className="history-item">
                    {r.vendor}
                    {i === 0 && comparisonRows.length > 1 && <span className="cost-badge"> 최저가</span>}
                  </span>
                  <span>
                    {Number(r.unit_price).toLocaleString()}원{r.unit ? `/${UNIT_LABELS[r.unit] ?? r.unit}` : ''}
                  </span>
                </div>
                <div className="history-row-sub">
                  <span>{r.invoice_date ?? new Date(r.created_at).toLocaleDateString('ko-KR')} 기준</span>
                </div>
              </li>
            ))}
          </ul>

          <h2 className="section-title">가격 추이</h2>
          <div className="field">
            <label htmlFor="vendorFilter">거래처</label>
            <select
              id="vendorFilter"
              className="select select-block"
              value={vendorFilter}
              onChange={(e) => setVendorFilter(e.target.value)}
            >
              <option value="all">전체 거래처</option>
              {vendorNames.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="dateFrom">시작일</label>
            <input id="dateFrom" className="input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="dateTo">종료일</label>
            <input id="dateTo" className="input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>

          {trendDiff != null && (
            <div className="cost-summary">
              <div className="cost-summary-row">
                <span>기간 내 가격 변동</span>
                <strong className={trendDiff > 0 ? 'alert-up' : trendDiff < 0 ? 'alert-down' : ''}>
                  {Number(firstPrice).toLocaleString()}원 → {Number(lastPrice).toLocaleString()}원
                  {trendPct !== null && ` (${trendDiff > 0 ? '▲' : trendDiff < 0 ? '▼' : ''}${Math.abs(trendPct).toFixed(1)}%)`}
                </strong>
              </div>
            </div>
          )}

          {!loadingRows && trendRows.length === 0 && <p className="hint">조건에 맞는 입고 기록이 없습니다.</p>}
          <ul className="history-list">
            {trendRowsDesc.map((r, i) => (
              <li key={`${r.created_at}-${i}`} className="history-row">
                <div className="history-row-main">
                  <span className="history-item">{r.invoice_date ?? new Date(r.created_at).toLocaleDateString('ko-KR')}</span>
                  <span>
                    {Number(r.unit_price).toLocaleString()}원{r.unit ? `/${UNIT_LABELS[r.unit] ?? r.unit}` : ''}
                  </span>
                </div>
                {vendorFilter === 'all' && (
                  <div className="history-row-sub">
                    <span>{r.vendor}</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
