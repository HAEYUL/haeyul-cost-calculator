import { describe, it, expect } from 'vitest'
import { unusualQuantity } from './quantityCheck'

describe('unusualQuantity', () => {
  it('평소의 3배 이상이면 알려준다', () => {
    expect(unusualQuantity([60, 60, 60], 600)).toEqual({ usual: 60, factor: 10 })
    expect(unusualQuantity([10, 10, 10], 30).factor).toBe(3)
  })
  it('평소 범위면 null', () => {
    expect(unusualQuantity([10, 10, 10], 25)).toBeNull()
    expect(unusualQuantity([10, 10, 10], 2)).toBeNull()
  })
  it('기록이 3번 미만이거나 수량이 비어 있으면 판단하지 않는다', () => {
    expect(unusualQuantity([10, 10], 100)).toBeNull()
    expect(unusualQuantity([10, 10, 10], '')).toBeNull()
    expect(unusualQuantity([null, 0, 10, 10], 100)).toBeNull()
  })
})
