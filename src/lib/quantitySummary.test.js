import { describe, it, expect } from 'vitest'
import { summarizeReceipts, formatQtyByUnit } from './quantitySummary'

describe('summarizeReceipts', () => {
  it('수량·금액·횟수를 더한다', () => {
    const s = summarizeReceipts([
      { quantity: 60, unit: 'kg', amount: 150000 },
      { quantity: 60, unit: 'kg', amount: 150000 },
      { quantity: 1.5, unit: 'kg', amount: null },
    ])
    expect(s.count).toBe(3)
    expect(formatQtyByUnit(s.qtyByUnit)).toBe('121.5kg')
    expect(s.amount).toBe(300000)
  })
  it('단위가 섞이면 단위별로 표시', () => {
    const s = summarizeReceipts([
      { quantity: 10, unit: 'kg' },
      { quantity: 2, unit: 'box' },
      { quantity: null, unit: 'kg' },
    ])
    expect(formatQtyByUnit(s.qtyByUnit)).toBe('10kg + 2박스')
    expect(s.amount).toBeNull()
  })
  it('기록이 없으면 -', () => {
    expect(formatQtyByUnit(summarizeReceipts([]).qtyByUnit)).toBe('-')
  })
})
