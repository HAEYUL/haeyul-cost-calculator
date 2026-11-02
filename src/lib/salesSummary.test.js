import { describe, it, expect } from 'vitest'
import { aggregate, missingSettlementMonths, monthsBetween, periodKeys, SETTLEMENT_FIELDS, shortWon } from './salesSummary'

const rows = [
  { store_code: 'haeyul', key: '2025-12', revenue: 100, operating_profit: 10 },
  { store_code: 'haeyul', key: '2026-01', revenue: 200, operating_profit: 20 },
  { store_code: 'gondre', key: '2026-01', revenue: 50, operating_profit: -5 },
  { store_code: 'gondre', key: '2026-03', revenue: 70, operating_profit: 7 },
  { store_code: 'other', key: '2026-01', revenue: 999 },
]
const opts = { from: '2025-12', to: '2026-03', fields: SETTLEMENT_FIELDS, storeCodes: ['haeyul', 'gondre'] }

describe('기간', () => {
  it('달 목록(연도 넘어감)', () => {
    expect(monthsBetween('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
    expect(monthsBetween('2026-03', '2026-01')).toEqual([])
  })
  it('년별 칸', () => {
    expect(periodKeys('2025-11', '2026-02', 'year')).toEqual(['2025', '2026'])
  })
})

describe('합산', () => {
  it('월별: 매장·달별 합계와 전체 합계', () => {
    const r = aggregate(rows, { ...opts, group: 'month' })
    expect(r.periods).toEqual(['2025-12', '2026-01', '2026-02', '2026-03'])
    expect(r.byStore.get('haeyul').totals.revenue).toBe(300)
    expect(r.byStore.get('gondre').byPeriod.get('2026-01').operating_profit).toBe(-5)
    expect(r.grand.byPeriod.get('2026-01').revenue).toBe(250)
    expect(r.grand.totals.revenue).toBe(420) // 다른 매장(other)은 빼고
  })
  it('년별: 연도로 묶는다', () => {
    const r = aggregate(rows, { ...opts, group: 'year' })
    expect(r.periods).toEqual(['2025', '2026'])
    expect(r.grand.byPeriod.get('2025').revenue).toBe(100)
    expect(r.grand.byPeriod.get('2026').revenue).toBe(320)
  })
  it('기간 밖은 뺀다', () => {
    const r = aggregate(rows, { ...opts, from: '2026-01', to: '2026-01', group: 'month' })
    expect(r.grand.totals.revenue).toBe(250)
  })
  it('일매출(날짜 키)도 같은 방식', () => {
    const daily = [
      { store_code: 'haeyul', key: '2026-01-05', total_amount: 10 },
      { store_code: 'haeyul', key: '2026-01-06', total_amount: 15 },
    ]
    const r = aggregate(daily, { from: '2026-01', to: '2026-01', group: 'month', fields: [['total_amount', '총매출']], storeCodes: ['haeyul'] })
    expect(r.grand.totals.total_amount).toBe(25)
  })
  it('결산 미입력 달', () => {
    const miss = missingSettlementMonths(rows, { from: '2026-01', to: '2026-02', storeCodes: ['haeyul', 'gondre'] })
    expect(miss).toEqual([
      { storeCode: 'haeyul', month: '2026-02' },
      { storeCode: 'gondre', month: '2026-02' },
    ])
  })
})

describe('짧은 금액', () => {
  it('억·만 단위', () => {
    expect(shortWon(123456789)).toBe('1억 2,346만')
    expect(shortWon(52000000)).toBe('5,200만')
    expect(shortWon(-3000000)).toBe('-300만')
    expect(shortWon(5000)).toBe('5,000')
  })
})

import { formatPercent, settlementPercent } from './salesSummary'

describe('결산 비율', () => {
  const store = { revenue: 1000, ingredient_cost: 318, operating_profit: -50 }
  it('비용·손익은 그 매장 총매출 대비', () => {
    expect(formatPercent(settlementPercent('ingredient_cost', store, 4000))).toBe('31.8%')
    expect(formatPercent(settlementPercent('operating_profit', store, 4000))).toBe('-5.0%')
  })
  it('총매출은 전체 매출에서 차지하는 비중', () => {
    expect(formatPercent(settlementPercent('revenue', store, 4000))).toBe('25.0%')
    expect(formatPercent(settlementPercent('revenue', { revenue: 4000 }, 4000))).toBe('100.0%')
  })
  it('매출이 0이면 -', () => {
    expect(formatPercent(settlementPercent('ingredient_cost', { revenue: 0, ingredient_cost: 0 }, 0))).toBe('-')
  })
})
