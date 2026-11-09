import { describe, it, expect } from 'vitest'
import { monthBoundsOf, monthsWithData, monthLabel } from './dateRange'

describe('월별 기간', () => {
  it('monthBoundsOf: 그 달의 첫날~말일', () => {
    expect(monthBoundsOf('2026-11')).toEqual({ start: '2026-11-01', end: '2026-11-30' })
    expect(monthBoundsOf('2028-02')).toEqual({ start: '2028-02-01', end: '2028-02-29' })
  })
  it('monthsWithData: 기록이 있는 달만, 최근 달 먼저', () => {
    const rows = [{ invoice_date: '2026-10-03' }, { invoice_date: '2026-11-09' }, { invoice_date: '2026-10-20' }, { invoice_date: null }, { invoice_date: '2025-12-31' }]
    expect(monthsWithData(rows)).toEqual(['2026-11', '2026-10', '2025-12'])
  })
  it('monthLabel: 올해는 월만, 다른 해는 연도도', () => {
    const now = new Date(2026, 10, 9)
    expect(monthLabel('2026-11', now)).toBe('11월')
    expect(monthLabel('2025-12', now)).toBe('25년 12월')
  })
})
