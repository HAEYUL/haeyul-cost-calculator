import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'

const UNIT_LABELS = { g: 'g', kg: 'kg', ea: '개', box: '박스', other: '기타' }

// 명세표의 실제 입고일(invoice_date)이 있으면 그걸 기준으로, 없으면 저장 시각(created_at)으로
// 정렬한다. created_at은 사진을 "언제 업로드했는지"라 늦게 업로드된 예전 명세표가 있으면
// invoice_date와 순서가 어긋날 수 있어 정렬 기준으로 쓰면 안 된다.
function rowDateValue(row) {
  return row.invoice_date ? new Date(row.invoice_date).getTime() : new Date(row.created_at).getTime()
}

// 식봄(foodspring.co.kr)의 통합검색 URL 패턴. 로그인 없이는 가격이 안 보이는 사이트라
// 여기서는 검색 결과 화면만 새 탭으로 열어주고, 실제 가격 확인·비교는 사장님이 직접 한다.
function foodspringSearchUrl(itemName) {
  return `https://www.foodspring.co.kr/search/all?key=${encodeURIComponent(itemName)}`
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

  const [pinnedItemNames, setPinnedItemNames] = useState(new Set())
  const [showAllItems, setShowAllItems] = useState(false)
  const [itemSearch, setItemSearch] = useState('')
  const [foodspringQuery, setFoodspringQuery] = useState('')

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
    if (!store || !supabase) return
    supabase
      .from('pinned_items')
      .select('item_name')
      .eq('store_code', store.code)
      .then(({ data, error: err }) => {
        if (!err) setPinnedItemNames(new Set((data ?? []).map((r) => r.item_name)))
      })
  }, [store])

  // 물품명에 산지·중량·보관방법 같은 수식어가 붙어 있으면 그대로 검색했을 때
  // 식봄 검색 결과가 안 나오는 경우가 많아, 검색어를 물품 선택할 때마다 기본값으로
  // 채워주되 직접 지워서 핵심 단어만 남기고 검색할 수 있게 한다.
  useEffect(() => {
    setFoodspringQuery(selectedItem)
  }, [selectedItem])

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

  // 거래처를 골라야만 그 거래처가 납품한 물품으로 목록을 보여준다. 거래처를 안 고르면
  // 어떤 물품 목록도 보여주지 않는다(전체 거래처 뒤섞인 목록을 없애기 위함).
  // (아래 "거래처별 단가 비교"는 이 필터와 무관하게 항상 전체 거래처를 비교한다)
  const itemFilterVendors = [...new Set(invoiceIndex.map((r) => r.vendor))].sort((a, b) => a.localeCompare(b))
  const itemNames = itemFilterVendor
    ? [
        ...new Set(
          invoiceIndex.filter((r) => r.vendor === itemFilterVendor).map((r) => r.item_name),
        ),
      ].sort((a, b) => a.localeCompare(b))
    : []

  const handleItemFilterVendorChange = (value) => {
    setItemFilterVendor(value)
    setSelectedItem('')
    setItemSearch('')
  }

  // 검색어가 있으면 관심 품목/전체 품목 구분 없이 이름이 일치하는 품목만 보여준다.
  // (검색 중에는 "품목 모두보기"를 펼치지 않아도 전체 품목에서 찾아준다)
  const trimmedItemSearch = itemSearch.trim().toLowerCase()
  const searchedItemNames = trimmedItemSearch
    ? itemNames.filter((name) => name.toLowerCase().includes(trimmedItemSearch))
    : itemNames

  const pinnedItems = searchedItemNames.filter((name) => pinnedItemNames.has(name))
  const otherItems = searchedItemNames.filter((name) => !pinnedItemNames.has(name))
  const effectiveShowAllItems = showAllItems || pinnedItems.length === 0 || trimmedItemSearch !== ''

  const handlePinItem = async (name) => {
    if (!supabase) return
    setPinnedItemNames((prev) => new Set(prev).add(name))
    const { error: err } = await supabase
      .from('pinned_items')
      .upsert({ store_code: store.code, item_name: name }, { onConflict: 'store_code,item_name' })
    if (err) {
      setError(err.message)
      setPinnedItemNames((prev) => {
        const next = new Set(prev)
        next.delete(name)
        return next
      })
    }
  }

  const handleUnpinItem = async (name) => {
    if (!supabase) return
    setPinnedItemNames((prev) => {
      const next = new Set(prev)
      next.delete(name)
      return next
    })
    const { error: err } = await supabase
      .from('pinned_items')
      .delete()
      .eq('store_code', store.code)
      .eq('item_name', name)
    if (err) {
      setError(err.message)
      setPinnedItemNames((prev) => new Set(prev).add(name))
    }
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
          <option value="" disabled>
            거래처를 선택하세요
          </option>
          {itemFilterVendors.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </div>

      {!itemFilterVendor && <p className="hint">거래처를 먼저 선택해주세요.</p>}

      {loadingItems && <p className="hint">물품 목록을 불러오는 중...</p>}

      {selectedItem && (
        <>
          <h2 className="section-title">거래처별 단가 비교 — {selectedItem}</h2>
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

          <div className="field">
            <label htmlFor="foodspringQuery">식봄 검색어</label>
            <input
              id="foodspringQuery"
              className="input"
              value={foodspringQuery}
              onChange={(e) => setFoodspringQuery(e.target.value)}
              placeholder="예: 돼지고기 목살"
            />
            <p className="hint">물품명이 그대로 검색되면 결과가 잘 안 나올 수 있어요. 핵심 단어만 남기고 검색해보세요.</p>
          </div>
          <a
            className="btn-secondary"
            href={foodspringSearchUrl(foodspringQuery.trim() || selectedItem)}
            target="_blank"
            rel="noreferrer"
          >
            🔍 식봄에서 "{foodspringQuery.trim() || selectedItem}" 검색
          </a>

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

          <button type="button" className="btn-secondary" onClick={() => setSelectedItem('')}>
            닫기
          </button>
        </>
      )}

      {!loadingItems && itemFilterVendor && itemNames.length > 0 && (
        <>
          <div className="section-title-row">
            <h2 className="section-title">관심 품목</h2>
            <div className="item-search">
              <span className="item-search-icon">🔍</span>
              <input
                type="text"
                className="input"
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
                placeholder="품목 검색"
                aria-label="품목 검색"
              />
            </div>
          </div>

          {trimmedItemSearch && pinnedItems.length === 0 && otherItems.length === 0 && (
            <p className="hint">"{itemSearch}"와 일치하는 품목이 없어요.</p>
          )}
          {!trimmedItemSearch && pinnedItems.length === 0 && <p className="hint">아직 선택한 품목이 없어요. 아래 전체 목록에서 골라주세요.</p>}
          {pinnedItems.length > 0 && (
            <ul className="history-list">
              {pinnedItems.map((name) => (
                <li key={name} className="history-row">
                  <button type="button" className="cost-row-btn" onClick={() => setSelectedItem(name)}>
                    <div className="history-row-main">
                      <span className="history-item">{name}</span>
                      {selectedItem === name && <span className="cost-badge">선택됨</span>}
                    </div>
                  </button>
                  <div className="inventory-row-actions">
                    <button type="button" className="link-btn" onClick={() => handleUnpinItem(name)}>
                      숨기기
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {effectiveShowAllItems && (
            <>
              {pinnedItems.length > 0 && <h2 className="section-title">전체 품목</h2>}
              <ul className="history-list">
                {otherItems.map((name) => (
                  <li key={name} className="history-row">
                    <button type="button" className="cost-row-btn" onClick={() => setSelectedItem(name)}>
                      <div className="history-row-main">
                        <span className="history-item">{name}</span>
                        {selectedItem === name && <span className="cost-badge">선택됨</span>}
                      </div>
                    </button>
                    <div className="inventory-row-actions">
                      <button type="button" className="link-btn" onClick={() => handlePinItem(name)}>
                        + 관심 품목에 추가
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              {pinnedItems.length > 0 && otherItems.length === 0 && (
                <p className="hint">모든 품목을 관심 품목에 추가했어요.</p>
              )}
            </>
          )}

          {!trimmedItemSearch && pinnedItems.length > 0 && (
            <button type="button" className="btn-secondary" onClick={() => setShowAllItems((v) => !v)}>
              {showAllItems ? '접기' : `품목 모두보기 (전체 ${itemNames.length}개)`}
            </button>
          )}
        </>
      )}
    </div>
  )
}
