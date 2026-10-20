import { rowDateStr } from './rowDateStr'

// 거래처 원장(외상 장부): 장부 시작일의 잔액(=전월 말 잔액)에서 출발해 그 뒤 입고는 더하고
// 직접 입력한 결제는 빼서 미지급금을 구한다. 명세표에 찍힌 전잔액·현잔액은 계산에 쓰지 않고,
// 장부가 맞는지 대조하는 데만 쓴다.
export const LEDGER_START = '2026-10-01'
export const LEDGER_START_MONTH = LEDGER_START.slice(0, 7)

function pad2(n) {
  return String(n).padStart(2, '0')
}

function toDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return toDateStr(new Date(y, m - 1, d + days))
}

export function todayStr() {
  return toDateStr(new Date())
}

export function currentMonth() {
  return todayStr().slice(0, 7)
}

// 'YYYY-MM' → 그 달의 첫날·마지막 날
export function monthBounds(ym) {
  const [y, m] = ym.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  return { start: `${ym}-01`, end: `${ym}-${pad2(lastDay)}` }
}

export function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}

export function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number)
  return `${y}년 ${m}월`
}

export const hasBalanceInfo = (batch) => batch.statement_balance != null || batch.current_balance != null

// 그날 입고를 반영한 뒤의 잔액. 현잔액이 적혀 있으면 그대로, 전잔액만 있으면 전잔액 + 당일 입고.
export const endingBalanceOf = (batch) =>
  batch.current_balance != null ? Number(batch.current_balance) : Number(batch.statement_balance) + Number(batch.total_amount)

// 그날 입고를 반영하기 전의 잔액. 전잔액이 없으면 현잔액에서 당일 입고를 거꾸로 뺀다.
export const priorBalanceOf = (batch) =>
  batch.statement_balance != null ? Number(batch.statement_balance) : Number(batch.current_balance) - Number(batch.total_amount)

// 입고일 → 생성 시각 순(오래된 것 먼저)
function compareBatches(a, b) {
  const ad = rowDateStr(a)
  const bd = rowDateStr(b)
  if (ad !== bd) return ad < bd ? -1 : 1
  return new Date(a.created_at) - new Date(b.created_at)
}

const sumAmount = (rows, key) => rows.reduce((sum, r) => sum + Number(r[key]), 0)

// 한 거래처의 명세표·결제·시작 잔액 기록으로 장부를 만든다.
// batches: { id, invoice_date, created_at, total_amount, statement_balance, current_balance }
// payments: { amount, paid_date }
// openings: vendor_opening_balances 행들(as_of_date가 LEDGER_START인 것만 장부 시작 잔액으로 쓴다)
export function makeLedger({ batches = [], payments = [], openings = [] }) {
  const openingRow = openings.find((o) => o.as_of_date === LEDGER_START) ?? null
  const opening = openingRow ? Number(openingRow.balance) : 0

  const ledgerBatches = batches.filter((b) => rowDateStr(b) >= LEDGER_START).sort(compareBatches)
  const ledgerPayments = payments.filter((p) => p.paid_date && p.paid_date >= LEDGER_START)
  // 결제일이 없는 기록은 어느 달 결제인지 몰라서 장부에서 뺀다 — 화면에서 날짜를 넣으라고 안내한다.
  const undatedPayments = payments.filter((p) => !p.paid_date)

  const invoicedBetween = (from, to) =>
    sumAmount(
      ledgerBatches.filter((b) => {
        const d = rowDateStr(b)
        return d >= from && (!to || d <= to)
      }),
      'total_amount',
    )
  const paidBetween = (from, to) =>
    sumAmount(
      ledgerPayments.filter((p) => p.paid_date >= from && (!to || p.paid_date <= to)),
      'amount',
    )

  // date일 끝(그날 입고·결제까지 반영) 기준 잔액. date가 없으면 지금까지 전부.
  const balanceThrough = (date) => {
    if (date && date < LEDGER_START) return opening
    return opening + invoicedBetween(LEDGER_START, date) - paidBetween(LEDGER_START, date)
  }

  // 기간 원장: 이월(기간 시작 전날 잔액) + 기간 입고 − 기간 결제 = 기간 말 잔액.
  // 장부 시작일보다 이른 날짜는 장부 시작일로 당겨서 계산한다.
  const period = (from, to) => {
    const start = !from || from < LEDGER_START ? LEDGER_START : from
    const carryOver = start === LEDGER_START ? opening : balanceThrough(addDays(start, -1))
    const invoiced = to && to < start ? 0 : invoicedBetween(start, to)
    const paid = to && to < start ? 0 : paidBetween(start, to)
    return { carryOver, invoiced, paid, ending: carryOver + invoiced - paid }
  }

  // 장부 시작 달부터 untilMonth까지 월별 원장
  const months = (untilMonth) => {
    const rows = []
    for (let ym = LEDGER_START_MONTH; ym <= untilMonth; ym = shiftMonth(ym, 1)) {
      const { start, end } = monthBounds(ym)
      rows.push({ month: ym, ...period(start, end) })
    }
    return rows
  }

  // 명세표 잔액 대조: 잔액이 찍힌 명세표마다 "그날 입고 전 잔액"을 장부와 비교한다. 결제 하나를
  // 빠뜨리면 그 뒤 명세표가 전부 같은 금액만큼 어긋나므로, 직전 명세표보다 차이가 "새로 생긴"
  // 지점만 문제로 알려준다 — 그러면 빠진 결제가 어느 두 명세표 사이에 있는지 바로 보인다.
  const reconcile = () => {
    const statements = ledgerBatches.filter(hasBalanceInfo)
    const issues = []
    let prevDiff = 0
    let prevDate = null
    for (const s of statements) {
      const sDate = rowDateStr(s)
      const before = ledgerBatches.filter((b) => b !== s && compareBatches(b, s) < 0)
      const ledgerPrior =
        opening + sumAmount(before, 'total_amount') - sumAmount(ledgerPayments.filter((p) => p.paid_date < sDate), 'amount')
      const statementPrior = priorBalanceOf(s)
      const diff = statementPrior - ledgerPrior
      const change = diff - prevDiff
      if (Math.abs(Math.round(change)) >= 1) {
        const fromDate = prevDate ?? LEDGER_START
        // 결제가 빠졌다면 결제일은 직전 명세표 날짜 ~ 이 명세표 전날 사이여야 이 명세표 잔액에 반영된다.
        const lastPaymentDate = addDays(sDate, -1)
        issues.push({
          batchId: s.id,
          statementDate: sDate,
          statementBalance: statementPrior,
          ledgerBalance: ledgerPrior,
          amount: change,
          fromDate,
          toDate: lastPaymentDate >= fromDate ? lastPaymentDate : fromDate,
          // 직전 명세표와 같은 날이거나 장부 시작일 당일 명세표면 결제가 끼어들 틈이 없다.
          canRegisterPayment: lastPaymentDate >= fromDate,
          isFirst: prevDate == null,
        })
      }
      prevDiff = diff
      prevDate = sDate
    }
    return issues
  }

  return {
    hasOpening: openingRow != null,
    opening,
    openingRow,
    undatedPayments,
    balanceThrough,
    current: balanceThrough(null),
    period,
    months,
    reconcile,
  }
}

// 장부 시작 잔액(=장부 시작 전날 잔액) 제안. 장부 시작 전 마지막 명세표 잔액이 있으면 거기서
// 그 뒤 입고·결제를 반영하고, 없으면 장부 시작 후 첫 명세표의 전잔액에서 그 앞 입고·결제를
// 거꾸로 되돌려 계산한다. 둘 다 없으면 null.
export function suggestOpening({ batches = [], payments = [] }) {
  const sorted = [...batches].sort(compareBatches)
  const datedPayments = payments.filter((p) => p.paid_date)

  const beforeStart = sorted.filter((b) => rowDateStr(b) < LEDGER_START)
  const lastBefore = [...beforeStart].reverse().find(hasBalanceInfo)
  if (lastBefore) {
    const d = rowDateStr(lastBefore)
    const laterBatches = beforeStart.filter((b) => compareBatches(b, lastBefore) > 0)
    const laterPayments = datedPayments.filter((p) => p.paid_date >= d && p.paid_date < LEDGER_START)
    return {
      amount: endingBalanceOf(lastBefore) + sumAmount(laterBatches, 'total_amount') - sumAmount(laterPayments, 'amount'),
      source: `${d} 명세표 잔액에서 계산`,
    }
  }

  const afterStart = sorted.filter((b) => rowDateStr(b) >= LEDGER_START)
  const firstAfter = afterStart.find(hasBalanceInfo)
  if (firstAfter) {
    const d = rowDateStr(firstAfter)
    const earlierBatches = afterStart.filter((b) => compareBatches(b, firstAfter) < 0)
    const earlierPayments = datedPayments.filter((p) => p.paid_date >= LEDGER_START && p.paid_date < d)
    return {
      amount: priorBalanceOf(firstAfter) - sumAmount(earlierBatches, 'total_amount') + sumAmount(earlierPayments, 'amount'),
      source: `${d} 명세표 전잔액에서 계산`,
    }
  }

  return null
}

// 거래처별로 묶기
export function groupByVendor(rows) {
  const map = new Map()
  for (const r of rows ?? []) {
    if (!r.vendor_id) continue
    if (!map.has(r.vendor_id)) map.set(r.vendor_id, [])
    map.get(r.vendor_id).push(r)
  }
  return map
}
