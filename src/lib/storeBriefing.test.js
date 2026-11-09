import { describe, it, expect } from 'vitest'
import { salesStats, foodCostLevel, findDuplicateBatches, findUnusualReceipts, dispatchFindings, buildMainAlerts } from './storeBriefing'

describe('salesStats', () => {
  it('이번 달 1일~오늘 vs 지난달 같은 기간, 매출 빠진 날', () => {
    const rows = [
      { sale_date: '2026-11-01', total_amount: 1000 },
      { sale_date: '2026-11-03', total_amount: 1000 },
      { sale_date: '2026-11-03', total_amount: 500 }, // 두 번째 POS
      { sale_date: '2026-10-02', total_amount: 2000 },
      { sale_date: '2026-10-20', total_amount: 9999 }, // 같은 기간 밖
    ]
    const s = salesStats(rows, '2026-11-04')
    expect(s.month).toBe(2500)
    expect(s.prevSame).toBe(2000)
    expect(s.change).toBeCloseTo(25)
    expect(s.missingDays).toEqual(['2026-11-02'])
  })
  it('오늘 매출이 입력 전이면 어제까지끼리 비교', () => {
    const rows = [
      ...[1, 2, 3].map((d) => ({ sale_date: `2026-11-0${d}`, total_amount: 100 })),
      ...[1, 2, 3, 4].map((d) => ({ sale_date: `2026-10-0${d}`, total_amount: 100 })),
    ]
    const s = salesStats(rows, '2026-11-04')
    expect(s.prevSame).toBe(300) // 10/1~10/3
    expect(s.change).toBeCloseTo(0)
  })
  it('지난달 말일보다 날짜가 크면 말일까지', () => {
    const s = salesStats([{ sale_date: '2026-02-28', total_amount: 100 }], '2026-03-31')
    expect(s.prevSame).toBe(100)
  })
})

describe('foodCostLevel', () => {
  it('35% 이하 정상, 40% 이하 주의, 초과 위험', () => {
    expect([foodCostLevel(32), foodCostLevel(35), foodCostLevel(37), foodCostLevel(40.5), foodCostLevel(null)]).toEqual(['good', 'good', 'warn', 'danger', null])
  })
})

describe('findDuplicateBatches', () => {
  it('같은 거래처·날짜·금액 2장 이상', () => {
    const batches = [
      { vendor_id: 'v1', invoice_date: '2026-11-06', total_amount: 1250000 },
      { vendor_id: 'v1', invoice_date: '2026-11-06', total_amount: 1250000 },
      { vendor_id: 'v1', invoice_date: '2026-11-06', total_amount: 30000 },
      { vendor_id: 'v2', invoice_date: '2026-11-06', total_amount: 1250000 },
      { vendor_id: 'v1', invoice_date: '2026-08-01', total_amount: 5 },
      { vendor_id: 'v1', invoice_date: '2026-08-01', total_amount: 5 },
    ]
    const d = findDuplicateBatches(batches, new Map([['v1', '퀸스유통']]), '2026-10-01')
    expect(d).toEqual([{ vendorId: 'v1', vendor: '퀸스유통', date: '2026-11-06', amount: 1250000, count: 2 }])
  })
})

describe('findUnusualReceipts', () => {
  it('최근 입고만, 그 전 기록 3번 이상 평균의 3배 이상', () => {
    const inv = [
      { item_name: '연근', unit: 'kg', quantity: 60, invoice_date: '2026-10-01' },
      { item_name: '연근', unit: 'kg', quantity: 60, invoice_date: '2026-10-10' },
      { item_name: '연근', unit: 'kg', quantity: 60, invoice_date: '2026-10-20' },
      { item_name: '연근', unit: 'kg', quantity: 600, invoice_date: '2026-11-06', vendor: '퀸스유통' },
      { item_name: '연근', unit: 'kg', quantity: 70, invoice_date: '2026-11-07' },
      { item_name: '대파', unit: 'box', quantity: 10, invoice_date: '2026-11-07' },
    ]
    const u = findUnusualReceipts(inv, '2026-10-26')
    expect(u).toHaveLength(1)
    expect(u[0]).toMatchObject({ itemName: '연근', quantity: 600, usual: 60, factor: 10, vendor: '퀸스유통' })
  })
})

describe('dispatchFindings', () => {
  const names = new Map([['w1', '정파출'], ['w2', '김파출']])
  const days = (id, n, paid = true) =>
    Array.from({ length: n }, (_, i) => ({ worker_id: id, work_date: `2026-11-${String(i + 1).padStart(2, '0')}`, wage: 80000, paid_date: paid ? '2026-11-20' : null }))
  it('8일 이상 근무자, 3일 넘은 송금 대기, 10~15일 신고 기한', () => {
    const shifts = [...days('w1', 8), ...days('w2', 2, false), { worker_id: 'w2', work_date: '2026-10-05', wage: 1, paid_date: '2026-10-06' }]
    const r = dispatchFindings({ shifts, workerNameById: names, today: '2026-11-12' })
    expect(r.longWorkers).toEqual([{ name: '정파출', days: 8 }])
    expect(r.unpaidOld).toEqual({ count: 1, amount: 160000 })
    expect(r.reportDue).toEqual({ deadline: '11월 15일', dDay: 3 })
    expect(dispatchFindings({ shifts, workerNameById: names, today: '2026-11-09' }).reportDue).toBeNull()
  })
  it('지난달 파출이 없으면 신고 알림 없음', () => {
    expect(dispatchFindings({ shifts: days('w1', 1), workerNameById: names, today: '2026-11-12' }).reportDue).toBeNull()
  })
})

describe('buildMainAlerts', () => {
  it('🔴 중복·이상 입고, 🟠 파출', () => {
    const a = buildMainAlerts({
      duplicates: [{ vendorId: 'v1', vendor: '퀸스유통', date: '2026-11-06', amount: 1250000, count: 2 }],
      unusual: [{ itemName: '연근', unit: 'kg', quantity: 600, usual: 60, factor: 10, date: '2026-11-06' }],
      dispatch: { longWorkers: [{ name: '정파출', days: 8 }], unpaidOld: null, reportDue: { deadline: '11월 15일', dDay: 0 } },
    })
    expect(a.map((x) => x.level)).toEqual(['red', 'red', 'orange', 'orange'])
    expect(a[0].text).toBe('중복 의심 명세서 — 퀸스유통 11/6 1,250,000원 2장')
    expect(a[1].text).toBe('이상 입고 — 연근 600kg (평소 60kg, 10배)')
    expect(a[3].text).toContain('오늘 마감')
  })
})
