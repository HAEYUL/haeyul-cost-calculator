import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'

const UNIT_LABELS = { g: 'g', kg: 'kg', ea: '개', other: '기타' }
const NO_UNIT_KEY = 'none'
const WASTE_REASONS = ['상함/부패', '유통기한 경과', '조리 실수', '기타']

export default function InventoryDetailScreen() {
  const { store } = useStore()
  const navigate = useNavigate()
  const { itemName: encodedItemName, unit: unitParam } = useParams()
  const itemName = decodeURIComponent(encodedItemName ?? '')
  const unit = unitParam === NO_UNIT_KEY ? null : unitParam

  const [receipts, setReceipts] = useState([])
  const [usageRows, setUsageRows] = useState([])
  const [wasteRows, setWasteRows] = useState([])
  const [adjustmentRows, setAdjustmentRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [dataKey, setDataKey] = useState(0)

  const [usageQty, setUsageQty] = useState('')
  const [usageDate, setUsageDate] = useState('')
  const [usageMemo, setUsageMemo] = useState('')
  const [saving, setSaving] = useState(false)

  const [deleteUsageTarget, setDeleteUsageTarget] = useState(null)
  const [deletingUsage, setDeletingUsage] = useState(false)

  const [wasteQty, setWasteQty] = useState('')
  const [wasteDate, setWasteDate] = useState('')
  const [wasteReason, setWasteReason] = useState(WASTE_REASONS[0])
  const [wasteMemo, setWasteMemo] = useState('')
  const [savingWaste, setSavingWaste] = useState(false)

  const [deleteWasteTarget, setDeleteWasteTarget] = useState(null)
  const [deletingWaste, setDeletingWaste] = useState(false)

  const [countedQty, setCountedQty] = useState('')
  const [adjustedDate, setAdjustedDate] = useState('')
  const [adjustMemo, setAdjustMemo] = useState('')
  const [savingAdjustment, setSavingAdjustment] = useState(false)

  const [deleteAdjustmentTarget, setDeleteAdjustmentTarget] = useState(null)
  const [deletingAdjustment, setDeletingAdjustment] = useState(false)

  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

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

    let wasteQuery = supabase
      .from('waste_records')
      .select('id, qty, waste_date, reason, memo, created_at')
      .eq('store_code', store.code)
      .eq('item_name', itemName)
      .order('created_at', { ascending: false })
    wasteQuery = unit == null ? wasteQuery.is('unit', null) : wasteQuery.eq('unit', unit)

    let adjustmentQuery = supabase
      .from('stock_adjustments')
      .select('id, delta, counted_qty, adjusted_date, memo, created_at')
      .eq('store_code', store.code)
      .eq('item_name', itemName)
      .order('created_at', { ascending: false })
    adjustmentQuery = unit == null ? adjustmentQuery.is('unit', null) : adjustmentQuery.eq('unit', unit)

    Promise.all([receiptsQuery, usageQuery, wasteQuery, adjustmentQuery]).then(
      ([receiptsRes, usageRes, wasteRes, adjustmentRes]) => {
        const err = receiptsRes.error || usageRes.error || wasteRes.error || adjustmentRes.error
        if (err) {
          setError(err.message)
          setLoading(false)
          return
        }
        setReceipts(receiptsRes.data ?? [])
        setUsageRows(usageRes.data ?? [])
        setWasteRows(wasteRes.data ?? [])
        setAdjustmentRows(adjustmentRes.data ?? [])
        setLoading(false)
      },
    )
  }, [store, itemName, unit, dataKey])

  if (!store) return null

  const totalReceived = receipts.reduce((sum, r) => sum + (r.quantity != null ? Number(r.quantity) : 0), 0)
  const totalUsed = usageRows.reduce((sum, r) => sum + Number(r.used_qty), 0)
  const totalWasted = wasteRows.reduce((sum, r) => sum + Number(r.qty), 0)
  const totalAdjustment = adjustmentRows.reduce((sum, r) => sum + Number(r.delta), 0)
  const currentStock = totalReceived - totalUsed - totalWasted + totalAdjustment
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

  const handleDeleteUsage = async () => {
    if (!deleteUsageTarget || !supabase) return
    setDeletingUsage(true)
    setError('')

    const { error: err } = await supabase.from('stock_usage').delete().eq('id', deleteUsageTarget.id)
    setDeletingUsage(false)
    if (err) {
      setError(err.message)
      return
    }

    setDeleteUsageTarget(null)
    setDataKey((k) => k + 1)
  }

  const handleAddWaste = async () => {
    const qty = Number(wasteQty)
    if (!wasteQty || !Number.isFinite(qty) || qty <= 0 || !supabase) {
      setError('폐기 수량을 0보다 크게 입력하세요.')
      return
    }
    setSavingWaste(true)
    setError('')
    const { error: err } = await supabase.from('waste_records').insert({
      store_code: store.code,
      item_name: itemName,
      unit,
      qty,
      waste_date: wasteDate || null,
      reason: wasteReason,
      memo: wasteMemo.trim() || null,
    })
    setSavingWaste(false)
    if (err) {
      setError(err.message)
      return
    }
    setWasteQty('')
    setWasteDate('')
    setWasteReason(WASTE_REASONS[0])
    setWasteMemo('')
    setDataKey((k) => k + 1)
  }

  const handleDeleteWaste = async () => {
    if (!deleteWasteTarget || !supabase) return
    setDeletingWaste(true)
    setError('')

    const { error: err } = await supabase.from('waste_records').delete().eq('id', deleteWasteTarget.id)
    setDeletingWaste(false)
    if (err) {
      setError(err.message)
      return
    }

    setDeleteWasteTarget(null)
    setDataKey((k) => k + 1)
  }

  const handleAddAdjustment = async () => {
    const counted = Number(countedQty)
    if (countedQty === '' || !Number.isFinite(counted) || !supabase) {
      setError('실제 확인한 수량을 입력하세요.')
      return
    }
    const delta = counted - currentStock
    if (delta === 0) {
      setError('실제 수량이 계산상 재고와 같아서 보정할 내용이 없어요.')
      return
    }
    setSavingAdjustment(true)
    setError('')
    const { error: err } = await supabase.from('stock_adjustments').insert({
      store_code: store.code,
      item_name: itemName,
      unit,
      delta,
      counted_qty: counted,
      adjusted_date: adjustedDate || null,
      memo: adjustMemo.trim() || null,
    })
    setSavingAdjustment(false)
    if (err) {
      setError(err.message)
      return
    }
    setCountedQty('')
    setAdjustedDate('')
    setAdjustMemo('')
    setDataKey((k) => k + 1)
  }

  const handleDeleteAdjustment = async () => {
    if (!deleteAdjustmentTarget || !supabase) return
    setDeletingAdjustment(true)
    setError('')

    const { error: err } = await supabase.from('stock_adjustments').delete().eq('id', deleteAdjustmentTarget.id)
    setDeletingAdjustment(false)
    if (err) {
      setError(err.message)
      return
    }

    setDeleteAdjustmentTarget(null)
    setDataKey((k) => k + 1)
  }

  const inRange = (dateStr) => (!dateFrom || !dateStr || dateStr >= dateFrom) && (!dateTo || !dateStr || dateStr <= dateTo)
  const visibleUsageRows = usageRows.filter((r) => inRange(r.used_date))
  const visibleWasteRows = wasteRows.filter((r) => inRange(r.waste_date))
  const visibleAdjustmentRows = adjustmentRows.filter((r) => inRange(r.adjusted_date))
  const visibleReceipts = receipts.filter((r) => inRange(r.invoice_date))

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
            <div className="cost-summary-row">
              <span>누적 폐기</span>
              <strong>
                {totalWasted.toLocaleString()}
                {unitLabel}
              </strong>
            </div>
            {totalAdjustment !== 0 && (
              <div className="cost-summary-row">
                <span>실사 보정</span>
                <strong className={totalAdjustment < 0 ? 'alert-up' : ''}>
                  {totalAdjustment > 0 ? '+' : ''}
                  {totalAdjustment.toLocaleString()}
                  {unitLabel}
                </strong>
              </div>
            )}
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

          <h2 className="section-title">폐기/손실 기록</h2>
          <div className="field">
            <label htmlFor="wasteQty">폐기 수량{unitLabel ? ` (${unitLabel})` : ''}</label>
            <input
              id="wasteQty"
              className="input"
              inputMode="decimal"
              value={wasteQty}
              onChange={(e) => setWasteQty(e.target.value)}
              placeholder="예: 2"
            />
          </div>
          <div className="field">
            <label htmlFor="wasteReason">사유</label>
            <select
              id="wasteReason"
              className="select select-block"
              value={wasteReason}
              onChange={(e) => setWasteReason(e.target.value)}
            >
              {WASTE_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="wasteDate">폐기일</label>
            <input
              id="wasteDate"
              className="input"
              type="date"
              value={wasteDate}
              onChange={(e) => setWasteDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="wasteMemo">메모</label>
            <input
              id="wasteMemo"
              className="input"
              value={wasteMemo}
              onChange={(e) => setWasteMemo(e.target.value)}
              placeholder="선택사항"
            />
          </div>
          <button type="button" className="btn-secondary" onClick={handleAddWaste} disabled={savingWaste}>
            {savingWaste ? '저장 중...' : '폐기 기록'}
          </button>

          <h2 className="section-title">재고 실사(실물 확인)</h2>
          <p className="hint">
            직접 세어본 실제 수량을 입력하면, 계산상 재고({currentStock.toLocaleString()}
            {unitLabel})와 차이나는 만큼 자동으로 보정해요.
          </p>
          <div className="field">
            <label htmlFor="countedQty">실제 확인한 수량{unitLabel ? ` (${unitLabel})` : ''}</label>
            <input
              id="countedQty"
              className="input"
              inputMode="decimal"
              value={countedQty}
              onChange={(e) => setCountedQty(e.target.value)}
              placeholder="예: 15"
            />
          </div>
          <div className="field">
            <label htmlFor="adjustedDate">확인일</label>
            <input
              id="adjustedDate"
              className="input"
              type="date"
              value={adjustedDate}
              onChange={(e) => setAdjustedDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="adjustMemo">메모</label>
            <input
              id="adjustMemo"
              className="input"
              value={adjustMemo}
              onChange={(e) => setAdjustMemo(e.target.value)}
              placeholder="선택사항"
            />
          </div>
          <button type="button" className="btn-secondary" onClick={handleAddAdjustment} disabled={savingAdjustment}>
            {savingAdjustment ? '저장 중...' : '실사 결과 반영'}
          </button>

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
            위 현재고·누적 수치는 항상 전체 기간 기준이고, 아래 내역 목록만 이 기간으로 좁혀서 볼 수 있어요.
          </p>

          <h2 className="section-title">사용 내역 ({visibleUsageRows.length}건)</h2>
          {usageRows.length === 0 && <p className="hint">아직 기록된 사용량이 없습니다.</p>}
          {usageRows.length > 0 && visibleUsageRows.length === 0 && (
            <p className="hint">이 기간에 사용 기록이 없습니다.</p>
          )}
          <ul className="history-list">
            {visibleUsageRows.map((r) => (
              <li key={r.id} className="history-row">
                <div className="history-row-main">
                  <span className="history-item">{r.used_date ?? '날짜 미입력'}</span>
                  <div className="history-row-main-end">
                    <span>
                      -{Number(r.used_qty).toLocaleString()}
                      {unitLabel}
                    </span>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="사용 내역 삭제"
                      onClick={() => setDeleteUsageTarget(r)}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                {r.memo && (
                  <div className="history-row-sub">
                    <span>{r.memo}</span>
                  </div>
                )}

                {deleteUsageTarget?.id === r.id && (
                  <div className="price-alert-box price-alert-box-danger">
                    <p className="price-alert-title">이 사용 내역을 삭제할까요?</p>
                    <p className="hint">잘못 입력한 사용량 기록만 지워지고, 되돌릴 수 없어요.</p>
                    <div className="invoice-form">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setDeleteUsageTarget(null)}
                        disabled={deletingUsage}
                      >
                        취소
                      </button>
                      <button type="button" className="btn-primary" onClick={handleDeleteUsage} disabled={deletingUsage}>
                        {deletingUsage ? '삭제 중...' : '삭제'}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>

          <h2 className="section-title">폐기 내역 ({visibleWasteRows.length}건)</h2>
          {wasteRows.length === 0 && <p className="hint">아직 기록된 폐기가 없습니다.</p>}
          {wasteRows.length > 0 && visibleWasteRows.length === 0 && (
            <p className="hint">이 기간에 폐기 기록이 없습니다.</p>
          )}
          <ul className="history-list">
            {visibleWasteRows.map((r) => (
              <li key={r.id} className="history-row">
                <div className="history-row-main">
                  <span className="history-item">{r.waste_date ?? '날짜 미입력'}</span>
                  <div className="history-row-main-end">
                    <span className="alert-up">
                      -{Number(r.qty).toLocaleString()}
                      {unitLabel}
                    </span>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="폐기 내역 삭제"
                      onClick={() => setDeleteWasteTarget(r)}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <div className="history-row-sub">
                  {r.reason && <span>{r.reason}</span>}
                  {r.memo && <span>{r.memo}</span>}
                </div>

                {deleteWasteTarget?.id === r.id && (
                  <div className="price-alert-box price-alert-box-danger">
                    <p className="price-alert-title">이 폐기 내역을 삭제할까요?</p>
                    <p className="hint">잘못 입력한 폐기 기록만 지워지고, 되돌릴 수 없어요.</p>
                    <div className="invoice-form">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setDeleteWasteTarget(null)}
                        disabled={deletingWaste}
                      >
                        취소
                      </button>
                      <button type="button" className="btn-primary" onClick={handleDeleteWaste} disabled={deletingWaste}>
                        {deletingWaste ? '삭제 중...' : '삭제'}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>

          <h2 className="section-title">실사 내역 ({visibleAdjustmentRows.length}건)</h2>
          {adjustmentRows.length === 0 && <p className="hint">아직 실사 기록이 없습니다.</p>}
          {adjustmentRows.length > 0 && visibleAdjustmentRows.length === 0 && (
            <p className="hint">이 기간에 실사 기록이 없습니다.</p>
          )}
          <ul className="history-list">
            {visibleAdjustmentRows.map((r) => (
              <li key={r.id} className="history-row">
                <div className="history-row-main">
                  <span className="history-item">{r.adjusted_date ?? '날짜 미입력'}</span>
                  <div className="history-row-main-end">
                    <span className={Number(r.delta) < 0 ? 'alert-up' : ''}>
                      {Number(r.delta) > 0 ? '+' : ''}
                      {Number(r.delta).toLocaleString()}
                      {unitLabel}
                    </span>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="실사 내역 삭제"
                      onClick={() => setDeleteAdjustmentTarget(r)}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <div className="history-row-sub">
                  {r.counted_qty != null && (
                    <span>
                      실사 결과 {Number(r.counted_qty).toLocaleString()}
                      {unitLabel}
                    </span>
                  )}
                  {r.memo && <span>{r.memo}</span>}
                </div>

                {deleteAdjustmentTarget?.id === r.id && (
                  <div className="price-alert-box price-alert-box-danger">
                    <p className="price-alert-title">이 실사 내역을 삭제할까요?</p>
                    <p className="hint">삭제하면 이 보정만큼 현재고 계산에서 다시 빠져요. 되돌릴 수 없어요.</p>
                    <div className="invoice-form">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setDeleteAdjustmentTarget(null)}
                        disabled={deletingAdjustment}
                      >
                        취소
                      </button>
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={handleDeleteAdjustment}
                        disabled={deletingAdjustment}
                      >
                        {deletingAdjustment ? '삭제 중...' : '삭제'}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>

          <h2 className="section-title">입고 내역 ({visibleReceipts.length}건)</h2>
          {receipts.length === 0 && <p className="hint">아직 입고 내역이 없습니다.</p>}
          {receipts.length > 0 && visibleReceipts.length === 0 && (
            <p className="hint">이 기간에 입고 내역이 없습니다.</p>
          )}
          <ul className="history-list">
            {visibleReceipts.map((r) => (
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
