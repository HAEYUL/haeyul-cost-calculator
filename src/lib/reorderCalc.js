const DAY_MS = 24 * 60 * 60 * 1000

function daysBetween(a, b) {
  return (b.getTime() - a.getTime()) / DAY_MS
}

// 품목별 입고일 이력으로 "평소 며칠마다 주문했는지"를 계산하고, 마지막 입고 이후 그 주기를
// 넘겼으면 재주문할 때가 됐다고 본다. 사용량 기록(stock_usage)은 매장마다 꾸준히 입력하지
// 않을 수 있어서, 입고 입력 때 항상 남는 invoice_date만으로 계산한다.
// 같은 품목의 입고일이 3번 미만이면(주기를 믿을 수 없어) 계산하지 않는다.
export function computeReorderAlerts(invoiceRows, { now = new Date() } = {}) {
  const datesByItem = new Map()
  for (const row of invoiceRows) {
    if (!row.invoice_date) continue
    const key = `${row.item_name}||${row.unit ?? ''}`
    if (!datesByItem.has(key)) {
      datesByItem.set(key, { itemName: row.item_name, unit: row.unit ?? null, dates: new Set() })
    }
    datesByItem.get(key).dates.add(row.invoice_date)
  }

  const alerts = []
  for (const { itemName, unit, dates } of datesByItem.values()) {
    const sorted = [...dates].sort()
    if (sorted.length < 3) continue

    const first = new Date(sorted[0])
    const last = new Date(sorted[sorted.length - 1])
    const avgIntervalDays = daysBetween(first, last) / (sorted.length - 1)
    if (!(avgIntervalDays > 0)) continue

    const daysSinceLast = daysBetween(last, now)
    const ratio = daysSinceLast / avgIntervalDays
    if (ratio >= 1) {
      alerts.push({ itemName, unit, avgIntervalDays, daysSinceLast, status: 'overdue', ratio })
    } else if (ratio >= 0.8) {
      alerts.push({ itemName, unit, avgIntervalDays, daysSinceLast, status: 'dueSoon', ratio })
    }
  }

  alerts.sort((a, b) => b.ratio - a.ratio)
  return alerts
}
