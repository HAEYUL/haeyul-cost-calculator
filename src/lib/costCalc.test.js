import { describe, it, expect } from 'vitest'
import {
  latestInvoiceInfoByItem,
  computeMenuCost,
  computeSubRecipeCost,
  computeAllSubRecipeUnitCosts,
} from './costCalc'

describe('latestInvoiceInfoByItem', () => {
  it('물품별로 가장 최근(created_at 기준) 단가만 남긴다', () => {
    const map = latestInvoiceInfoByItem([
      { item_name: '대파', unit_price: 3000, unit: 'kg', created_at: '2026-08-01T00:00:00Z' },
      { item_name: '대파', unit_price: 3500, unit: 'kg', created_at: '2026-09-01T00:00:00Z' },
    ])
    expect(map.get('대파')).toEqual({ unitPrice: 3500, unit: 'kg' })
  })

  it('unit_price가 없는 행은 무시한다', () => {
    const map = latestInvoiceInfoByItem([{ item_name: '대파', unit_price: null, unit: 'kg', created_at: '2026-09-01T00:00:00Z' }])
    expect(map.has('대파')).toBe(false)
  })

  it('vat_included_unit_price가 있으면(부가세 별도 거래처) unit_price 대신 그 값을 쓴다', () => {
    const map = latestInvoiceInfoByItem([
      {
        item_name: '디안멸치육수',
        unit_price: 172727.3,
        vat_included_unit_price: 190000.03,
        unit: 'box',
        created_at: '2026-08-03T00:00:00Z',
      },
    ])
    expect(map.get('디안멸치육수')).toEqual({ unitPrice: 190000.03, unit: 'box' })
  })

  it('vat_included_unit_price가 없으면(일반 거래처) unit_price를 그대로 쓴다', () => {
    const map = latestInvoiceInfoByItem([
      { item_name: '대파', unit_price: 3000, vat_included_unit_price: null, unit: 'kg', created_at: '2026-09-01T00:00:00Z' },
    ])
    expect(map.get('대파')).toEqual({ unitPrice: 3000, unit: 'kg' })
  })
})

describe('computeMenuCost - g/kg 단위', () => {
  const mappingByIngredient = new Map([['대파', '대파(국내산)']])

  it('kg 단위는 1000으로 나눠 g당 단가로 계산한다', () => {
    const infoByItem = new Map([['대파(국내산)', { unitPrice: 3000, unit: 'kg' }]])
    const { totalCost, breakdown } = computeMenuCost({
      recipeRows: [{ ingredient_name: '대파', amount_g: 200, is_sub_recipe: false }],
      mappingByIngredient,
      infoByItem,
    })
    // 3000원/kg = 3원/g, 200g 사용 -> 600원
    expect(totalCost).toBe(600)
    expect(breakdown[0].status).toBe('ok')
  })

  it('g 단위는 그대로(나누지 않고) 계산한다', () => {
    const infoByItem = new Map([['대파(국내산)', { unitPrice: 3, unit: 'g' }]])
    const { totalCost } = computeMenuCost({
      recipeRows: [{ ingredient_name: '대파', amount_g: 200, is_sub_recipe: false }],
      mappingByIngredient,
      infoByItem,
    })
    expect(totalCost).toBe(600)
  })
})

describe('computeMenuCost - 개/박스/기타 단위', () => {
  it('개수 단위는 재료량(개수)을 단가에 그대로 곱한다', () => {
    const mappingByIngredient = new Map([['유부주머니', '유부주머니(박스)']])
    const infoByItem = new Map([['유부주머니(박스)', { unitPrice: 5000, unit: 'ea' }]])
    const { totalCost } = computeMenuCost({
      recipeRows: [{ ingredient_name: '유부주머니', amount_g: 2, is_sub_recipe: false }],
      mappingByIngredient,
      infoByItem,
    })
    expect(totalCost).toBe(10000)
  })
})

describe('computeMenuCost - 상태 표시', () => {
  it('매칭 안 된 재료는 unmapped, 원가에서 제외된다', () => {
    const { totalCost, hasMissing, breakdown } = computeMenuCost({
      recipeRows: [{ ingredient_name: '모름', amount_g: 100, is_sub_recipe: false }],
      mappingByIngredient: new Map(),
      infoByItem: new Map(),
    })
    expect(totalCost).toBe(0)
    expect(hasMissing).toBe(true)
    expect(breakdown[0].status).toBe('unmapped')
  })

  it('단가 정보가 없으면 no_price', () => {
    const mappingByIngredient = new Map([['대파', '대파(국내산)']])
    const { breakdown } = computeMenuCost({
      recipeRows: [{ ingredient_name: '대파', amount_g: 100, is_sub_recipe: false }],
      mappingByIngredient,
      infoByItem: new Map(),
    })
    expect(breakdown[0].status).toBe('no_price')
  })

  it('재료량이 없으면 no_amount', () => {
    const mappingByIngredient = new Map([['대파', '대파(국내산)']])
    const infoByItem = new Map([['대파(국내산)', { unitPrice: 3000, unit: 'kg' }]])
    const { breakdown } = computeMenuCost({
      recipeRows: [{ ingredient_name: '대파', amount_g: null, is_sub_recipe: false }],
      mappingByIngredient,
      infoByItem,
    })
    expect(breakdown[0].status).toBe('no_amount')
  })

  it('매칭된 물품에 단위 정보가 없으면 unit_mismatch', () => {
    const mappingByIngredient = new Map([['대파', '대파(국내산)']])
    const infoByItem = new Map([['대파(국내산)', { unitPrice: 3000, unit: null }]])
    const { breakdown } = computeMenuCost({
      recipeRows: [{ ingredient_name: '대파', amount_g: 100, is_sub_recipe: false }],
      mappingByIngredient,
      infoByItem,
    })
    expect(breakdown[0].status).toBe('unit_mismatch')
  })
})

describe('computeMenuCost - 부재료 줄', () => {
  it('부재료는 subUnitCostByName의 1단위당 단가 × 사용량으로 계산한다', () => {
    const { totalCost, breakdown } = computeMenuCost({
      recipeRows: [{ ingredient_name: '굴림만두', amount_g: 5, is_sub_recipe: true }],
      mappingByIngredient: new Map(),
      infoByItem: new Map(),
      subUnitCostByName: new Map([['굴림만두', 300]]),
    })
    expect(totalCost).toBe(1500)
    expect(breakdown[0].status).toBe('ok')
  })

  it('부재료 원가가 없으면 sub_no_cost', () => {
    const { breakdown, hasMissing } = computeMenuCost({
      recipeRows: [{ ingredient_name: '굴림만두', amount_g: 5, is_sub_recipe: true }],
      mappingByIngredient: new Map(),
      infoByItem: new Map(),
      subUnitCostByName: new Map(),
    })
    expect(breakdown[0].status).toBe('sub_no_cost')
    expect(hasMissing).toBe(true)
  })
})

describe('computeMenuCost - 입고 단위와 다른 레시피 단위 환산 (item_recipe_units)', () => {
  it('1박스=120개처럼 등록해두면 (단가÷ratio)로 개당 원가를 계산한다', () => {
    // 모찌유부주머니: 1박스 90,000원, 1박스=120개 등록 -> 개당 750원
    const mappingByIngredient = new Map([['유부주머니', '모찌유부주머니']])
    const infoByItem = new Map([['모찌유부주머니', { unitPrice: 90000, unit: 'box' }]])
    const recipeUnitByItem = new Map([['모찌유부주머니', { recipeUnit: 'ea', ratio: 120 }]])
    const { totalCost, breakdown } = computeMenuCost({
      recipeRows: [{ ingredient_name: '유부주머니', amount_g: 1, is_sub_recipe: false }],
      mappingByIngredient,
      infoByItem,
      recipeUnitByItem,
    })
    expect(totalCost).toBe(750)
    expect(breakdown[0].unit).toBe('ea') // 화면 표시 단위도 레시피 단위로 바뀐다
  })

  it('환산이 등록 안 된 물품은 입고 단위 그대로 계산한다(기존 동작)', () => {
    const mappingByIngredient = new Map([['유부주머니', '모찌유부주머니']])
    const infoByItem = new Map([['모찌유부주머니', { unitPrice: 90000, unit: 'box' }]])
    const { totalCost } = computeMenuCost({
      recipeRows: [{ ingredient_name: '유부주머니', amount_g: 1, is_sub_recipe: false }],
      mappingByIngredient,
      infoByItem,
      recipeUnitByItem: new Map(),
    })
    expect(totalCost).toBe(90000)
  })
})

describe('computeSubRecipeCost', () => {
  it('총 재료비를 산출량으로 나눠 1단위당 단가를 낸다', () => {
    const mappingByIngredient = new Map([['돼지고기', '돼지고기(다짐육)']])
    const infoByItem = new Map([['돼지고기(다짐육)', { unitPrice: 10, unit: 'g' }]])
    const { totalCost, unitCost } = computeSubRecipeCost({
      recipeRows: [{ ingredient_name: '돼지고기', amount_g: 1000, is_sub_recipe: false }],
      mappingByIngredient,
      infoByItem,
      yieldQty: 25,
    })
    expect(totalCost).toBe(10000)
    expect(unitCost).toBe(400) // 10,000 / 25
  })

  it('산출량이 없으면 unitCost는 null', () => {
    const { unitCost } = computeSubRecipeCost({
      recipeRows: [],
      mappingByIngredient: new Map(),
      infoByItem: new Map(),
      yieldQty: null,
    })
    expect(unitCost).toBeNull()
  })
})

describe('computeAllSubRecipeUnitCosts', () => {
  it('여러 부재료의 1단위당 단가를 한 번에 계산해 맵으로 돌려준다', () => {
    const mappingByIngredient = new Map([['돼지고기', '돼지고기(다짐육)']])
    const infoByItem = new Map([['돼지고기(다짐육)', { unitPrice: 10, unit: 'g' }]])
    const subRecipeRowsByMenu = new Map([
      ['굴림만두', [{ ingredient_name: '돼지고기', amount_g: 1000, is_sub_recipe: false }]],
    ])
    const subRecipeMetaByMenu = new Map([['굴림만두', { yield_qty: 25 }]])
    const result = computeAllSubRecipeUnitCosts({
      subRecipeRowsByMenu,
      subRecipeMetaByMenu,
      mappingByIngredient,
      infoByItem,
    })
    expect(result.get('굴림만두')).toBe(400)
  })
})
