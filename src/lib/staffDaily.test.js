import { describe, it, expect } from 'vitest'
import { initialSelections, buildDayUpsert, countSelections, canEditDate, weekdayOf, shiftDate, dateLabel } from './staffDaily'
import { countMarks, cycleMark } from './staffSchedule'

const members = [
  { name: '김철수', off_weekdays: [1] }, // 월요일 휴무
  { name: '이영희', off_weekdays: [] },
  { name: '박민수', off_weekdays: [0, 6] },
]

describe('날짜', () => {
  it('요일·이동·표시', () => {
    expect(weekdayOf('2026-11-09')).toBe(1) // 월
    expect(shiftDate('2026-11-30', 1)).toBe('2026-12-01')
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28')
    expect(dateLabel('2026-11-09')).toBe('11월 9일 (월)')
  })
})

describe('initialSelections', () => {
  it('저장 안 한 날 + 표시 없음 → 평소 쉬는 요일이 아닌 직원을 종일로', () => {
    const sel = initialSelections({ members, monthRows: [], dateStr: '2026-11-09', saved: false }) // 월요일
    expect(sel.get('김철수')).toBeNull()
    expect(sel.get('이영희')).toBe('O')
    expect(sel.get('박민수')).toBe('O')
  })
  it('저장한 날 → 저장된 표시 그대로, 휴무(X)는 선택 없음', () => {
    const monthRows = [
      { employee_name: '김철수', days: { 9: '연' } },
      { employee_name: '이영희', days: { 9: '△' } },
      { employee_name: '박민수', days: { 9: 'X' } },
    ]
    const sel = initialSelections({ members, monthRows, dateStr: '2026-11-09', saved: true })
    expect([...sel.values()]).toEqual(['연', '△', null])
  })
  it('저장 안 했어도 사진으로 올린 표시가 있으면 그걸 쓴다', () => {
    const monthRows = [{ employee_name: '이영희', days: { 9: '△' } }]
    const sel = initialSelections({ members, monthRows, dateStr: '2026-11-09', saved: false })
    expect(sel.get('이영희')).toBe('△')
    expect(sel.get('박민수')).toBeNull()
  })
})

describe('buildDayUpsert', () => {
  it('고르지 않은 사람은 X, 다른 날 표시는 유지', () => {
    const monthRows = [{ employee_name: '김철수', days: { 1: 'O', 9: 'O' } }]
    const selections = new Map([['김철수', null], ['이영희', '연'], ['박민수', 'O']])
    const rows = buildDayUpsert({ storeCode: 'haeyul', members, monthRows, dateStr: '2026-11-09', selections })
    expect(rows).toEqual([
      { store_code: 'haeyul', employee_name: '김철수', year: 2026, month: 11, days: { 1: 'O', 9: 'X' } },
      { store_code: 'haeyul', employee_name: '이영희', year: 2026, month: 11, days: { 9: '연' } },
      { store_code: 'haeyul', employee_name: '박민수', year: 2026, month: 11, days: { 9: 'O' } },
    ])
    expect(countSelections(members, selections)).toEqual({ O: 1, '△': 0, 연: 1, X: 1 })
  })
})

describe('canEditDate', () => {
  const today = '2026-11-09'
  it('매니저: 이번 달 오늘까지, 마감 달 불가', () => {
    expect(canEditDate({ dateStr: '2026-11-01', today, isAdmin: false, closed: false })).toBe(true)
    expect(canEditDate({ dateStr: '2026-11-10', today, isAdmin: false, closed: false })).toBe(false)
    expect(canEditDate({ dateStr: '2026-10-31', today, isAdmin: false, closed: false })).toBe(false)
    expect(canEditDate({ dateStr: '2026-11-05', today, isAdmin: false, closed: true })).toBe(false)
  })
  it('관리자: 오늘까지 어느 날이든', () => {
    expect(canEditDate({ dateStr: '2026-10-31', today, isAdmin: true, closed: true })).toBe(true)
    expect(canEditDate({ dateStr: '2026-11-10', today, isAdmin: true, closed: false })).toBe(false)
  })
})

describe('연차 표시', () => {
  it('cycleMark에 연차 포함, countMarks는 연차를 따로 센다', () => {
    expect(cycleMark('△')).toBe('연')
    expect(cycleMark('연')).toBe('X')
    expect(countMarks({ 1: 'O', 2: '△', 3: '연', 4: 'X' })).toEqual({ full: 1, half: 1, leave: 1, off: 1, total: 2 })
  })
})

import { mergeScheduleDays, unrecordedDates } from './staffDaily'

describe('mergeScheduleDays', () => {
  const existing = { 1: 'O', 2: 'O', 3: 'X' }
  const photo = { 2: '△', 3: 'X', 4: 'O' }
  it('기존 유지: 다른 날은 기존 표시, 새 날만 더한다', () => {
    const r = mergeScheduleDays(existing, photo, 'keep')
    expect(r.merged).toEqual({ 1: 'O', 2: 'O', 3: 'X', 4: 'O' })
    expect(r.conflicts).toEqual([{ day: 2, existing: 'O', photo: '△' }])
    expect(r.added).toBe(1)
  })
  it('사진 기준: 다른 날은 사진 표시로', () => {
    expect(mergeScheduleDays(existing, photo, 'photo').merged).toEqual({ 1: 'O', 2: '△', 3: 'X', 4: 'O' })
  })
  it('기존 기록이 없으면 사진 그대로', () => {
    expect(mergeScheduleDays(undefined, photo).merged).toEqual(photo)
  })
})

describe('unrecordedDates', () => {
  it('저장 안 했고 표시도 없는 날만', () => {
    const r = unrecordedDates({
      start: '2026-11-01',
      endExclusive: '2026-11-06',
      savedDates: new Set(['2026-11-01']),
      scheduleRows: [{ year: 2026, month: 11, days: { 2: 'O', 4: 'X' } }],
    })
    expect(r).toEqual(['2026-11-03', '2026-11-05'])
  })
})
