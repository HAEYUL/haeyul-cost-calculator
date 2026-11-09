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
// "주문했어요"를 누른 뒤 이 기간 안에 입고가 없으면 다시 알린다(주문 누락·명세서 미입력 확인용).
export const ORDER_WAIT_DAYS = 3
// "자주 입고되는 품목"을 셀 기간
export const RECENT_DAYS = 60
// 품목별 보기에서 보여줄 최대 개수
export const MAX_ITEM_ALERTS = 30
// 직전 입고량이 평소와 많이 달라도 예상 소진일이 평소 주기의 1/4 ~ 4배를 벗어나지 않게 한다(입력 실수 대비).
const MIN_EXPECTED_FACTOR = 0.25
const MAX_EXPECTED_FACTOR = 4

// 품목별 "알림 끄기"와 "주문했어요"는 홈 카드 숨김 기록 표(dashboard_dismissals)에 card_key로 저장한다(DB 변경 없음).
export const MUTE_KEY_PREFIX = 'reorder-mute:'
export const ORDERED_KEY_PREFIX = 'reorder-ordered:'
export const MUTED_SIGNATURE = 'muted'
export const UNMUTED_SIGNATURE = 'unmuted'
export const ORDER_CANCELLED_SIGNATURE = 'cancelled'
export const muteCardKey = (itemName, unit) => `${MUTE_KEY_PREFIX}${stockKey(itemName, unit)}`
export const orderedCardKey = (itemName, unit) => `${ORDERED_KEY_PREFIX}${stockKey(itemName, unit)}`

export const NO_VENDOR = '거래처 미지정'

export function mutedKeysFromDismissals(rows) {
  const keys = new Set()
  for (const r of rows ?? []) {
    if (r.card_key?.startsWith(MUTE_KEY_PREFIX) && r.signature === MUTED_SIGNATURE) {
      keys.add(r.card_key.slice(MUTE_KEY_PREFIX.length))
    }
  }
  return keys
}

// "주문했어요" 기록: 품목키 → 주문한 날짜(YYYY-MM-DD)
export function orderedMarksFromDismissals(rows) {
  const marks = new Map()
  for (const r of rows ?? []) {
    if (r.card_key?.startsWith(ORDERED_KEY_PREFIX) && /^\d{4}-\d{2}-\d{2}$/.test(r.signature ?? '')) {
      marks.set(r.card_key.slice(ORDERED_KEY_PREFIX.length), r.signature)
    }
  }
  return marks
}

// 기기 시간 기준 오늘 날짜(YYYY-MM-DD). 명세서 입고일(invoice_date)과 같은 형식.
export function localDateStr(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// 추천 주문량 반올림: 개·박스는 올림해서 정수, 그 외는 1 이상이면 정수로 올림, 1 미만이면 소수 첫째 자리.
export function roundOrderQty(qty, unit) {
  if (!(qty > 0)) return null
  if (unit === 'ea' || unit === 'box' || qty >= 1) return Math.ceil(qty - 1e-9)
  return Math.ceil(qty * 10 - 1e-9) / 10
}

// 재주문 판단: 입고 "날짜"와 "양"을 함께 본다.
// 1) 입고일이 3번 이상인 품목만 계산한다(주기를 믿을 수 없어서).
// 2) 하루 평균 사용량 = (마지막 입고 전까지 들어온 양) ÷ (첫 입고 ~ 마지막 입고 일수).
//    지난번에 들어온 양 ÷ 하루 평균 사용량 = 그 양이 버틸 것으로 예상되는 일수(예상 소진일).
//    → 지난번에 평소보다 2배 많이 샀으면 알림도 2배 늦게 뜬다. 입고되면 마지막 입고일이 바뀌어 바로 빠진다.
//    수량이 빠진 입고가 있으면 날짜만으로 평균 주문 주기를 예상 소진일로 쓴다.
// 3) 마지막 입고 후 지난 일수 ÷ 예상 소진일 = ratio
//    ratio ≥ 1 주문 시기 지남 / ≥ 0.8 곧 주문할 때 / ≥ 3 주문이 끊긴 품목(알림 제외)
// 4) 사용량·재고실사를 입력하는 품목(재고를 믿을 수 있는 품목)은 현재고도 본다.
//    현재고가 평소 한 번 입고량의 절반 이상이면 알림에서 빼고, 절반 미만이면 주기가 안 됐어도 알린다.
// 5) "알림 끄기"한 품목은 따로 모은다.
// 6) "주문했어요"를 누른 품목은 그 뒤 입고가 들어올 때까지 숨긴다. 3일이 지나도 입고가 없으면
//    "주문했는데 입고 안 됨"으로 다시 알린다.
// 7) 정렬: 급한 순(지남 → 곧 → 재고 적음) → ★관심 품목 → 레시피 재료 → 최근 60일 입고 횟수 → 늦은 정도
export function analyzeReorder(
  invoiceRows,
  {
    now = new Date(),
    stockByKey = new Map(),
    mutedKeys = new Set(),
    orderedMarks = new Map(),
    pinnedNames = new Set(),
    recipeItemNames = new Set(),
  } = {},
) {
  const byItem = new Map()
  for (const row of invoiceRows ?? []) {
    if (!row.invoice_date) continue
    const key = stockKey(row.item_name, row.unit)
    if (!byItem.has(key)) {
      byItem.set(key, { itemName: row.item_name, unit: row.unit ?? null, byDate: new Map(), vendorDates: new Map() })
    }
    const item = byItem.get(key)
    const prev = item.byDate.get(row.invoice_date) ?? { qty: 0, missingQty: false }
    const qty = row.quantity == null ? NaN : Number(row.quantity)
    if (Number.isFinite(qty) && qty > 0) prev.qty += qty
    else prev.missingQty = true
    item.byDate.set(row.invoice_date, prev)
    const vendor = row.vendor?.trim() || NO_VENDOR
    const seen = item.vendorDates.get(vendor)
    if (!seen || row.invoice_date > seen) item.vendorDates.set(vendor, row.invoice_date)
  }

  const recentFrom = new Date(now.getTime() - RECENT_DAYS * DAY_MS)
  const alerts = []
  const stale = []
  const enoughStock = []
  const muted = []
  const ordered = []

  for (const [key, { itemName, unit, byDate, vendorDates }] of byItem) {
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
    const basis = qtyKnown && dailyUse > 0 ? 'quantity' : 'interval'

    const stock = stockByKey.get(key)
    const stockTracked = Boolean(stock?.tracked)
    const perDelivery = stock && stock.receiptCount > 0 ? stock.received / stock.receiptCount : avgQty
    const currentStock = stock ? stock.current : null
    const stockLow = stockTracked && perDelivery > 0 && currentStock < perDelivery * LOW_STOCK_RATIO

    // 거래처: 가장 최근에 사 온 곳. 여러 곳에서 샀으면 나머지는 otherVendors로.
    const vendorsByRecent = [...vendorDates.entries()].sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0))
    const vendor = vendorsByRecent[0]?.[0] ?? NO_VENDOR
    const otherVendors = vendorsByRecent.slice(1).map(([v]) => v).filter((v) => v !== NO_VENDOR)

    // 추천 주문량: 하루 사용량 × 평소 주문 주기(= 평소 한 번 주문량). 재고를 믿을 수 있으면 남은 양만큼 뺀다.
    let recommendedQty = null
    if (basis === 'quantity') {
      let need = dailyUse * avgIntervalDays
      if (stockTracked && currentStock > 0) need = Math.max(need - currentStock, need * 0.25)
      recommendedQty = roundOrderQty(need, unit)
    }

    const info = {
      key,
      itemName,
      unit,
      vendor,
      otherVendors,
      receiptDays: n,
      recentReceipts: dates.filter((d) => new Date(d) >= recentFrom).length,
      pinned: pinnedNames.has(itemName),
      recipeLinked: recipeItemNames.has(itemName),
      avgIntervalDays,
      expectedDays,
      daysSinceLast,
      ratio,
      basis,
      dailyUse,
      lastQty,
      avgQty,
      estimatedRemaining,
      recommendedQty,
      currentStock: stockTracked ? currentStock : null,
      stockTracked,
      orderedDate: null,
      orderPending: false,
    }

    if (mutedKeys.has(key)) {
      muted.push(info)
      continue
    }

    // "주문했어요" 이후 입고가 들어왔으면(마지막 입고일 ≥ 주문일) 주문 기록은 끝난 것으로 본다.
    const orderedDate = orderedMarks.get(key)
    if (orderedDate && dates[n - 1] < orderedDate) {
      info.orderedDate = orderedDate
      const daysSinceOrder = daysBetween(new Date(orderedDate), now)
      if (daysSinceOrder < ORDER_WAIT_DAYS) {
        ordered.push(info)
        continue
      }
      info.orderPending = true
    }

    if (!info.orderPending && ratio >= STALE_RATIO) {
      stale.push(info)
      continue
    }

    let status = null
    if (ratio >= 1) status = 'overdue'
    else if (ratio >= DUE_SOON_RATIO) status = 'dueSoon'
    else if (stockLow) status = 'lowStock'
    if (info.orderPending) status = status ?? 'overdue'
    if (!status) continue

    if (!info.orderPending && stockTracked && !stockLow) {
      enoughStock.push({ ...info, status })
      continue
    }
    alerts.push({ ...info, status })
  }

  alerts.sort(compareAlerts)
  stale.sort((a, b) => a.ratio - b.ratio)
  enoughStock.sort((a, b) => b.ratio - a.ratio)
  muted.sort((a, b) => a.itemName.localeCompare(b.itemName))
  ordered.sort((a, b) => a.vendor.localeCompare(b.vendor) || a.itemName.localeCompare(b.itemName))
  return { alerts, stale, enoughStock, muted, ordered }
}

const STATUS_RANK = { overdue: 0, dueSoon: 1, lowStock: 2 }

export function compareAlerts(a, b) {
  return (
    Number(b.orderPending) - Number(a.orderPending) ||
    STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
    Number(b.pinned) - Number(a.pinned) ||
    Number(b.recipeLinked) - Number(a.recipeLinked) ||
    b.recentReceipts - a.recentReceipts ||
    b.ratio - a.ratio ||
    a.itemName.localeCompare(b.itemName)
  )
}

export function computeReorderAlerts(invoiceRows, options) {
  return analyzeReorder(invoiceRows, options).alerts
}

// 거래처별 묶음. 급한 품목(지남·입고 안 됨)이 많은 거래처 → 품목 수 → 이름 순. "거래처 미지정"은 맨 뒤.
export function groupAlertsByVendor(alerts) {
  const groups = new Map()
  for (const a of alerts) {
    if (!groups.has(a.vendor)) groups.set(a.vendor, { vendor: a.vendor, items: [], urgentCount: 0 })
    const g = groups.get(a.vendor)
    g.items.push(a)
    if (a.status === 'overdue' || a.orderPending) g.urgentCount += 1
  }
  for (const g of groups.values()) g.items.sort(compareAlerts)
  return [...groups.values()].sort(
    (a, b) =>
      Number(a.vendor === NO_VENDOR) - Number(b.vendor === NO_VENDOR) ||
      b.urgentCount - a.urgentCount ||
      b.items.length - a.items.length ||
      a.vendor.localeCompare(b.vendor),
  )
}

// 카톡에 붙여넣을 주문 목록: 인사말 없이 "품목 수량" 한 줄씩. lines: [{ itemName, qty, unitLabel }] (qty가 없으면 이름만)
export function buildOrderList(lines) {
  return lines
    .map((l) => (l.qty != null && l.qty !== '' ? `${l.itemName} ${l.qty}${l.unitLabel ?? ''}` : l.itemName))
    .join('\n')
}
