import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import {
  analyzeReorder,
  buildOrderList,
  groupAlertsByVendor,
  localDateStr,
  muteCardKey,
  orderedCardKey,
  MAX_ITEM_ALERTS,
  MUTED_SIGNATURE,
  UNMUTED_SIGNATURE,
  ORDER_CANCELLED_SIGNATURE,
  ORDER_WAIT_DAYS,
  STALE_RATIO,
} from '../lib/reorderCalc'
import { loadReorderInputs } from '../lib/reorderData'
import { UNIT_LABELS } from '../lib/units'

const NO_UNIT_KEY = 'none'

const STATUS_LABELS = {
  overdue: { text: '주문 시기 지남', className: 'status-tag status-tag-danger' },
  dueSoon: { text: '슬슬 주문할 때', className: 'status-tag status-tag-warn' },
  lowStock: { text: '재고 적음', className: 'status-tag status-tag-warn' },
}

const EMPTY_REPORT = { alerts: [], stale: [], enoughStock: [], muted: [], ordered: [] }

const unitLabelOf = (unit) => (unit ? UNIT_LABELS[unit] ?? unit : '')

function fmtQty(n) {
  if (n == null || !Number.isFinite(n)) return '-'
  return (Math.round(n * 10) / 10).toLocaleString()
}

function fmtDays(n) {
  if (n < 1) return '1일 미만'
  return `${Math.round(n)}일`
}

function daysAgo(dateStr) {
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / (24 * 60 * 60 * 1000))
  return days <= 0 ? '오늘' : `${days}일 전`
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    document.body.removeChild(ta)
    return ok
  }
}

function StatusBadges({ item }) {
  const status = item.status ? STATUS_LABELS[item.status] : null
  return (
    <span className="reorder-badges">
      {item.orderPending && <span className="status-tag status-tag-danger">주문 후 입고 없음</span>}
      {status && !item.orderPending && <span className={status.className}>{status.text}</span>}
      {item.pinned && <span className="status-tag status-tag-ok">★ 관심</span>}
      {item.recipeLinked && <span className="status-tag status-tag-ok">레시피 재료</span>}
    </span>
  )
}

function ItemFacts({ item }) {
  const unitLabel = unitLabelOf(item.unit)
  return (
    <div className="history-row-sub">
      {item.orderPending && <span>📦 {item.orderedDate} 주문 → 아직 입고 기록 없음</span>}
      <span>평소 약 {fmtDays(item.avgIntervalDays)}마다</span>
      {item.basis === 'quantity' && (
        <>
          <span>
            하루 약 {fmtQty(item.dailyUse)}
            {unitLabel} 사용
          </span>
          <span>
            지난번 {fmtQty(item.lastQty)}
            {unitLabel} → 약 {fmtDays(item.expectedDays)}치
          </span>
        </>
      )}
      <span>마지막 입고 {fmtDays(item.daysSinceLast)} 전</span>
      {item.currentStock != null && (
        <span>
          현재고 {fmtQty(item.currentStock)}
          {unitLabel}
        </span>
      )}
      {item.basis === 'interval' && <span>(수량이 빠진 입고가 있어 날짜로만 계산)</span>}
      {item.otherVendors.length > 0 && <span>다른 거래처에서도 구매: {item.otherVendors.join(', ')}</span>}
    </div>
  )
}

function ItemSummary({ item }) {
  return (
    <>
      <div className="history-row-main">
        <span className="history-item">{item.itemName}</span>
        <StatusBadges item={item} />
      </div>
      <div className="history-row-sub">
        <span>{item.vendor}</span>
        {item.recommendedQty != null && (
          <span>
            추천 주문량 {fmtQty(item.recommendedQty)}
            {unitLabelOf(item.unit)}
          </span>
        )}
      </div>
      <ItemFacts item={item} />
    </>
  )
}

function qtyStep(unit, qty) {
  if (unit === 'ea' || unit === 'box') return 1
  return qty != null && qty < 1 ? 0.1 : 1
}

function VendorPanel({ group, defaultOpen, onMarkOrdered, saving }) {
  const [open, setOpen] = useState(defaultOpen)
  const [checked, setChecked] = useState(() => new Set(group.items.map((i) => i.key)))
  const [qtyByKey, setQtyByKey] = useState(() => new Map(group.items.map((i) => [i.key, i.recommendedQty])))
  const [notice, setNotice] = useState('')

  const selected = group.items.filter((i) => checked.has(i.key))
  const orderList = buildOrderList(
    selected.map((i) => ({ itemName: i.itemName, qty: qtyByKey.get(i.key), unitLabel: unitLabelOf(i.unit) })),
  )

  const toggle = (key) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    setNotice('')
  }

  const setQty = (key, value) => {
    setQtyByKey((prev) => new Map(prev).set(key, value))
    setNotice('')
  }

  const bump = (item, dir) => {
    const cur = qtyByKey.get(item.key)
    const step = qtyStep(item.unit, cur)
    const next = Math.max(0, Math.round(((Number(cur) || 0) + dir * step) * 10) / 10)
    setQty(item.key, next === 0 ? null : next)
  }

  const askMarkOrdered = () => {
    if (selected.length === 0) return
    if (window.confirm(`체크한 ${selected.length}개 품목을 "주문했어요"로 표시할까요?\n${ORDER_WAIT_DAYS}일 안에 입고가 없으면 다시 알려드려요.`)) {
      onMarkOrdered(selected)
    }
  }

  const handleCopy = async () => {
    const ok = await copyText(orderList)
    setNotice(
      ok
        ? `${selected.length}개 품목을 복사했어요. 거래처 카톡방에 붙여넣으세요.`
        : '복사하지 못했어요. 다시 눌러 주세요.',
    )
    if (ok) askMarkOrdered()
  }

  return (
    <li className="panel reorder-vendor">
      <button type="button" className="reorder-vendor-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="reorder-vendor-name">{group.vendor}</span>
        <span className="reorder-vendor-meta">
          {group.items.length}품목
          {group.urgentCount > 0 && <span className="status-tag status-tag-danger">급함 {group.urgentCount}</span>}
          <span aria-hidden="true">{open ? '▲' : '▼'}</span>
        </span>
      </button>

      {open && (
        <>
          <ul className="reorder-items">
            {group.items.map((item) => {
              const qty = qtyByKey.get(item.key)
              const unitLabel = unitLabelOf(item.unit)
              return (
                <li key={item.key} className="reorder-item">
                  <label className="reorder-item-check">
                    <input type="checkbox" checked={checked.has(item.key)} onChange={() => toggle(item.key)} />
                    <span className="history-item">{item.itemName}</span>
                  </label>
                  <StatusBadges item={item} />
                  <div className="reorder-qty">
                    <button type="button" className="mini-btn" onClick={() => bump(item, -1)} aria-label="수량 줄이기">
                      −
                    </button>
                    <input
                      type="number"
                      inputMode="decimal"
                      className="input reorder-qty-input"
                      value={qty ?? ''}
                      placeholder="수량"
                      onChange={(e) => setQty(item.key, e.target.value === '' ? null : Number(e.target.value))}
                      aria-label={`${item.itemName} 주문 수량`}
                    />
                    <span className="reorder-qty-unit">{unitLabel}</span>
                    <button type="button" className="mini-btn" onClick={() => bump(item, 1)} aria-label="수량 늘리기">
                      +
                    </button>
                    {item.recommendedQty != null && <span className="hint">추천 {fmtQty(item.recommendedQty)}{unitLabel}</span>}
                  </div>
                  <ItemFacts item={item} />
                </li>
              )
            })}
          </ul>

          <div className="reorder-actions">
            <button type="button" className="btn-primary" onClick={handleCopy} disabled={selected.length === 0}>
              📋 체크한 {selected.length}개 품목 복사
            </button>
            <button type="button" className="btn-secondary" onClick={askMarkOrdered} disabled={selected.length === 0 || saving}>
              ✅ 주문했어요 (복사 없이 표시만)
            </button>
          </div>
          {notice && <p className="hint">{notice}</p>}
        </>
      )}
    </li>
  )
}

export default function ReorderAlertScreen() {
  const { store } = useStore()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const focusVendor = searchParams.get('vendor')

  const [view, setView] = useState('vendor')
  const [rawData, setRawData] = useState(null)
  const [mutedKeys, setMutedKeys] = useState(new Set())
  const [orderedMarks, setOrderedMarks] = useState(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [showAllItems, setShowAllItems] = useState(false)

  useEffect(() => {
    if (!store) navigate('/', { replace: true })
  }, [store, navigate])

  useEffect(() => {
    if (!store || !supabase) return
    setLoading(true)
    setError('')
    let cancelled = false
    loadReorderInputs(store.code)
      .then((inputs) => {
        if (cancelled) return
        setRawData(inputs)
        setMutedKeys(inputs.mutedKeys)
        setOrderedMarks(inputs.orderedMarks)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [store])

  if (!store) return null

  const report = rawData
    ? analyzeReorder(rawData.invoices, {
        stockByKey: rawData.stockByKey,
        pinnedNames: rawData.pinnedNames,
        recipeItemNames: rawData.recipeItemNames,
        mutedKeys,
        orderedMarks,
      })
    : EMPTY_REPORT
  const vendorGroups = groupAlertsByVendor(report.alerts)

  const saveMarks = async (rows) => {
    if (!supabase || rows.length === 0) return false
    setSaving(true)
    setError('')
    const now = new Date().toISOString()
    const { error: err } = await supabase.from('dashboard_dismissals').upsert(
      rows.map((r) => ({ store_code: store.code, card_key: r.cardKey, signature: r.signature, dismissed_at: now })),
      { onConflict: 'store_code,card_key' },
    )
    setSaving(false)
    if (err) {
      setError(err.message)
      return false
    }
    return true
  }

  const markOrdered = async (items) => {
    const today = localDateStr()
    const ok = await saveMarks(items.map((i) => ({ cardKey: orderedCardKey(i.itemName, i.unit), signature: today })))
    if (!ok) return
    setOrderedMarks((prev) => {
      const next = new Map(prev)
      for (const i of items) next.set(i.key, today)
      return next
    })
  }

  const cancelOrdered = async (item) => {
    const ok = await saveMarks([{ cardKey: orderedCardKey(item.itemName, item.unit), signature: ORDER_CANCELLED_SIGNATURE }])
    if (!ok) return
    setOrderedMarks((prev) => {
      const next = new Map(prev)
      next.delete(item.key)
      return next
    })
  }

  const setMuted = async (item, mute) => {
    const ok = await saveMarks([
      { cardKey: muteCardKey(item.itemName, item.unit), signature: mute ? MUTED_SIGNATURE : UNMUTED_SIGNATURE },
    ])
    if (!ok) return
    setMutedKeys((prev) => {
      const next = new Set(prev)
      if (mute) next.add(item.key)
      else next.delete(item.key)
      return next
    })
  }

  const goDetail = (item) => navigate(`/inventory/${encodeURIComponent(item.itemName)}/${item.unit ?? NO_UNIT_KEY}`)

  const renderItemRow = (item, actions = []) => (
    <li key={item.key} className="history-row">
      <button type="button" className="cost-row-btn" onClick={() => goDetail(item)}>
        <ItemSummary item={item} />
      </button>
      {actions.length > 0 && (
        <div className="history-row-main-end">
          {actions.map((a) => (
            <button key={a.label} type="button" className="link-btn" disabled={saving} onClick={a.onClick}>
              {a.label}
            </button>
          ))}
        </div>
      )}
    </li>
  )

  const visibleItemAlerts = showAllItems ? report.alerts : report.alerts.slice(0, MAX_ITEM_ALERTS)

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/menu')}>
          ← 메인 메뉴
        </button>
        <h1>재주문 알림</h1>
        <p className="subtitle">{store.name} · 거래처별로 주문할 품목과 수량을 모아 카톡으로 바로 보낼 수 있어요</p>
      </div>

      <div className="toolbar-chips reorder-tabs" role="tablist">
        <button type="button" className={`chip${view === 'vendor' ? ' chip-active' : ''}`} onClick={() => setView('vendor')}>
          거래처별 {vendorGroups.length}곳
        </button>
        <button type="button" className={`chip${view === 'item' ? ' chip-active' : ''}`} onClick={() => setView('item')}>
          품목별 {report.alerts.length}개
        </button>
      </div>

      {!supabase && <p className="hint">Supabase가 설정되지 않았습니다.</p>}
      {loading && <p className="hint">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}
      {!loading && !error && supabase && rawData && report.alerts.length === 0 && (
        <p className="hint">
          지금은 주문할 품목이 없어요. (같은 품목의 입고 기록이 3번 이상 쌓여야 계산할 수 있어요)
        </p>
      )}

      {view === 'vendor' && rawData && (
        <>
          {vendorGroups.length > 0 && (
            <p className="hint">
              거래처를 누르면 품목이 보여요. 이번에 주문하지 않을 품목은 체크를 풀고, 수량을 고친 뒤 복사해서 거래처 카톡방에 붙여넣으세요.
              주문한 품목은 목록에서 빠지고, {ORDER_WAIT_DAYS}일 안에 입고가 없으면 다시 알려드려요.
            </p>
          )}
          <ul className="history-list">
            {vendorGroups.map((g) => (
              <VendorPanel
                key={g.vendor}
                group={g}
                defaultOpen={focusVendor ? focusVendor === g.vendor : vendorGroups.length === 1}
                onMarkOrdered={markOrdered}
                saving={saving}
              />
            ))}
          </ul>
        </>
      )}

      {view === 'item' && rawData && (
        <>
          <p className="hint">
            평소 하루 사용량으로 지난번 입고량이 며칠 갈지 계산해요. 그 기간의 80%가 지나면 "슬슬 주문할 때", 다 지나면
            "주문 시기 지남"이에요. 입고되면 바로 빠져요. 같은 급한 정도라면 ★관심 품목 → 레시피 재료 → 자주 입고되는 품목
            순서로 보여줘요.
          </p>
          <ul className="history-list">
            {visibleItemAlerts.map((a) =>
              renderItemRow(a, [
                { label: '주문했어요', onClick: () => markOrdered([a]) },
                { label: '알림 끄기', onClick: () => setMuted(a, true) },
              ]),
            )}
          </ul>
          {!showAllItems && report.alerts.length > MAX_ITEM_ALERTS && (
            <button type="button" className="btn-secondary" onClick={() => setShowAllItems(true)}>
              나머지 {report.alerts.length - MAX_ITEM_ALERTS}개 더 보기
            </button>
          )}
        </>
      )}

      {rawData && report.ordered.length > 0 && (
        <details className="panel">
          <summary>주문하고 입고를 기다리는 품목 {report.ordered.length}개</summary>
          <p className="hint">입고되면 자동으로 정리되고, {ORDER_WAIT_DAYS}일이 지나도 입고가 없으면 다시 알림에 나와요.</p>
          <ul className="history-list">
            {report.ordered.map((a) =>
              renderItemRow({ ...a, status: null }, [
                { label: `주문 취소 (${daysAgo(a.orderedDate)} 주문)`, onClick: () => cancelOrdered(a) },
              ]),
            )}
          </ul>
        </details>
      )}

      {rawData && report.enoughStock.length > 0 && (
        <details className="panel">
          <summary>재고가 충분해서 뺀 품목 {report.enoughStock.length}개</summary>
          <p className="hint">주문 주기는 됐지만 현재고가 평소 한 번 입고량의 절반 이상 남아 있어요.</p>
          <ul className="history-list">{report.enoughStock.map((a) => renderItemRow({ ...a, status: null }))}</ul>
        </details>
      )}

      {rawData && report.stale.length > 0 && (
        <details className="panel">
          <summary>오래 주문하지 않아 뺀 품목 {report.stale.length}개</summary>
          <p className="hint">
            예상 소진일의 {STALE_RATIO}배가 지나도록 입고가 없어 더 이상 사지 않는 품목으로 보고 알림에서 뺐어요. 다시
            입고되면 자동으로 알림 대상이 돼요.
          </p>
          <ul className="history-list">{report.stale.map((a) => renderItemRow(a))}</ul>
        </details>
      )}

      {rawData && report.muted.length > 0 && (
        <details className="panel">
          <summary>알림 끈 품목 {report.muted.length}개</summary>
          <ul className="history-list">
            {report.muted.map((a) => renderItemRow(a, [{ label: '알림 다시 켜기', onClick: () => setMuted(a, false) }]))}
          </ul>
        </details>
      )}
    </div>
  )
}
