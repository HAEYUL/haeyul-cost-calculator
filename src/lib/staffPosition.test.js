import { describe, it, expect } from 'vitest'
import { groupByPosition, buildMonthModel, positionOf, comparePositions, NO_POSITION } from './staffPosition'

describe('포지션', () => {
  it('정렬: 홀 → 주방 → 기타 → 미지정', () => {
    expect(['미지정', '카운터', '주방', '홀'].sort(comparePositions)).toEqual(['홀', '주방', '카운터', '미지정'])
    expect(positionOf({ position: '  ' })).toBe(NO_POSITION)
  })
  it('groupByPosition은 명부 순서를 유지한다', () => {
    const g = groupByPosition([
      { name: 'A', position: '주방' },
      { name: 'B', position: '홀' },
      { name: 'C' },
      { name: 'D', position: '홀' },
    ])
    expect(g.map((x) => `${x.position}:${x.members.map((m) => m.name).join('')}`)).toEqual(['홀:BD', '주방:A', '미지정:C'])
  })
})

describe('buildMonthModel', () => {
  const members = [
    { name: '김홀', position: '홀', sort_order: 1 },
    { name: '박주방', position: '주방', sort_order: 2 },
    { name: '이홀', position: '홀', sort_order: 3 },
  ]
  const rows = [
    { employee_name: '이홀', days: { 1: '△', 2: 'X' } },
    { employee_name: '박주방', days: { 1: 'O', 2: '연' } },
    { employee_name: '김홀', days: { 1: 'O', 2: 'O' } },
    { employee_name: '옛이름', days: { 1: 'O' } },
  ]
  const shifts = [
    { work_date: '2026-11-01', position: 'hall' },
    { work_date: '2026-11-02', position: 'kitchen' },
    { work_date: '2026-11-02', position: null },
  ]
  const m = buildMonthModel({ year: 2026, month: 11, rows, members, shifts, savedDates: new Set(['2026-11-03']) })

  it('포지션별로 묶고 명부 순서, 소계', () => {
    expect(m.groups.map((g) => `${g.position}:${g.rows.map((r) => r.name).join(',')}`)).toEqual(['홀:김홀,이홀', '주방:박주방', '미지정:옛이름'])
    expect(m.groups[0].subtotal).toEqual({ full: 2, half: 1, leave: 0, off: 1, total: 3 })
  })
  it('일별 인원 = 근무 직원(종일·반타임) + 같은 포지션 파출', () => {
    const hall = m.headcount.find((h) => h.position === '홀')
    const kitchen = m.headcount.find((h) => h.position === '주방')
    expect(hall.perDay[0]).toEqual({ staff: 2, dispatch: 1, total: 3 })
    expect(hall.perDay[1]).toEqual({ staff: 1, dispatch: 0, total: 1 })
    expect(kitchen.perDay[1]).toEqual({ staff: 0, dispatch: 1, total: 1 })
    expect(m.dispatchPerDay.slice(0, 3)).toEqual([1, 2, 0])
  })
  it('요일·주말·미기록 표시', () => {
    expect(m.days[0]).toMatchObject({ weekday: '일', weekend: true, unrecorded: false })
    expect(m.days[2]).toMatchObject({ weekday: '화', unrecorded: false }) // 저장한 날
    expect(m.days[3].unrecorded).toBe(true)
  })
  it('오늘 이후 날짜는 미기록으로 치지 않는다', () => {
    const t = buildMonthModel({ year: 2026, month: 11, rows: [], today: '2026-11-09' })
    expect(t.days[8].unrecorded).toBe(true)
    expect(t.days[9].unrecorded).toBe(false)
  })
})
