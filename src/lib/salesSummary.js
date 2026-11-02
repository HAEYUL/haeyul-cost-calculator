// 통합 매출·결산 합산 계산 (매장운영결산·일매출 공통)

export const SETTLEMENT_FIELDS = [
  ['revenue', '총매출'],
  ['ingredient_cost', '식재료비'],
  ['labor_cost', '인건비'],
  ['general_cost', '일반경비'],
  ['total_expense', '지출합계'],
  ['operating_profit', '영업손익'],
  ['pretax_profit', '세전이익'],
]

export const SALES_FIELDS = [
  ['total_amount', '총매출'],
  ['card_amount', '카드'],
  ['cash_amount', '현금'],
  ['other_amount', '기타'],
  ['guest_count', '객수'],
]

const pad2 = (n) => String(n).padStart(2, '0')
export const monthKeyOf = (year, month) => `${year}-${pad2(month)}`

// 'YYYY-MM' 두 개 사이의 모든 달 (포함)
export function monthsBetween(from, to) {
  if (!from || !to || from > to) return []
  const out = []
  let [y, m] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  while (y < ty || (y === ty && m <= tm)) {
    out.push(monthKeyOf(y, m))
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
  }
  return out
}

// 기간 [from, to] 안의 칸 이름들: 월별이면 'YYYY-MM', 년별이면 'YYYY'
export function periodKeys(from, to, group) {
  const months = monthsBetween(from, to)
  if (group === 'year') return [...new Set(months.map((k) => k.slice(0, 4)))]
  return months
}

export const periodLabel = (key) => (key.length === 4 ? `${key}년` : `${key.slice(0, 4)}년 ${Number(key.slice(5))}월`)
export const shortPeriodLabel = (key) => (key.length === 4 ? `${key}년` : `${Number(key.slice(5))}월`)

const emptyTotals = (fields) => Object.fromEntries(fields.map(([k]) => [k, 0]))

// rows: [{ store_code, key('YYYY-MM' 또는 'YYYY-MM-DD'), ...금액 }]
// → { periods, byStore: Map(store → { totals, byPeriod: Map(period → totals) }), grand: { totals, byPeriod } }
export function aggregate(rows, { from, to, group, fields, storeCodes }) {
  const periods = periodKeys(from, to, group)
  const periodSet = new Set(periods)
  const make = () => ({ totals: emptyTotals(fields), byPeriod: new Map(periods.map((p) => [p, emptyTotals(fields)])), count: 0 })
  const byStore = new Map(storeCodes.map((c) => [c, make()]))
  const grand = make()
  for (const row of rows) {
    const month = row.key.slice(0, 7)
    const period = group === 'year' ? month.slice(0, 4) : month
    if (!periodSet.has(period) || month < from || month > to) continue
    const store = byStore.get(row.store_code)
    if (!store) continue
    for (const target of [store, grand]) {
      target.count += 1
      for (const [k] of fields) {
        const v = Number(row[k] || 0)
        target.totals[k] += v
        target.byPeriod.get(period)[k] += v
      }
    }
  }
  return { periods, byStore, grand }
}

// 결산이 입력되지 않은 달: [{ storeCode, month }]
export function missingSettlementMonths(rows, { from, to, storeCodes }) {
  const have = new Set(rows.map((r) => `${r.store_code}|${r.key.slice(0, 7)}`))
  const out = []
  for (const code of storeCodes) {
    for (const m of monthsBetween(from, to)) if (!have.has(`${code}|${m}`)) out.push({ storeCode: code, month: m })
  }
  return out
}

// 금액을 짧게: 123,456,789 → '1억 2,346만'
export function shortWon(n) {
  const v = Math.round(Number(n) || 0)
  const sign = v < 0 ? '-' : ''
  const abs = Math.abs(v)
  if (abs >= 100000000) {
    const eok = Math.floor(abs / 100000000)
    const man = Math.round((abs % 100000000) / 10000)
    return `${sign}${eok}억${man ? ` ${man.toLocaleString('ko-KR')}만` : ''}`
  }
  if (abs >= 10000) return `${sign}${Math.round(abs / 10000).toLocaleString('ko-KR')}만`
  return `${sign}${abs.toLocaleString('ko-KR')}`
}

// 매장별 합계 표의 비율(%): 총매출은 전체 매출에서 차지하는 비중, 나머지는 그 행 총매출 대비.
// 매출이 0이면 계산할 수 없어 null.
export function settlementPercent(field, totals, grandRevenue) {
  const base = field === 'revenue' ? grandRevenue : totals.revenue
  if (!base) return null
  return (Number(totals[field] || 0) / base) * 100
}

export const formatPercent = (p) => (p == null ? '-' : `${p.toFixed(1)}%`)

// 같은 매장·날짜의 구분(POS)별 줄을 하나로 합친다: Map('store|date' → { 합계값들, channels: Map(code → row) })
export function combineByStoreDate(rows) {
  const map = new Map()
  for (const r of rows) {
    const key = `${r.store_code}|${r.sale_date}`
    if (!map.has(key)) {
      map.set(key, { store_code: r.store_code, sale_date: r.sale_date, total_amount: 0, card_amount: 0, cash_amount: 0, other_amount: 0, guest_count: 0, channels: new Map() })
    }
    const c = map.get(key)
    for (const k of ['total_amount', 'card_amount', 'cash_amount', 'other_amount', 'guest_count']) c[k] += Number(r[k] || 0)
    c.channels.set(r.channel ?? 'main', r)
  }
  return map
}
