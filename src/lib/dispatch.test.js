import { describe, it, expect } from 'vitest'
import {
  dailyWageTax,
  findSimilarWorkers,
  formatRrn,
  groupUnpaid,
  rrnError,
  rrnMaskedPart,
  showMaskedRrn,
  summarizeByWorker,
  timeRangeLabel,
  toJamo,
} from './dispatch'

describe('주민등록번호', () => {
  it('정상 번호는 통과', () => {
    expect(rrnError('650312-2123456')).toBeNull()
    expect(rrnError('0102033123456')).toBeNull()
  })
  it('자리수·생년월일·뒷자리 첫 숫자를 확인한다', () => {
    expect(rrnError('650312-212345')).toMatch(/13자리/)
    expect(rrnError('651332-2123456')).toMatch(/생년월일/)
    expect(rrnError('650230-2123456')).toMatch(/생년월일/)
    expect(rrnError('650312-9123456')).toMatch(/뒷자리/)
  })
  it('가려서 보여주기', () => {
    expect(rrnMaskedPart('6503122123456')).toBe('650312-2')
    expect(showMaskedRrn('650312-2')).toBe('650312-2******')
    expect(formatRrn('6503122123456')).toBe('650312-2123456')
  })
})

describe('비슷한 이름 찾기', () => {
  const workers = [
    { id: 1, name: '박순자' },
    { id: 2, name: '박순희' },
    { id: 3, name: '이정민' },
    { id: 4, name: '윤금애' },
  ]
  const names = (q) => findSimilarWorkers(q, workers).map((r) => `${r.worker.name}:${r.reason}`)

  it('같은 이름이 가장 먼저', () => {
    expect(names('박순자')[0]).toBe('박순자:same')
  })
  it('한 글자 다른 이름', () => {
    expect(names('박순지')).toEqual(['박순자:oneChar', '박순희:oneChar'])
  })
  it('받침·모음만 다른 오타(애/에, 금/근)', () => {
    expect(names('윤근에')).toEqual(['윤금애:typo'])
  })
  it('성을 빼고 입력해도 찾는다', () => {
    expect(names('금애')).toContain('윤금애:noSurname')
  })
  it('치는 중에도 앞부분이 같으면 보여준다', () => {
    expect(names('박순')).toEqual(['박순자:prefix', '박순희:prefix'])
  })
  it('전혀 다른 이름은 안 나온다', () => {
    expect(names('최영호')).toEqual([])
  })
  it('자모 분해', () => {
    expect(toJamo('애')).toBe('ㅇㅐ')
  })
})

describe('일용근로소득 세금', () => {
  it('15만 원 이하는 0원', () => {
    expect(dailyWageTax(135000)).toEqual({ incomeTax: 0, localTax: 0 })
    expect(dailyWageTax(150000)).toEqual({ incomeTax: 0, localTax: 0 })
  })
  it('초과분 × 2.7%, 1,000원 미만은 소액부징수', () => {
    expect(dailyWageTax(180000)).toEqual({ incomeTax: 0, localTax: 0 }) // 30,000 × 2.7% = 810원 → 0
    expect(dailyWageTax(200000)).toEqual({ incomeTax: 1350, localTax: 130 })
  })
})

describe('근무 묶기', () => {
  const shifts = [
    { id: 'a', store_code: 'gondre', worker_id: 'w1', work_date: '2026-10-29', wage: 65000, paid_date: null },
    { id: 'b', store_code: 'gondre', worker_id: 'w1', work_date: '2026-10-28', wage: 65000, paid_date: null },
    { id: 'c', store_code: 'gondre', worker_id: 'w1', work_date: '2026-10-25', wage: 135000, paid_date: '2026-10-25' },
    { id: 'd', store_code: 'haeyul', worker_id: 'w2', work_date: '2026-10-31', wage: 135000, paid_date: null },
  ]
  it('송금 대기만 매장·근무자별로 날짜순', () => {
    const groups = groupUnpaid(shifts)
    expect(groups).toHaveLength(2)
    const g = groups.find((x) => x.workerId === 'w1')
    expect(g.total).toBe(130000)
    expect(g.shifts.map((s) => s.id)).toEqual(['b', 'a'])
  })
  it('근무자별 합계·근무일수·송금/대기', () => {
    const r = summarizeByWorker(shifts).get('w1')
    expect(r).toMatchObject({ days: 3, total: 265000, paid: 135000, unpaid: 130000 })
  })
  it('시간 표시', () => {
    expect(timeRangeLabel('09:00:00', '21:00:00')).toBe('09~21')
    expect(timeRangeLabel('09:30', '14:00')).toBe('09:30~14')
  })
})

import { buildLedgerRows, buildYearRows, groupByPaidDate } from './dispatch'

describe('세무 출력 집계', () => {
  const shifts = [
    { worker_id: 'w1', work_date: '2026-10-09', wage: 135000, paid_date: '2026-10-09' },
    { worker_id: 'w1', work_date: '2026-10-17', wage: 135000, paid_date: '2026-10-18' },
    { worker_id: 'w1', work_date: '2026-10-18', wage: 135000, paid_date: '2026-10-18' },
    { worker_id: 'w1', work_date: '2026-10-31', wage: 200000, paid_date: null },
    { worker_id: 'w2', work_date: '2026-03-02', wage: 65000, paid_date: '2026-03-02' },
  ]
  it('지급대장: 근무일수·합계·세금·실지급액·미송금', () => {
    const r = buildLedgerRows(shifts).find((x) => x.workerId === 'w1')
    expect(r).toMatchObject({ days: 4, total: 605000, incomeTax: 1350, localTax: 130, net: 603520, unpaid: 200000 })
  })
  it('연간: 월별 칸에 나눠 담는다', () => {
    const r = buildYearRows(shifts).find((x) => x.workerId === 'w2')
    expect(r.months[2]).toBe(65000)
    expect(r.total).toBe(65000)
  })
  it('같은 날 송금한 연속 근무를 묶는다 (종이 명세서의 270,000원처럼)', () => {
    const w1 = buildLedgerRows(shifts).find((x) => x.workerId === 'w1')
    const groups = groupByPaidDate(w1.shifts)
    expect(groups.map((g) => [g.paidDate, g.shifts.length, g.amount])).toEqual([
      ['2026-10-09', 1, 135000],
      ['2026-10-18', 2, 270000],
      [null, 1, 0],
    ])
  })
})

import { finishTimeInput, formatTimeInput, isValidTime, positionLabel, positionsOf, summarizeByPosition } from './dispatch'

describe('근무시간 직접 입력', () => {
  it('숫자만 쳐도 시:분으로', () => {
    expect(formatTimeInput('0900')).toBe('09:00')
    expect(formatTimeInput('2100')).toBe('21:00')
    expect(formatTimeInput('090')).toBe('09:0')
    expect(formatTimeInput('9')).toBe('9')
  })
  it('한 글자씩 쳐도 깨지지 않는다', () => {
    let v = ''
    for (const ch of '0900') v = formatTimeInput(v + ch)
    expect(v).toBe('09:00')
  })
  it('칸을 벗어나면 정리', () => {
    expect(finishTimeInput('9')).toBe('09:00')
    expect(finishTimeInput('21')).toBe('21:00')
    expect(finishTimeInput('93:0')).toBe('09:30')
    expect(finishTimeInput('')).toBe('')
  })
  it('올바른 시각만 통과', () => {
    expect(isValidTime('09:00')).toBe(true)
    expect(isValidTime('24:00')).toBe(true)
    expect(isValidTime('25:00')).toBe(false)
    expect(isValidTime('09:60')).toBe(false)
    expect(isValidTime('9:00')).toBe(false)
  })
})

describe('포지션(홀/주방)', () => {
  const shifts = [
    { position: 'hall', wage: 135000 },
    { position: 'kitchen', wage: 65000 },
    { position: 'hall', wage: 65000 },
    { position: null, wage: 100000 },
  ]
  it('포지션별 건수·금액', () => {
    expect(summarizeByPosition(shifts)).toEqual({
      hall: { count: 2, total: 200000 },
      kitchen: { count: 1, total: 65000 },
      none: { count: 1, total: 100000 },
    })
  })
  it('표시 이름', () => {
    expect(positionLabel('kitchen')).toBe('주방')
    expect(positionsOf(shifts)).toBe('홀·주방')
    expect(positionsOf([{ position: 'hall' }])).toBe('홀')
    expect(positionsOf([{}])).toBe('-')
  })
})
