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

import { combineByStoreDate } from './salesSummary'
import { channelLabel, channelsFor, hasChannels } from '../data/salesChannels'

describe('매출 구분(POS)', () => {
  it('해율만두전골은 1층 매장 / 2,3층 매장, 다른 매장은 하나', () => {
    expect(channelsFor('haeyul').map((c) => c.label)).toEqual(['1층 매장', '2,3층 매장'])
    expect(hasChannels('gondre')).toBe(false)
    expect(channelsFor('gondre').map((c) => c.code)).toEqual(['main'])
    expect(channelLabel('haeyul', '23f')).toBe('2,3층 매장')
  })
  it('같은 날 두 POS를 합친다 (매출·객수 모두)', () => {
    const m = combineByStoreDate([
      { store_code: 'haeyul', sale_date: '2026-11-02', channel: '1f', total_amount: 820000, card_amount: 760000, guest_count: 64 },
      { store_code: 'haeyul', sale_date: '2026-11-02', channel: '23f', total_amount: 2350000, card_amount: 2180000, guest_count: 118 },
      { store_code: 'gondre', sale_date: '2026-11-02', channel: 'main', total_amount: 1350000, guest_count: 96 },
    ])
    const h = m.get('haeyul|2026-11-02')
    expect(h.total_amount).toBe(3170000)
    expect(h.guest_count).toBe(182)
    expect(h.channels.get('1f').total_amount).toBe(820000)
    expect(m.get('gondre|2026-11-02').total_amount).toBe(1350000)
  })
})

import { nextReportDeadline, eyebrowDate } from './storeSummary'

describe('메인 화면 날짜 표시', () => {
  it('신고 기한: 15일 전이면 이번 달, 지나면 다음 달', () => {
    expect(nextReportDeadline('2026-11-02')).toBe('11월 15일까지')
    expect(nextReportDeadline('2026-11-20')).toBe('12월 15일까지')
    expect(nextReportDeadline('2026-12-20')).toBe('1월 15일까지')
  })
  it('영문 날짜', () => {
    expect(eyebrowDate(new Date(2026, 10, 2))).toBe('TODAY · 2026.11.02 MON')
  })
})
