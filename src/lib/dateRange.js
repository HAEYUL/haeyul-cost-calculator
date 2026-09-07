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
