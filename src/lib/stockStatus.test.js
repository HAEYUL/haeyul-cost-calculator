import { describe, expect, it } from 'vitest'
import { stockStatus } from './stockStatus'

describe('stockStatus', () => {
  it('마이너스 재고는 부족', () => {
    expect(stockStatus({ current: -2, received: 40, receiptCount: 4 })).toBe('short')
  })

  it('평소 한 번 입고량의 절반보다 적으면 적음', () => {
    // 한 번에 10씩 들어오는데 4 남음 → 절반(5)보다 적음
    expect(stockStatus({ current: 4, received: 40, receiptCount: 4 })).toBe('low')
    expect(stockStatus({ current: 0, received: 40, receiptCount: 4 })).toBe('low')
  })

  it('절반 이상 남으면 충분', () => {
    expect(stockStatus({ current: 5, received: 40, receiptCount: 4 })).toBe('ok')
  })

  it('입고 기록이 없으면 판단하지 않고 충분으로 둔다', () => {
    expect(stockStatus({ current: 0, received: 0, receiptCount: 0 })).toBe('ok')
  })
})
