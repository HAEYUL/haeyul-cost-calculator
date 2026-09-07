import { describe, it, expect } from 'vitest'
import { weightConversionFactor } from './reidentifyItem'

// 이 파일은 실제로 있었던 버그(단위 변경 시 단가가 반대 배율로 계산됨)를 다시 잡아내기 위한
// 회귀 테스트다. costCalc.unitCostPerAmount는 kg 단위 단가를 1000으로 "나눠서" g당 단가로
// 쓰므로, kg->g 전환은 단가를 1000으로 "나눠야"(factor=1/1000) 같은 실제 가격이 유지된다.
describe('weightConversionFactor', () => {
  it('같은 단위면 1을 돌려준다', () => {
    expect(weightConversionFactor('kg', 'kg')).toBe(1)
    expect(weightConversionFactor(null, null)).toBe(1)
  })

  it('kg -> g 는 1/1000 (단가를 나눔) - 3000원/kg = 3원/g', () => {
    const factor = weightConversionFactor('kg', 'g')
    expect(factor).toBe(1 / 1000)
    expect(3000 * factor).toBe(3)
  })

  it('g -> kg 는 1000 (단가를 곱함) - 3원/g = 3000원/kg', () => {
    const factor = weightConversionFactor('g', 'kg')
    expect(factor).toBe(1000)
    expect(3 * factor).toBe(3000)
  })

  it('박스<->개처럼 자동으로 알 수 없는 단위쌍은 null을 돌려준다', () => {
    expect(weightConversionFactor('box', 'ea')).toBeNull()
    expect(weightConversionFactor('ea', 'box')).toBeNull()
    expect(weightConversionFactor('kg', 'box')).toBeNull()
  })
})
