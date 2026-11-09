import { describe, it, expect } from 'vitest'
import {
  analyzeReorder,
  computeReorderAlerts,
  mutedKeysFromDismissals,
  muteCardKey,
  MUTED_SIGNATURE,
  orderedCardKey,
  orderedMarksFromDismissals,
  groupAlertsByVendor,
  buildOrderMessage,
  roundOrderQty,
  localDateStr,
  NO_VENDOR,
} from './reorderCalc'
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
  it('주문 시기 지남 → 곧 주문 → 재고 적음, 같은 상태·우선순위면 늦은 순', () => {
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

const vrows = (item, vendor, list, unit = 'kg') =>
  list.map(([invoice_date, quantity]) => ({ item_name: item, unit, vendor, invoice_date, quantity }))

describe('입고되면 바로 빠짐', () => {
  it('마지막 입고일이 오늘이면 알림에 없다', () => {
    const r = rows('대파', [['2026-11-01', 10], ['2026-11-04', 10], ['2026-11-07', 10], ['2026-11-10', 10]])
    expect(computeReorderAlerts(r, { now })).toEqual([])
  })
})

describe('거래처', () => {
  it('가장 최근에 사 온 거래처로 묶고 나머지는 otherVendors', () => {
    const r = [
      ...vrows('대파', 'A유통', [['2026-11-01', 10], ['2026-11-04', 10]]),
      ...vrows('대파', 'B상회', [['2026-11-07', 10]]),
    ]
    const [a] = computeReorderAlerts(r, { now })
    expect(a.vendor).toBe('B상회')
    expect(a.otherVendors).toEqual(['A유통'])
  })
  it('거래처가 비어 있으면 "거래처 미지정"', () => {
    const [a] = computeReorderAlerts(rows('대파', [['2026-11-01', 10], ['2026-11-04', 10], ['2026-11-07', 10]]), { now })
    expect(a.vendor).toBe(NO_VENDOR)
  })
})

describe('추천 주문량', () => {
  it('하루 사용량 × 평소 주기 = 평소 한 번 주문량', () => {
    const [a] = computeReorderAlerts(rows('대파', [['2026-11-01', 2], ['2026-11-04', 2], ['2026-11-07', 2]], 'box'), { now })
    expect(a.recommendedQty).toBe(2)
  })
  it('재고를 믿을 수 있으면 남은 양만큼 줄인다', () => {
    const invoices = rows('대파', [['2026-11-01', 10], ['2026-11-04', 10], ['2026-11-07', 10]])
    const stockByKey = buildStockLedger({ invoices, usage: [{ item_name: '대파', unit: 'kg', used_qty: 27 }] })
    const [a] = computeReorderAlerts(invoices, { now, stockByKey })
    expect(a.recommendedQty).toBe(7) // 10 - 3
  })
  it('수량을 모르면 추천하지 않는다', () => {
    const [a] = computeReorderAlerts(rows('대파', [['2026-11-01', null], ['2026-11-04', null], ['2026-11-07', null]]), { now })
    expect(a.recommendedQty).toBeNull()
  })
  it('반올림', () => {
    expect(roundOrderQty(1.2, 'box')).toBe(2)
    expect(roundOrderQty(0.3, 'ea')).toBe(1)
    expect(roundOrderQty(2.01, 'kg')).toBe(3)
    expect(roundOrderQty(0.42, 'kg')).toBe(0.5)
    expect(roundOrderQty(0, 'kg')).toBeNull()
  })
})

describe('주문했어요', () => {
  const invoices = rows('대파', [['2026-11-01', 10], ['2026-11-04', 10], ['2026-11-07', 10]])
  const marks = (date) => orderedMarksFromDismissals([{ card_key: orderedCardKey('대파', 'kg'), signature: date }])

  it('주문 후 3일 안에는 목록에서 숨긴다', () => {
    const { alerts, ordered } = analyzeReorder(invoices, { now, orderedMarks: marks('2026-11-09') })
    expect(alerts).toEqual([])
    expect(ordered[0].orderedDate).toBe('2026-11-09')
  })
  it('3일이 지나도 입고가 없으면 "입고 안 됨"으로 맨 위에 다시 알린다', () => {
    const extra = rows('양파', [['2026-10-25', 10], ['2026-10-30', 10], ['2026-11-04', 10]]) // 더 늦은 품목
    const { alerts } = analyzeReorder([...invoices, ...extra], { now: new Date('2026-11-12'), orderedMarks: marks('2026-11-09') })
    expect(alerts[0].itemName).toBe('대파')
    expect(alerts[0].orderPending).toBe(true)
  })
  it('주문 뒤 입고되면 주문 기록은 끝나고 평소대로 계산한다', () => {
    const received = [...invoices, ...rows('대파', [['2026-11-10', 10]])]
    const { alerts, ordered } = analyzeReorder(received, { now, orderedMarks: marks('2026-11-09') })
    expect(alerts).toEqual([])
    expect(ordered).toEqual([])
  })
  it('취소 기록이나 날짜가 아닌 값은 무시한다', () => {
    expect(orderedMarksFromDismissals([{ card_key: orderedCardKey('대파', 'kg'), signature: 'cancelled' }]).size).toBe(0)
  })
  it('localDateStr', () => {
    expect(localDateStr(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('우선순위', () => {
  const same = [['2026-11-01', 10], ['2026-11-04', 10], ['2026-11-07', 10]]
  it('같은 상태면 ★관심 품목 → 레시피 재료 → 자주 입고 순', () => {
    const invoices = [
      ...rows('자주', [['2026-10-04', 10], ['2026-10-10', 10], ['2026-10-16', 10], ['2026-10-22', 10], ['2026-10-28', 10], ['2026-11-03', 10]]),
      ...rows('레시피', same),
      ...rows('관심', same),
      ...rows('보통', same),
    ]
    // 자주: 6일 주기, 7일 지남 → overdue (나머지도 3일 주기, 3일 지남 → overdue)
    const order = computeReorderAlerts(invoices, {
      now,
      pinnedNames: new Set(['관심']),
      recipeItemNames: new Set(['레시피']),
    }).map((a) => a.itemName)
    expect(order).toEqual(['관심', '레시피', '자주', '보통'])
  })
})

describe('groupAlertsByVendor', () => {
  it('급한 품목이 많은 거래처부터, 미지정은 맨 뒤', () => {
    const alerts = [
      { itemName: 'a', vendor: 'A', status: 'dueSoon', ratio: 0.9, recentReceipts: 1, pinned: false, recipeLinked: false, orderPending: false },
      { itemName: 'b', vendor: 'A', status: 'dueSoon', ratio: 0.9, recentReceipts: 1, pinned: false, recipeLinked: false, orderPending: false },
      { itemName: 'c', vendor: 'B', status: 'overdue', ratio: 1.2, recentReceipts: 1, pinned: false, recipeLinked: false, orderPending: false },
      { itemName: 'd', vendor: NO_VENDOR, status: 'overdue', ratio: 2, recentReceipts: 1, pinned: false, recipeLinked: false, orderPending: false },
    ]
    const groups = groupAlertsByVendor(alerts)
    expect(groups.map((g) => `${g.vendor}:${g.items.length}:${g.urgentCount}`)).toEqual(['B:1:1', 'A:2:0', `${NO_VENDOR}:1:1`])
  })
})

describe('buildOrderMessage', () => {
  it('거래처·매장 이름과 품목·수량으로 문구를 만든다', () => {
    const msg = buildOrderMessage({
      vendor: '퀸스유통',
      storeName: '해율만두전골',
      lines: [
        { itemName: '염장연근채', qty: 2, unitLabel: '박스' },
        { itemName: '단무지', qty: null },
      ],
    })
    expect(msg).toBe('퀸스유통 사장님, 해율만두전골입니다.\n내일 배송 부탁드립니다.\n\n- 염장연근채 2박스\n- 단무지\n\n감사합니다.')
  })
  it('거래처 미지정이면 거래처 이름을 넣지 않는다', () => {
    const msg = buildOrderMessage({ vendor: NO_VENDOR, storeName: '곤드레밥집', lines: [] })
    expect(msg.startsWith('사장님, 곤드레밥집입니다.')).toBe(true)
  })
})
