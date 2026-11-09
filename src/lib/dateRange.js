function pad2(n) {
  return String(n).padStart(2, '0')
}

// offset=0이면 이번 달, -1이면 지난 달의 [시작일, 마지막일]
export function monthRange(offset = 0) {
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const y = first.getFullYear()
  const m = first.getMonth()
  const start = `${y}-${pad2(m + 1)}-01`
  const lastDay = new Date(y, m + 1, 0).getDate()
  const end = `${y}-${pad2(m + 1)}-${pad2(lastDay)}`
  return { start, end }
}

export function yearRange() {
  const y = new Date().getFullYear()
  return { start: `${y}-01-01`, end: `${y}-12-31` }
}

// 기간 리포트 화면들의 공통 프리셋(이번 달/지난 달/올해/전체 기간).
export const DATE_RANGE_PRESETS = [
  { key: 'thisMonth', label: '이번 달', range: () => monthRange(0) },
  { key: 'lastMonth', label: '지난 달', range: () => monthRange(-1) },
  { key: 'thisYear', label: '올해', range: () => yearRange() },
  { key: 'all', label: '전체 기간', range: () => ({ start: '', end: '' }) },
]

// 'YYYY-MM' → 그 달의 { start, end }
export function monthBoundsOf(ym) {
  const [y, m] = ym.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  return { start: `${ym}-01`, end: `${ym}-${pad2(lastDay)}` }
}

// 기록이 있는 달 목록('YYYY-MM'), 최근 달이 먼저. dateOf(row)는 'YYYY-MM-DD' 또는 빈 값.
export function monthsWithData(rows, dateOf = (r) => r.invoice_date) {
  const set = new Set()
  for (const r of rows) {
    const d = dateOf(r)
    if (d && /^\d{4}-\d{2}/.test(d)) set.add(d.slice(0, 7))
  }
  return [...set].sort().reverse()
}

// 월 버튼 이름: 올해는 "11월", 다른 해는 "25년 12월"
export function monthLabel(ym, now = new Date()) {
  const [y, m] = ym.split('-').map(Number)
  return y === now.getFullYear() ? `${m}월` : `${String(y).slice(2)}년 ${m}월`
}
