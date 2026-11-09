// 직원근무표 [오늘 근무 체크] 계산.
// - 근무표(staff_schedules)는 직원·연월마다 days = {"1":"O", "2":"△", ...} 한 행이다.
// - 매니저가 그날 [저장]을 누르면(staff_day_logs) 고른 사람은 O(종일)/△(반타임)/연(연차),
//   고르지 않은 재직 직원은 X(휴무)로 확정한다. 저장하지 않은 날은 "미기록"이다.
// - 아직 저장 안 한 날을 처음 열면: 사진으로 올려 둔 표시가 있으면 그걸, 없으면 평소 쉬는 요일이 아닌
//   직원을 "종일"로 미리 골라 둔다(매니저는 다른 사람만 고치면 된다).

export const DAILY_CHOICES = [
  { mark: 'O', label: '종일' },
  { mark: '△', label: '반타임' },
  { mark: '연', label: '연차' },
]

export const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']

function pad2(n) {
  return String(n).padStart(2, '0')
}

export function parseDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return { year: y, month: m, day: d }
}

export function weekdayOf(dateStr) {
  const { year, month, day } = parseDate(dateStr)
  return new Date(year, month - 1, day).getDay()
}

export function shiftDate(dateStr, delta) {
  const { year, month, day } = parseDate(dateStr)
  const d = new Date(year, month - 1, day + delta)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function dateLabel(dateStr) {
  const { month, day } = parseDate(dateStr)
  return `${month}월 ${day}일 (${WEEKDAY_LABELS[weekdayOf(dateStr)]})`
}

export function monthRangeOf(dateStr) {
  const { year, month } = parseDate(dateStr)
  const last = new Date(year, month, 0).getDate()
  return { start: `${year}-${pad2(month)}-01`, end: `${year}-${pad2(month)}-${pad2(last)}` }
}

// 그날 화면에 처음 보여줄 선택: Map(직원명 → 'O' | '△' | '연' | null)
export function initialSelections({ members, monthRows, dateStr, saved }) {
  const { day } = parseDate(dateStr)
  const wd = weekdayOf(dateStr)
  const markByName = new Map(monthRows.map((r) => [r.employee_name, r.days?.[String(day)] ?? null]))
  const anyMarked = members.some((m) => markByName.get(m.name))
  const sel = new Map()
  for (const m of members) {
    const mark = markByName.get(m.name) ?? null
    if (saved || anyMarked) {
      sel.set(m.name, mark === 'X' ? null : mark)
    } else {
      sel.set(m.name, (m.off_weekdays ?? []).includes(wd) ? null : 'O')
    }
  }
  return sel
}

// 저장할 근무표 행들(upsert용). 고르지 않은 재직 직원은 X(휴무).
// monthRows에 있는 다른 날짜 표시는 그대로 두고 그날 칸만 바꾼다.
export function buildDayUpsert({ storeCode, members, monthRows, dateStr, selections }) {
  const { year, month, day } = parseDate(dateStr)
  const rowByName = new Map(monthRows.map((r) => [r.employee_name, r]))
  return members.map((m) => {
    const prev = rowByName.get(m.name)
    return {
      store_code: storeCode,
      employee_name: m.name,
      year,
      month,
      days: { ...(prev?.days ?? {}), [String(day)]: selections.get(m.name) ?? 'X' },
    }
  })
}

export function countSelections(members, selections) {
  const c = { O: 0, '△': 0, 연: 0, X: 0 }
  for (const m of members) c[selections.get(m.name) ?? 'X'] += 1
  return c
}

// 매니저가 고칠 수 있는 날: 이번 달 1일 ~ 오늘(마감한 달 제외). 관리자는 오늘까지 어느 날이든.
export function canEditDate({ dateStr, today, isAdmin, closed }) {
  if (dateStr > today) return false
  if (isAdmin) return true
  if (closed) return false
  return dateStr.slice(0, 7) === today.slice(0, 7)
}
