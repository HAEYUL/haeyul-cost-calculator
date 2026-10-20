import { describe, it, expect } from 'vitest'
import { findVatAmountFixes } from './vatAmountFix'

const item = (name, quantity, unitPrice, amount, vat) => ({
  name,
  quantity: String(quantity),
  unitPrice: String(unitPrice),
  amount: String(amount),
  vat: vat == null ? '' : String(vat),
})

describe('findVatAmountFixes', () => {
  it('금액에 공급가만 들어간 품목을 찾아 공급가+부가세로 고친다 (퀸스유통 10/14)', () => {
    const items = [
      item('간쌩강', 3, 11000, 33000, null),
      item('통깨', 2, 9500, 17273, 1727),
      item('다시다', 2, 32500, 59091, 5909),
      item('돈가스소스', 4, 3900, 14182, 1418),
      item('밀떡볶이떡', 2, 7500, 13636, 1364),
    ]
    const fixes = findVatAmountFixes(items, false)
    expect(fixes.map((f) => [f.index, f.to])).toEqual([
      [1, 19000],
      [2, 65000],
      [3, 15600],
      [4, 15000],
    ])
    expect(fixes.reduce((s, f) => s + f.to - f.from, 0)).toBe(10418)
  })

  it('이미 맞게 들어간 품목, 부가세 없는 품목, 설명 안 되는 차이는 건드리지 않는다', () => {
    const items = [item('통깨', 2, 9500, 19000, 1727), item('생강', 3, 11000, 33000, null), item('기타', 2, 9500, 15000, 1000)]
    expect(findVatAmountFixes(items, false)).toEqual([])
  })

  it('부가세 별도 거래처는 금액에 부가세가 이미 들어간 품목을 공급가로 되돌린다', () => {
    const fixes = findVatAmountFixes([item('멸치육수', 4, 172727.3, 760000, 69091)], true)
    expect(fixes).toHaveLength(1)
    expect(fixes[0].to).toBe(690909)
  })
})
