import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'

const UNIT_LABELS = { g: 'g', kg: 'kg', ea: '개', other: '기타' }
const NO_UNIT_KEY = 'none'

export default function InventoryDetailScreen() {
  const { store } = useStore()
  const navigate = useNavigate()
  const { itemName: encodedItemName, unit: unitParam } = useParams()
  const itemName = decodeURIComponent(encodedItemName ?? '')
  const unit = unitParam === NO_UNIT_KEY ? null : unitParam

  const [receipts, setReceipts] = useState([])
  const [usageRows, setUsageRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [dataKey, setDataKey] = useState(0)

  const [usageQty, setUsageQty] = useState('')
  const [usageDate, setUsageDate] = useState('')
  const [usageMemo, setUsageMemo] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!store) navigate('/', { replace: true })
  }, [store, navigate])

  useEffect(() => {
    if (!store || !supabase) return
    setLoading(true)
    setError('')

    let receiptsQuery = supabase
      .from('invoices')
      .select('id, quantity, unit_price, invoice_date, created_at, vendor')
      .eq('store_code', store.code)
      .eq('item_name', itemName)
      .order('created_at', { ascending: false })
    receiptsQuery = unit == null ? receiptsQuery.is('unit', null) : receiptsQuery.eq('unit', unit)

    let usageQuery = supabase
      .from('stock_usage')
      .select('id, used_qty, used_date, memo, created_at')
      .eq('store_code', store.code)
      .eq('item_name', itemName)
      .order('created_at', { ascending: false })
    usageQuery = unit == null ? usageQuery.is('unit', null) : usageQuery.eq('unit', unit)

    Promise.all([receiptsQuery, usageQuery]).then(([receiptsRes, usageRes]) => {
      const err = receiptsRes.error || usageRes.error
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }
      setReceipts(receiptsRes.data ?? [])
      setUsageRows(usageRes.data ?? [])
      setLoading(false)
    })
  }, [store, itemName, unit, dataKey])

  if (!store) return null

  const totalReceived = receipts.reduce((sum, r) => sum + (r.quantity != null ? Number(r.quantity) : 0), 0)
  const totalUsed = usageRows.reduce((sum, r) => sum + Number(r.used_qty), 0)
  const currentStock = totalReceived - totalUsed
  const unitLabel = unit ? UNIT_LABELS[unit] ?? unit : ''

  const handleAddUsage = async () => {
    const qty = Number(usageQty)
    if (!usageQty || !Number.isFinite(qty) || qty <= 0 || !supabase) {
      setError('사용량을 0보다 크게 입력하세요.')
      return
    }
    setSaving(true)
    setError('')
    const { error: err } = await supabase.from('stock_usage').insert({
      store_code: store.code,
      item_name: itemName,
      unit,
      used_qty: qty,
      used_date: usageDate || null,
      memo: usageMemo.trim() || null,
    })
    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }
    setUsageQty('')
    setUsageDate('')
    setUsageMemo('')
    setDataKey((k) => k + 1)
  }

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/inventory')}>
          ← 재고 관리
        </button>
        <h1>{itemName}</h1>
        <p className="subtitle">{store.name} · {unitLabel ? `${unitLabel} 단위 재고` : '재고'}</p>
      </div>

      {!supabase && <p className="hint">Supabase가 설정되지 않았습니다.</p>}
      {loading && <p className="hint">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}

      {!loading && supabase && (
        <>
          <div className="cost-summary">
            <div className="cost-summary-row">
              <span>현재고</span>
              <strong className={currentStock < 0 ? 'alert-up' : ''}>
                {currentStock.toLocaleString()}
                {unitLabel}
              </strong>
            </div>
            <div className="cost-summary-row">
              <span>누적 입고</span>
              <strong>
                {totalReceived.toLocaleString()}
                {unitLabel}
              </strong>
            </div>
            <div className="cost-summary-row">
              <span>누적 사용</span>
              <strong>
                {totalUsed.toLocaleString()}
                {unitLabel}
              </strong>
            </div>
          </div>

          <h2 className="section-title">오늘 사용량 기록</h2>
          <div className="field">
            <label htmlFor="usageQty">사용량{unitLabel ? ` (${unitLabel})` : ''}</label>
            <input
              id="usageQty"
              className="input"
              inputMode="decimal"
              value={usageQty}
              onChange={(e) => setUsageQty(e.target.value)}
              placeholder="예: 3"
            />
          </div>
          <div className="field">
            <label htmlFor="usageDate">사용일</label>
            <input
              id="usageDate"
              className="input"
              type="date"
              value={usageDate}
              onChange={(e) => setUsageDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="usageMemo">메모</label>
            <input
              id="usageMemo"
              className="input"
              value={usageMemo}
              onChange={(e) => setUsageMemo(e.target.value)}
              placeholder="선택사항"
            />
          </div>
          <button type="button" className="btn-primary" onClick={handleAddUsage} disabled={saving}>
            {saving ? '저장 중...' : '사용량 기록'}
          </button>

          <h2 className="section-title">사용 내역 ({usageRows.length}건)</h2>
          {usageRows.length === 0 && <p className="hint">아직 기록된 사용량이 없습니다.</p>}
          <ul className="history-list">
            {usageRows.map((r) => (
              <li key={r.id} className="history-row">
                <div className="history-row-main">
                  <span className="history-item">{r.used_date ?? '날짜 미입력'}</span>
                  <span>
                    -{Number(r.used_qty).toLocaleString()}
                    {unitLabel}
                  </span>
                </div>
                {r.memo && (
                  <div className="history-row-sub">
                    <span>{r.memo}</span>
                  </div>
                )}
              </li>
            ))}
          </ul>

          <h2 className="section-title">입고 내역 ({receipts.length}건)</h2>
          {receipts.length === 0 && <p className="hint">아직 입고 내역이 없습니다.</p>}
          <ul className="history-list">
            {receipts.map((r) => (
              <li key={r.id} className="history-row">
                <div className="history-row-main">
                  <span className="history-vendor">{r.vendor}</span>
                  <span>
                    +{r.quantity != null ? Number(r.quantity).toLocaleString() : '-'}
                    {unitLabel}
                  </span>
                </div>
                <div className="history-row-sub">
                  {r.invoice_date && <span>{r.invoice_date}</span>}
                  {r.unit_price != null && <span>단가 {Number(r.unit_price).toLocaleString()}원</span>}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
