import { describe, it, expect } from 'vitest'
import { analyzeReorder, computeReorderAlerts, mutedKeysFromDismissals, muteCardKey, MUTED_SIGNATURE } from './reorderCalc'
import { buildStockLedger } from './stockLedger'
import { stockKey } from './stockKey'

const now = new Date('2026-11-10')
const rows = (item, list, unit = 'kg') =>
  list.map(([invoice_date, quantity]) => ({ item_name: item, unit, invoice_date, quantity }))

describe('analyzeReorder - 날짜만', () => {
  it('입고일 3번 미만이면 계산하지 않는다', () => {
    expect(computeReorderAlerts(rows('대파', [['2026-11-01', 10], ['2026-11-04', 10]]), { now })).toEqual([])
  })

  it('수량이 비어 있으면 평균 주문 주기로 판단한다', () => {
    const r = rows('대파', [['2026-11-01', null], ['2026-11-04', null], ['2026-11-07', null]])
    const [a] = computeReorderAlerts(r, { now })
    expect(a.basis).toBe('interval')
    expect(a.expectedDays).toBe(3)
    expect(a.status).toBe('overdue') // 3일 지남
  })

  it('같은 날 두 번 들어온 건 하루로 세고 양은 합친다', () => {
    const r = rows('대파', [['2026-11-01', 5], ['2026-11-01', 5], ['2026-11-04', 10], ['2026-11-07', 10]])
    const [a] = computeReorderAlerts(r, { now })
    expect(a.receiptDays).toBe(3)
    expect(a.dailyUse).toBeCloseTo(20 / 6)
  })
})

describe('analyzeReorder - 날짜 + 양', () => {
  it('평소와 같은 양이면 평소 주기대로 알린다', () => {
    // 3일마다 10kg → 하루 약 3.33kg, 지난번 10kg는 3일치. 11/7 + 3일 = 11/10 → 주문 시기
    const [a] = computeReorderAlerts(rows('대파', [['2026-11-01', 10], ['2026-11-04', 10], ['2026-11-07', 10]]), { now })
    expect(a.basis).toBe('quantity')
    expect(a.expectedDays).toBeCloseTo(3)
    expect(a.status).toBe('overdue')
    expect(a.estimatedRemaining).toBeCloseTo(0)
  })

  it('지난번에 평소의 2배를 샀으면 알림이 2배 늦게 뜬다', () => {
    const r = rows('대파', [['2026-11-01', 10], ['2026-11-04', 10], ['2026-11-07', 20]])
    const { alerts } = analyzeReorder(r, { now })
    expect(alerts).toEqual([]) // 20kg는 6일치 → 3일 지났으니 아직 50%
    const later = computeReorderAlerts(r, { now: new Date('2026-11-12') })
    expect(later[0].expectedDays).toBeCloseTo(6)
    expect(later[0].status).toBe('dueSoon') // 5/6 = 83%
  })

  it('지난번에 평소의 절반만 샀으면 알림이 빨리 뜬다', () => {
    const r = rows('대파', [['2026-11-01', 10], ['2026-11-04', 10], ['2026-11-07', 5]])
    const [a] = computeReorderAlerts(r, { now: new Date('2026-11-09') })
    expect(a.expectedDays).toBeCloseTo(1.5)
    expect(a.status).toBe('overdue')
  })

  it('입력 실수로 양이 터무니없어도 예상 소진일은 평소 주기의 4배까지만', () => {
    const r = rows('대파', [['2026-11-01', 10], ['2026-11-04', 10], ['2026-11-07', 10000]])
    const { stale, alerts } = analyzeReorder(r, { now: new Date('2026-11-21') })
    expect(alerts[0].expectedDays).toBeCloseTo(12)
    expect(stale).toEqual([])
  })
})

describe('① 주문이 끊긴 품목 제외', () => {
  it('예상 소진일의 3배가 지나면 알림에서 빼고 stale로 모은다', () => {
    const r = rows('옛날메뉴재료', [['2026-09-01', 10], ['2026-09-04', 10], ['2026-09-07', 10]])
    const { alerts, stale } = analyzeReorder(r, { now })
    expect(alerts).toEqual([])
    expect(stale.map((s) => s.itemName)).toEqual(['옛날메뉴재료'])
  })
})

describe('② 재고가 충분하면 제외', () => {
  const invoices = rows('대파', [['2026-11-01', 10], ['2026-11-04', 10], ['2026-11-07', 10]])

  it('사용량을 입력하는 품목이고 현재고가 한 번 입고량의 절반 이상이면 뺀다', () => {
    const stockByKey = buildStockLedger({ invoices, usage: [{ item_name: '대파', unit: 'kg', used_qty: 22 }] })
    // 30 - 22 = 8kg 남음, 한 번 입고량 10kg의 절반(5) 이상
    const { alerts, enoughStock } = analyzeReorder(invoices, { now, stockByKey })
    expect(alerts).toEqual([])
    expect(enoughStock[0].currentStock).toBe(8)
  })

  it('현재고가 절반 미만이면 그대로 알린다', () => {
    const stockByKey = buildStockLedger({ invoices, usage: [{ item_name: '대파', unit: 'kg', used_qty: 27 }] })
    const [a] = computeReorderAlerts(invoices, { now, stockByKey })
    expect(a.status).toBe('overdue')
    expect(a.currentStock).toBe(3)
  })

  it('주기가 안 됐어도 재고가 적으면 "재고 적음"으로 알린다', () => {
    const stockByKey = buildStockLedger({ invoices, usage: [{ item_name: '대파', unit: 'kg', used_qty: 28 }] })
    const [a] = computeReorderAlerts(invoices, { now: new Date('2026-11-08'), stockByKey })
    expect(a.status).toBe('lowStock')
  })

  it('사용량·실사 기록이 없는 품목은 현재고를 믿지 않고 주기·양으로만 판단한다', () => {
    const stockByKey = buildStockLedger({ invoices })
    expect(stockByKey.get(stockKey('대파', 'kg')).tracked).toBe(false)
    const [a] = computeReorderAlerts(invoices, { now, stockByKey })
    expect(a.status).toBe('overdue')
    expect(a.currentStock).toBeNull()
  })

  it('재고실사(조정) 기록도 재고를 믿을 근거로 본다', () => {
    const stockByKey = buildStockLedger({ invoices, adjustments: [{ item_name: '대파', unit: 'kg', delta: -10 }] })
    expect(stockByKey.get(stockKey('대파', 'kg')).tracked).toBe(true)
    expect(computeReorderAlerts(invoices, { now, stockByKey })).toEqual([]) // 20kg 남음
  })
})

describe('③ 품목별 알림 끄기', () => {
  it('끈 품목은 알림에서 빼고 muted로 모은다', () => {
    const invoices = [
      ...rows('대파', [['2026-11-01', 10], ['2026-11-04', 10], ['2026-11-07', 10]]),
      ...rows('양파', [['2026-11-01', 10], ['2026-11-04', 10], ['2026-11-07', 10]]),
    ]
    const dismissals = [
      { card_key: muteCardKey('대파', 'kg'), signature: MUTED_SIGNATURE },
      { card_key: muteCardKey('양파', 'kg'), signature: 'unmuted' },
      { card_key: 'reorder', signature: 'abc' },
    ]
    const mutedKeys = mutedKeysFromDismissals(dismissals)
    expect([...mutedKeys]).toEqual([stockKey('대파', 'kg')])
    const { alerts, muted } = analyzeReorder(invoices, { now, mutedKeys })
    expect(alerts.map((a) => a.itemName)).toEqual(['양파'])
    expect(muted.map((a) => a.itemName)).toEqual(['대파'])
  })
})

describe('정렬', () => {
  it('주문 시기 지남 → 곧 주문 → 재고 적음, 같은 상태는 늦은 순', () => {
    const invoices = [
      ...rows('A', [['2026-11-01', 10], ['2026-11-04', 10], ['2026-11-07', 10]]), // 100%
      ...rows('B', [['2026-10-25', 10], ['2026-10-30', 10], ['2026-11-04', 10]]), // 6/5 = 120%
      ...rows('C', [['2026-10-30', 10], ['2026-11-03', 10], ['2026-11-07', 10]]), // 3/4 = 75% → 없음
      ...rows('D', [['2026-10-27', 10], ['2026-11-01', 10], ['2026-11-06', 10]]), // 4/5 = 80%
    ]
    expect(computeReorderAlerts(invoices, { now }).map((a) => `${a.itemName}:${a.status}`)).toEqual([
      'B:overdue',
      'A:overdue',
      'D:dueSoon',
    ])
  })
})
