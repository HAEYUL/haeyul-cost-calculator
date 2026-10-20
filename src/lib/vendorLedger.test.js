import { describe, it, expect } from 'vitest'
import { makeLedger, suggestOpening, addDays, shiftMonth, monthBounds, LEDGER_START } from './vendorLedger'

const batch = (id, date, total, extra = {}) => ({
  id,
  invoice_date: date,
  created_at: `${date}T09:00:00Z`,
  total_amount: total,
  statement_balance: null,
  current_balance: null,
  ...extra,
})
const payment = (date, amount) => ({ paid_date: date, amount })
const opening = (balance) => ({ as_of_date: LEDGER_START, balance })

describe('날짜 도우미', () => {
  it('하루 더하기·달 이동·월 범위', () => {
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(monthBounds('2026-11')).toEqual({ start: '2026-11-01', end: '2026-11-30' })
  })
})

describe('makeLedger', () => {
  const ledger = makeLedger({
    batches: [batch('s', '2026-09-20', 999), batch('a', '2026-10-05', 1000), batch('b', '2026-11-03', 500)],
    payments: [payment('2026-10-15', 800), payment('2026-09-25', 50), payment(null, 70)],
    openings: [opening(2000), { as_of_date: '2026-08-01', balance: 1 }],
  })

  it('장부 시작 잔액 + 입고 − 결제로 현재 미지급을 구하고, 시작 전·날짜 없는 기록은 뺀다', () => {
    expect(ledger.hasOpening).toBe(true)
    expect(ledger.current).toBe(2000 + 1000 + 500 - 800)
    expect(ledger.undatedPayments).toHaveLength(1)
  })

  it('월 원장은 이월 + 입고 − 결제 = 잔액이고 다음 달로 이어진다', () => {
    const [oct, nov] = ledger.months('2026-11')
    expect(oct).toEqual({ month: '2026-10', carryOver: 2000, invoiced: 1000, paid: 800, ending: 2200 })
    expect(nov).toEqual({ month: '2026-11', carryOver: 2200, invoiced: 500, paid: 0, ending: 2700 })
  })

  it('시작 잔액이 없으면 0원에서 시작한다', () => {
    const l = makeLedger({ batches: [batch('a', '2026-10-05', 1000)] })
    expect(l.hasOpening).toBe(false)
    expect(l.current).toBe(1000)
  })
})

describe('reconcile', () => {
  it('빠진 결제가 있으면 그 결제가 들어갈 두 명세표 사이를 한 번만 알려준다', () => {
    const batches = [
      batch('a', '2026-10-05', 1000, { statement_balance: 5000 }),
      batch('b', '2026-10-20', 300, { statement_balance: 1000 }),
      batch('c', '2026-10-25', 200, { statement_balance: 1300 }),
    ]
    const issues = makeLedger({ batches, openings: [opening(5000)] }).reconcile()
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      statementDate: '2026-10-20',
      amount: -5000,
      fromDate: '2026-10-05',
      toDate: '2026-10-19',
      canRegisterPayment: true,
      isFirst: false,
    })
  })

  it('빠진 결제를 넣으면 차이가 사라진다(같은 날 결제는 그날 명세표에 반영 안 된 것으로 본다)', () => {
    const batches = [
      batch('a', '2026-10-05', 1000, { statement_balance: 5000 }),
      batch('b', '2026-10-20', 300, { current_balance: 1300 }),
    ]
    const issues = makeLedger({
      batches,
      payments: [payment('2026-10-15', 5000), payment('2026-10-20', 999)],
      openings: [opening(5000)],
    }).reconcile()
    expect(issues).toHaveLength(0)
  })

  it('전일입금이 찍힌 명세표(전잔액에 전날 송금이 안 빠짐)도 송금을 입력해 두면 차이가 없다', () => {
    // 10/14: 전잔액 5000 + 당일 1000 = 현잔액 6000 → 10/15 송금 4000 →
    // 10/16: 전잔액 6000 + 당일 500 − 전일입금 4000 = 현잔액 2500 → 10/17: 전잔액 2500 + 당일 300 = 2800
    const batches = [
      batch('a', '2026-10-14', 1000, { statement_balance: 5000, current_balance: 6000 }),
      batch('b', '2026-10-16', 500, { statement_balance: 6000, current_balance: 2500 }),
      batch('c', '2026-10-17', 300, { statement_balance: 2500, current_balance: 2800 }),
    ]
    const issues = makeLedger({ batches, payments: [payment('2026-10-15', 4000)], openings: [opening(5000)] }).reconcile()
    expect(issues).toEqual([])
  })

  it('첫 명세표부터 다르면 시작 잔액이 틀렸을 수 있다고 표시한다', () => {
    const issues = makeLedger({
      batches: [batch('a', '2026-10-01', 1000, { statement_balance: 4000 })],
      openings: [opening(5000)],
    }).reconcile()
    expect(issues[0]).toMatchObject({ isFirst: true, amount: -1000, canRegisterPayment: false })
  })
})

describe('suggestOpening', () => {
  it('9월 마지막 명세표 잔액에 그 뒤 9월 입고·결제를 반영한다', () => {
    const s = suggestOpening({
      batches: [batch('a', '2026-09-10', 100, { statement_balance: 900 }), batch('b', '2026-09-20', 300)],
      payments: [payment('2026-09-25', 200)],
    })
    expect(s.amount).toBe(900 + 100 + 300 - 200)
  })

  it('9월 잔액이 없으면 10월 첫 명세표 전잔액에서 거꾸로 계산한다', () => {
    const s = suggestOpening({
      batches: [batch('a', '2026-10-02', 400), batch('b', '2026-10-08', 100, { statement_balance: 3000 })],
      payments: [payment('2026-10-05', 1000)],
    })
    expect(s.amount).toBe(3000 - 400 + 1000)
  })

  it('잔액 정보가 하나도 없으면 null', () => {
    expect(suggestOpening({ batches: [batch('a', '2026-10-02', 400)] })).toBeNull()
  })
})
