import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import {
  analyzeReorder,
  mutedKeysFromDismissals,
  muteCardKey,
  MUTE_KEY_PREFIX,
  MUTED_SIGNATURE,
  STALE_RATIO,
} from '../lib/reorderCalc'
import { buildStockLedger } from '../lib/stockLedger'
import { UNIT_LABELS } from '../lib/units'
import { stockKey } from '../lib/stockKey'

const NO_UNIT_KEY = 'none'

const STATUS_LABELS = {
  overdue: { text: '⏰ 주문 시기 지남', className: 'alert-up' },
  dueSoon: { text: '슬슬 주문할 때', className: 'cost-warning' },
  lowStock: { text: '재고 적음', className: 'cost-warning' },
}

const EMPTY_REPORT = { alerts: [], stale: [], enoughStock: [], muted: [] }

function fmtQty(n) {
  if (n == null || !Number.isFinite(n)) return '-'
  return (Math.round(n * 10) / 10).toLocaleString()
}

function fmtDays(n) {
  if (n < 1) return '1일 미만'
  return `${Math.round(n)}일`
}

export default function ReorderAlertScreen() {
  const { store } = useStore()
  const navigate = useNavigate()

  const [rawData, setRawData] = useState(null)
  const [mutedKeys, setMutedKeys] = useState(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [savingKey, setSavingKey] = useState('')

  useEffect(() => {
    if (!store) navigate('/', { replace: true })
  }, [store, navigate])

  useEffect(() => {
    if (!store || !supabase) return
    setLoading(true)
    setError('')
    Promise.all([
      supabase.from('invoices').select('item_name, unit, quantity, invoice_date').eq('store_code', store.code),
      supabase.from('stock_usage').select('item_name, unit, used_qty').eq('store_code', store.code),
      supabase.from('waste_records').select('item_name, unit, qty').eq('store_code', store.code),
      supabase.from('stock_adjustments').select('item_name, unit, delta').eq('store_code', store.code),
      supabase
        .from('dashboard_dismissals')
        .select('card_key, signature')
        .eq('store_code', store.code)
        .like('card_key', `${MUTE_KEY_PREFIX}%`),
    ]).then(([invoicesRes, usageRes, wasteRes, adjustmentsRes, mutesRes]) => {
      const err = invoicesRes.error || usageRes.error || wasteRes.error || adjustmentsRes.error || mutesRes.error
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }
      const stockByKey = buildStockLedger({
        invoices: invoicesRes.data ?? [],
        usage: usageRes.data ?? [],
        waste: wasteRes.data ?? [],
        adjustments: adjustmentsRes.data ?? [],
      })
      setRawData({ invoices: invoicesRes.data ?? [], stockByKey })
      setMutedKeys(mutedKeysFromDismissals(mutesRes.data))
      setLoading(false)
    })
  }, [store])

  if (!store) return null

  const report = rawData ? analyzeReorder(rawData.invoices, { stockByKey: rawData.stockByKey, mutedKeys }) : EMPTY_REPORT

  const setMuted = async (item, mute) => {
    if (!supabase) return
    const key = stockKey(item.itemName, item.unit)
    setSavingKey(key)
    setError('')
    const { error: err } = await supabase.from('dashboard_dismissals').upsert(
      {
        store_code: store.code,
        card_key: muteCardKey(item.itemName, item.unit),
        signature: mute ? MUTED_SIGNATURE : 'unmuted',
        dismissed_at: new Date().toISOString(),
      },
      { onConflict: 'store_code,card_key' },
    )
    setSavingKey('')
    if (err) {
      setError(err.message)
      return
    }
    setMutedKeys((prev) => {
      const next = new Set(prev)
      if (mute) next.add(key)
      else next.delete(key)
      return next
    })
  }

  const goDetail = (item) => navigate(`/inventory/${encodeURIComponent(item.itemName)}/${item.unit ?? NO_UNIT_KEY}`)

  const renderDetails = (a) => {
    const unitLabel = a.unit ? UNIT_LABELS[a.unit] ?? a.unit : ''
    return (
      <div className="history-row-sub">
        <span>평소 약 {fmtDays(a.avgIntervalDays)}마다 주문</span>
        {a.basis === 'quantity' && (
          <>
            <span>
              한 번에 평균 {fmtQty(a.avgQty)}
              {unitLabel}
            </span>
            <span>
              하루 약 {fmtQty(a.dailyUse)}
              {unitLabel} 사용
            </span>
            <span>
              지난번 {fmtQty(a.lastQty)}
              {unitLabel} → 약 {fmtDays(a.expectedDays)}치
            </span>
          </>
        )}
        <span>마지막 입고 {fmtDays(a.daysSinceLast)} 전</span>
        {a.basis === 'quantity' && a.estimatedRemaining != null && (
          <span>
            예상 남은 양 약 {fmtQty(a.estimatedRemaining)}
            {unitLabel}
          </span>
        )}
        {a.currentStock != null && (
          <span>
            현재고 {fmtQty(a.currentStock)}
            {unitLabel}
          </span>
        )}
        {a.basis === 'interval' && <span>(수량이 빠진 입고가 있어 날짜로만 계산)</span>}
      </div>
    )
  }

  const renderRow = (a, { action, label }) => {
    const key = stockKey(a.itemName, a.unit)
    const status = a.status ? STATUS_LABELS[a.status] : null
    return (
      <li key={key} className="history-row">
        <button type="button" className="cost-row-btn" onClick={() => goDetail(a)}>
          <div className="history-row-main">
            <span className="history-item">{a.itemName}</span>
            {status && <span className={status.className}>{status.text}</span>}
          </div>
          {renderDetails(a)}
        </button>
        {action && (
          <div className="history-row-main-end">
            <button type="button" className="link-btn" disabled={savingKey === key} onClick={action}>
              {savingKey === key ? '저장 중...' : label}
            </button>
          </div>
        )}
      </li>
    )
  }

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/menu')}>
          ← 메인 메뉴
        </button>
        <h1>재주문 알림</h1>
        <p className="subtitle">{store.name} · 입고 날짜와 양으로 다 써갈 때가 된 품목을 알려드려요</p>
      </div>

      <p className="hint">
        평소 하루 사용량(그동안 들어온 양 ÷ 기간)으로 지난번 입고량이 며칠 갈지 계산해요. 그 기간의 80%가 지나면
        "슬슬 주문할 때", 다 지나면 "주문 시기 지남"이에요. 사용량이나 재고실사를 입력하는 품목은 현재고가 평소 한 번
        입고량의 절반 이상 남아 있으면 알리지 않고, 절반보다 적으면 주기가 안 됐어도 "재고 적음"으로 알려요.
      </p>

      {!supabase && <p className="hint">Supabase가 설정되지 않았습니다.</p>}
      {loading && <p className="hint">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}
      {!loading && !error && supabase && rawData && report.alerts.length === 0 && (
        <p className="hint">
          지금은 재주문할 때가 된 품목이 없어요. (같은 품목의 입고 기록이 3번 이상 쌓여야 계산할 수 있어요)
        </p>
      )}

      <ul className="history-list">
        {report.alerts.map((a) => renderRow(a, { action: () => setMuted(a, true), label: '이 품목 알림 끄기' }))}
      </ul>

      {report.enoughStock.length > 0 && (
        <details className="panel">
          <summary>재고가 충분해서 뺀 품목 {report.enoughStock.length}개</summary>
          <p className="hint">주문 주기는 됐지만 현재고가 평소 한 번 입고량의 절반 이상 남아 있어요.</p>
          <ul className="history-list">{report.enoughStock.map((a) => renderRow(a, {}))}</ul>
        </details>
      )}

      {report.stale.length > 0 && (
        <details className="panel">
          <summary>오래 주문하지 않아 뺀 품목 {report.stale.length}개</summary>
          <p className="hint">
            예상 소진일의 {STALE_RATIO}배가 지나도록 입고가 없어 더 이상 사지 않는 품목으로 보고 알림에서 뺐어요. 다시
            입고되면 자동으로 알림 대상이 돼요.
          </p>
          <ul className="history-list">{report.stale.map((a) => renderRow(a, {}))}</ul>
        </details>
      )}

      {report.muted.length > 0 && (
        <details className="panel">
          <summary>알림 끈 품목 {report.muted.length}개</summary>
          <ul className="history-list">
            {report.muted.map((a) => renderRow(a, { action: () => setMuted(a, false), label: '알림 다시 켜기' }))}
          </ul>
        </details>
      )}
    </div>
  )
}
