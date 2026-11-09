import { describe, it, expect } from 'vitest'
import { buildXlsx, colName } from './xlsxWriter'
import { buildStaffMonthSheets } from './staffExport'
import { buildMonthModel } from './staffPosition'

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
  it('포지션별 묶음·소계·전체 합계·일별 인원, 파출 시트', () => {
    const model = buildMonthModel({
      year: 2026,
      month: 11,
      rows: [
        { employee_name: '이영희', days: { 1: '△', 2: '연' } },
        { employee_name: '김철수', days: { 1: 'O', 2: 'X' } },
      ],
      members: [
        { name: '김철수', position: '주방', employment_type: 'regular' },
        { name: '이영희', position: '홀', employment_type: 'part' },
      ],
      shifts: [{ work_date: '2026-11-01', position: 'hall' }],
    })
    const [staff, dispatch] = buildStaffMonthSheets({
      storeName: '해율만두전골',
      model,
      shifts: [
        { work_date: '2026-11-02', worker_id: 'w1', wage: 80000, position: 'hall', start_time: '10:00:00', end_time: '15:00:00', paid_date: null },
        { work_date: '2026-11-01', worker_id: 'w1', wage: 80000, position: 'kitchen', paid_date: '2026-11-05' },
      ],
      workers: [{ id: 'w1', name: '정파출' }],
    })
    const r = staff.rows
    expect(r[3].slice(0, 3)).toEqual(['직원명', '고용', 1])
    expect(r[3].length).toBe(2 + 30 + 5)
    expect(r[4][2]).toBe('일')
    expect(r[5][0]).toBe('[홀] 1명')
    expect(r[6].slice(0, 4)).toEqual(['이영희', '아르바이트', '△', '연'])
    expect(r[7][0]).toBe('[주방] 1명')
    expect(r[8].slice(0, 4)).toEqual(['김철수', '정직원', 'O', 'X'])
    expect(r[9][0]).toBe('전체 합계')
    expect(r[9].slice(-5)).toEqual([1, 1, 1, 1, 2])
    const hallCount = r.find((row) => row[0] === '홀')
    expect(hallCount[2]).toBe(2) // 1일: 이영희 반타임 + 홀 파출 1
    expect(dispatch.rows[3][2]).toBe('주방')
    expect(dispatch.rows[5]).toEqual(['합계', '2건', '', '', '', 160000, ''])
    expect(dispatch.rows[8]).toEqual(['정파출', 2, 160000])
  })
})
