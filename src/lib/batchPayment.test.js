import { describe, it, expect } from 'vitest'
import { paidBatchIds, canRecordBatchPayment, matchPaymentsToBatches } from './batchPayment'

const batch = (id, vendorId, date, total) => ({ id, vendor_id: vendorId, invoice_date: date, total_amount: total })
const payment = (vendorId, date, amount) => ({ vendor_id: vendorId, paid_date: date, amount })

describe('paidBatchIds', () => {
  it('같은 거래처·날짜·금액의 결제가 있으면 결제됨으로 본다', () => {
    const ids = paidBatchIds([batch('a', 'v1', '2026-10-16', 126000)], [payment('v1', '2026-10-16', '126000')])
    expect(ids.has('a')).toBe(true)
  })

  it('거래처·날짜·금액 중 하나라도 다르면 결제됨이 아니다', () => {
    const batches = [batch('a', 'v1', '2026-10-16', 126000)]
    expect(paidBatchIds(batches, [payment('v2', '2026-10-16', 126000)]).size).toBe(0)
    expect(paidBatchIds(batches, [payment('v1', '2026-10-17', 126000)]).size).toBe(0)
    expect(paidBatchIds(batches, [payment('v1', '2026-10-16', 120000)]).size).toBe(0)
  })

  it('결제 하나는 명세표 하나에만 짝지어진다', () => {
    const batches = [batch('a', 'v1', '2026-10-16', 5000), batch('b', 'v1', '2026-10-16', 5000)]
    expect(paidBatchIds(batches, [payment('v1', '2026-10-16', 5000)]).size).toBe(1)
  })

  it('vendors(id) 형태로 불러온 명세표도 거래처를 알아본다', () => {
    const b = { id: 'a', vendors: { id: 'v1' }, invoice_date: '2026-10-16', total_amount: 100 }
    expect(paidBatchIds([b], [payment('v1', '2026-10-16', 100)]).has('a')).toBe(true)
  })
})

describe('canRecordBatchPayment', () => {
  it('입고일이 없거나 금액이 0이면 결제 처리할 수 없다', () => {
    expect(canRecordBatchPayment(batch('a', 'v1', null, 100))).toBe(false)
    expect(canRecordBatchPayment(batch('a', 'v1', '2026-10-16', 0))).toBe(false)
    expect(canRecordBatchPayment(batch('a', 'v1', '2026-10-16', 100))).toBe(true)
  })
})

describe('matchPaymentsToBatches', () => {
  it('명세표마다 짝지어진 결제 행을 돌려준다', () => {
    const p1 = { id: 'p1', vendor_id: 'v1', paid_date: '2026-10-16', amount: 5000 }
    const p2 = { id: 'p2', vendor_id: 'v1', paid_date: '2026-10-16', amount: 5000 }
    const matched = matchPaymentsToBatches(
      [batch('a', 'v1', '2026-10-16', 5000), batch('b', 'v1', '2026-10-16', 5000), batch('c', 'v1', '2026-10-16', 7000)],
      [p1, p2],
    )
    expect(matched.get('a')).toBe(p1)
    expect(matched.get('b')).toBe(p2)
    expect(matched.has('c')).toBe(false)
  })
})
