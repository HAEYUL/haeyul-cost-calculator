import { countMarks, daysInMonth } from './staffSchedule'
import { WEEKDAY_LABELS } from './staffDaily'

// 직원 포지션·고용 형태와, 포지션별로 묶은 월 근무 현황표 계산.
export const POSITION_PRESETS = ['홀', '주방']
export const NO_POSITION = '미지정'
export const POSITION_ICONS = { 홀: '🍽', 주방: '🔥' }
export const EMPLOYMENT_TYPES = [
  { key: 'regular', label: '정직원' },
  { key: 'part', label: '아르바이트' },
]
export const employmentLabel = (key) => EMPLOYMENT_TYPES.find((e) => e.key === key)?.label ?? ''

// 파출 근무의 포지션 키(hall/kitchen) → 직원 포지션 이름
const DISPATCH_POSITION = { hall: '홀', kitchen: '주방' }
export const dispatchPositionName = (key) => DISPATCH_POSITION[key] ?? null

export const positionOf = (member) => member?.position?.trim() || NO_POSITION

// 포지션 순서: 홀 → 주방 → 그 밖의 이름(가나다) → 미지정
export function comparePositions(a, b) {
  const rank = (p) => (p === NO_POSITION ? 3 : POSITION_PRESETS.includes(p) ? POSITION_PRESETS.indexOf(p) : 2)
  return rank(a) - rank(b) || a.localeCompare(b)
}

// members(명부 순서 그대로) → [{ position, members }]
export function groupByPosition(members) {
  const groups = new Map()
  for (const m of members) {
    const p = positionOf(m)
    if (!groups.has(p)) groups.set(p, [])
    groups.get(p).push(m)
  }
  return [...groups.entries()].sort((a, b) => comparePositions(a[0], b[0])).map(([position, list]) => ({ position, members: list }))
}

const isWorking = (mark) => mark === 'O' || mark === '△'

// 월 근무 현황표 모델(화면 표·엑셀·인쇄가 같이 쓴다).
// rows: 그 달 staff_schedules 행(employee_name, days), members: 명부(name, position, sort_order),
// shifts: 그 달 파출 근무(work_date, position), savedDates: [저장]한 날 Set, today: 'YYYY-MM-DD'(이후 날짜는 미기록으로 치지 않음)
export function buildMonthModel({ year, month, rows, members = [], shifts = [], savedDates = new Set(), today = null }) {
  const n = daysInMonth(year, month)
  const pad = (v) => String(v).padStart(2, '0')
  const memberByName = new Map(members.map((m, i) => [m.name, { ...m, order: i }]))

  const tableRows = rows.map((r) => {
    const m = memberByName.get(r.employee_name)
    return {
      name: r.employee_name,
      position: positionOf(m),
      employmentType: m?.employment_type ?? null,
      order: m ? m.order : 9999,
      days: r.days ?? {},
      counts: countMarks(r.days),
      source: r,
    }
  })

  const byPosition = new Map()
  for (const r of tableRows) {
    if (!byPosition.has(r.position)) byPosition.set(r.position, [])
    byPosition.get(r.position).push(r)
  }
  const groups = [...byPosition.entries()]
    .sort((a, b) => comparePositions(a[0], b[0]))
    .map(([position, list]) => {
      list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
      const subtotal = list.reduce(
        (s, r) => ({
          full: s.full + r.counts.full,
          half: s.half + r.counts.half,
          leave: s.leave + r.counts.leave,
          off: s.off + r.counts.off,
          total: s.total + r.counts.total,
        }),
        { full: 0, half: 0, leave: 0, off: 0, total: 0 },
      )
      return { position, rows: list, subtotal }
    })

  const days = Array.from({ length: n }, (_, i) => {
    const d = i + 1
    const dateStr = `${year}-${pad(month)}-${pad(d)}`
    const wd = new Date(year, month - 1, d).getDay()
    const anyMark = tableRows.some((r) => r.days[String(d)])
    const future = today != null && dateStr > today
    return { day: d, dateStr, weekday: WEEKDAY_LABELS[wd], weekend: wd === 0 || wd === 6, unrecorded: !future && !savedDates.has(dateStr) && !anyMark }
  })

  // 일별 인원: 포지션별 근무 직원(종일·반타임) + 같은 포지션 파출. 파출 포지션이 없으면 "파출(포지션 없음)"으로만 센다.
  const positions = groups.map((g) => g.position)
  for (const s of shifts) {
    const p = dispatchPositionName(s.position)
    if (p && !positions.includes(p)) positions.push(p)
  }
  positions.sort(comparePositions)
  const headcount = positions.map((position) => ({
    position,
    perDay: days.map(({ day, dateStr }) => {
      const staff = tableRows.filter((r) => r.position === position && isWorking(r.days[String(day)])).length
      const dispatch = shifts.filter((s) => s.work_date === dateStr && dispatchPositionName(s.position) === position).length
      return { staff, dispatch, total: staff + dispatch }
    }),
  }))
  const dispatchPerDay = days.map(({ dateStr }) => shifts.filter((s) => s.work_date === dateStr).length)

  return { year, month, days, groups, headcount, dispatchPerDay }
}
