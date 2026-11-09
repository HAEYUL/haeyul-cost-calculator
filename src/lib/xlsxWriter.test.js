import { describe, it, expect } from 'vitest'
import { buildXlsx, colName } from './xlsxWriter'
import { buildStaffMonthSheets } from './staffExport'

describe('xlsxWriter', () => {
  it('열 이름', () => {
    expect([colName(0), colName(25), colName(26), colName(36)]).toEqual(['A', 'Z', 'AA', 'AK'])
  })
  it('zip(PK) 형식으로 만들어진다', () => {
    const bytes = buildXlsx([{ name: '근무표', rows: [['이름', 1], ['김<철>수', 2.5]] }])
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
    const text = new TextDecoder().decode(bytes)
    expect(text).toContain('xl/worksheets/sheet1.xml')
    expect(text).toContain('김&lt;철&gt;수')
  })
})

describe('buildStaffMonthSheets', () => {
  it('근무표·파출 시트와 합계', () => {
    const [staff, dispatch] = buildStaffMonthSheets({
      storeName: '해율만두전골',
      year: 2026,
      month: 11,
      rows: [
        { employee_name: '이영희', days: { 1: '△', 2: '연' } },
        { employee_name: '김철수', days: { 1: 'O', 2: 'X' } },
      ],
      order: ['김철수', '이영희'],
      shifts: [
        { work_date: '2026-11-02', worker_id: 'w1', wage: 80000, position: '홀', start_time: '10:00:00', end_time: '15:00:00', paid_date: null },
        { work_date: '2026-11-01', worker_id: 'w1', wage: 80000, paid_date: '2026-11-05' },
      ],
      workers: [{ id: 'w1', name: '정파출' }],
    })
    const head = staff.rows[3]
    expect(head[0]).toBe('직원명')
    expect(head.length).toBe(1 + 30 + 5)
    expect(staff.rows[4][1]).toBe('일') // 2026-11-01 일요일
    expect(staff.rows[5].slice(0, 3)).toEqual(['김철수', 'O', 'X'])
    expect(staff.rows[5].slice(-5)).toEqual([1, 0, 0, 1, 1])
    expect(staff.rows[6].slice(-5)).toEqual([0, 1, 1, 0, 1])
    expect(staff.rows[7].slice(-5)).toEqual([1, 1, 1, 1, 2])
    expect(dispatch.rows[3][0]).toBe('2026-11-01')
    expect(dispatch.rows[5]).toEqual(['합계', '2건', '', '', '', 160000, ''])
    expect(dispatch.rows[8]).toEqual(['정파출', 2, 160000])
  })
})
