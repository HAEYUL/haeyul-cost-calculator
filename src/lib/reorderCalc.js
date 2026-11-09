import { stockKey } from './stockKey'
import { LOW_STOCK_RATIO } from './stockStatus'

const DAY_MS = 24 * 60 * 60 * 1000

function daysBetween(a, b) {
  return (b.getTime() - a.getTime()) / DAY_MS
}

// 곧 주문할 때: 예상 소진일의 80%가 지나면
export const DUE_SOON_RATIO = 0.8
// 주문이 끊긴 품목: 예상 소진일의 3배가 지나도 입고가 없으면 더 이상 안 사는 품목으로 보고 알림에서 뺀다.
export const STALE_RATIO = 3
// 직전 입고량이 평소와 많이 달라도 예상 소진일이 평소 주기의 1/4 ~ 4배를 벗어나지 않게 한다(입력 실수 대비).
const MIN_EXPECTED_FACTOR = 0.25
const MAX_EXPECTED_FACTOR = 4

// 품목별 "알림 끄기"는 홈 카드 숨김 기록 표(dashboard_dismissals)에 card_key로 저장한다.
export const MUTE_KEY_PREFIX = 'reorder-mute:'
export const MUTED_SIGNATURE = 'muted'
export const muteCardKey = (itemName, unit) => `${MUTE_KEY_PREFIX}${stockKey(itemName, unit)}`

export function mutedKeysFromDismissals(rows) {
  const keys = new Set()
  for (const r of rows ?? []) {
    if (r.card_key?.startsWith(MUTE_KEY_PREFIX) && r.signature === MUTED_SIGNATURE) {
      keys.add(r.card_key.slice(MUTE_KEY_PREFIX.length))
    }
  }
  return keys
}

// 재주문 판단: 입고 "날짜"와 "양"을 함께 본다.
// 1) 입고일이 3번 이상인 품목만 계산한다(주기를 믿을 수 없어서).
// 2) 하루 평균 사용량 = (마지막 입고 전까지 들어온 양) ÷ (첫 입고 ~ 마지막 입고 일수).
//    지난번에 들어온 양 ÷ 하루 평균 사용량 = 그 양이 버틸 것으로 예상되는 일수(예상 소진일).
//    → 지난번에 평소보다 2배 많이 샀으면 알림도 2배 늦게 뜬다.
//    수량이 빠진 입고가 있으면 날짜만으로 평균 주문 주기를 예상 소진일로 쓴다.
// 3) 마지막 입고 후 지난 일수 ÷ 예상 소진일 = ratio
//    ratio ≥ 1 주문 시기 지남 / ≥ 0.8 곧 주문할 때 / ≥ 3 주문이 끊긴 품목(알림 제외)
// 4) 사용량·재고실사를 입력하는 품목(재고를 믿을 수 있는 품목)은 현재고도 본다.
//    현재고가 평소 한 번 입고량의 절반 이상이면 알림에서 빼고, 절반 미만이면 주기가 안 됐어도 알린다.
// 5) "알림 끄기"한 품목은 따로 모은다.
export function analyzeReorder(invoiceRows, { now = new Date(), stockByKey = new Map(), mutedKeys = new Set() } = {}) {
  const byItem = new Map()
  for (const row of invoiceRows ?? []) {
    if (!row.invoice_date) continue
    const key = stockKey(row.item_name, row.unit)
    if (!byItem.has(key)) byItem.set(key, { itemName: row.item_name, unit: row.unit ?? null, byDate: new Map() })
    const byDate = byItem.get(key).byDate
    const prev = byDate.get(row.invoice_date) ?? { qty: 0, missingQty: false }
    const qty = row.quantity == null ? NaN : Number(row.quantity)
    if (Number.isFinite(qty) && qty > 0) prev.qty += qty
    else prev.missingQty = true
    byDate.set(row.invoice_date, prev)
  }

  const alerts = []
  const stale = []
  const enoughStock = []
  const muted = []

  for (const [key, { itemName, unit, byDate }] of byItem) {
    const dates = [...byDate.keys()].sort()
    const n = dates.length
    if (n < 3) continue

    const first = new Date(dates[0])
    const last = new Date(dates[n - 1])
    const spanDays = daysBetween(first, last)
    const avgIntervalDays = spanDays / (n - 1)
    if (!(avgIntervalDays > 0)) continue

    const entries = dates.map((d) => byDate.get(d))
    const qtyKnown = entries.every((e) => !e.missingQty && e.qty > 0)
    const daysSinceLast = Math.max(0, daysBetween(last, now))

    let expectedDays = avgIntervalDays
    let dailyUse = null
    let lastQty = null
    let avgQty = null
    let estimatedRemaining = null
    if (qtyKnown) {
      const consumed = entries.slice(0, -1).reduce((s, e) => s + e.qty, 0)
      dailyUse = consumed / spanDays
      lastQty = entries[n - 1].qty
      avgQty = entries.reduce((s, e) => s + e.qty, 0) / n
      if (dailyUse > 0) {
        expectedDays = Math.min(
          Math.max(lastQty / dailyUse, avgIntervalDays * MIN_EXPECTED_FACTOR),
          avgIntervalDays * MAX_EXPECTED_FACTOR,
        )
        estimatedRemaining = Math.max(0, lastQty - dailyUse * daysSinceLast)
      }
    }
    const ratio = daysSinceLast / expectedDays

    const stock = stockByKey.get(key)
    const stockTracked = Boolean(stock?.tracked)
    const perDelivery = stock && stock.receiptCount > 0 ? stock.received / stock.receiptCount : avgQty
    const currentStock = stock ? stock.current : null
    const stockLow = stockTracked && perDelivery > 0 && currentStock < perDelivery * LOW_STOCK_RATIO

    const info = {
      itemName,
      unit,
      receiptDays: n,
      avgIntervalDays,
      expectedDays,
      daysSinceLast,
      ratio,
      basis: qtyKnown && dailyUse > 0 ? 'quantity' : 'interval',
      dailyUse,
      lastQty,
      avgQty,
      estimatedRemaining,
      currentStock: stockTracked ? currentStock : null,
      stockTracked,
    }

    if (mutedKeys.has(key)) {
      muted.push(info)
      continue
    }
    if (ratio >= STALE_RATIO) {
      stale.push(info)
      continue
    }

    let status = null
    if (ratio >= 1) status = 'overdue'
    else if (ratio >= DUE_SOON_RATIO) status = 'dueSoon'
    else if (stockLow) status = 'lowStock'
    if (!status) continue

    if (stockTracked && !stockLow) {
      enoughStock.push({ ...info, status })
      continue
    }
    alerts.push({ ...info, status })
  }

  const rank = { overdue: 0, dueSoon: 1, lowStock: 2 }
  alerts.sort((a, b) => rank[a.status] - rank[b.status] || b.ratio - a.ratio)
  stale.sort((a, b) => a.ratio - b.ratio)
  enoughStock.sort((a, b) => b.ratio - a.ratio)
  muted.sort((a, b) => a.itemName.localeCompare(b.itemName))
  return { alerts, stale, enoughStock, muted }
}

export function computeReorderAlerts(invoiceRows, options) {
  return analyzeReorder(invoiceRows, options).alerts
}
