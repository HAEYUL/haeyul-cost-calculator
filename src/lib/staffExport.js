import { employmentLabel } from './staffPosition'

function hhmm(t) {
  return t ? String(t).slice(0, 5) : ''
}

const DISPATCH_POS = { hall: '홀', kitchen: '주방' }

// 월 근무표 엑셀(buildMonthModel 결과를 그대로 쓴다)
// 1번 시트 "근무표": 포지션별 묶음(소계) × 날짜 + 요일 + 합계, 아래에 포지션별 일별 인원(직원+파출)·파출 수
// 2번 시트 "파출": 그 달 파출 근무 목록 + 사람별 합계
export function buildStaffMonthSheets({ storeName, model, shifts = [], workers = [] }) {
  const { year, month, days, groups, headcount, dispatchPerDay } = model
  const n = days.length
  const blankDays = days.map(() => '')
  const rows = [
    [`${storeName} ${year}년 ${month}월 직원 근무표`],
    ['O=종일  △=반타임  연=연차  X=휴무  (총 근무일 = 종일 + 반타임)'],
    [],
    ['직원명', '고용', ...days.map((d) => d.day), '종일', '반타임', '연차', '휴무', '총 근무일'],
    ['', '요일', ...days.map((d) => d.weekday), '', '', '', '', ''],
  ]
  const bold = [0, 3, 4]
  const all = { full: 0, half: 0, leave: 0, off: 0, total: 0 }
  for (const g of groups) {
    bold.push(rows.length)
    const s = g.subtotal
    rows.push([`[${g.position}] ${g.rows.length}명`, '', ...blankDays, s.full, s.half, s.leave, s.off, s.total])
    for (const r of g.rows) {
      const c = r.counts
      rows.push([
        r.name,
        employmentLabel(r.employmentType),
        ...days.map((d) => r.days[String(d.day)] ?? ''),
        c.full,
        c.half,
        c.leave,
        c.off,
        c.total,
      ])
    }
    for (const k of Object.keys(all)) all[k] += s[k]
  }
  bold.push(rows.length)
  rows.push(['전체 합계', '', ...blankDays, all.full, all.half, all.leave, all.off, all.total])
  rows.push([])
  bold.push(rows.length)
  rows.push(['일별 인원', '(직원+파출)', ...days.map((d) => d.day), '', '', '', '', ''])
  for (const h of headcount) rows.push([h.position, '', ...h.perDay.map((c) => c.total), '', '', '', '', ''])
  rows.push(['파출', '', ...dispatchPerDay, '', '', '', '', ''])

  const staffSheet = {
    name: '근무표',
    rows,
    colWidths: [12, 8, ...Array.from({ length: n }, () => 4.5), 7, 7, 7, 7, 9],
    boldRows: bold,
    titleRows: [0, 1],
  }

  const workerById = new Map(workers.map((w) => [w.id, w]))
  const shiftRows = [...shifts]
    .sort((a, b) => a.work_date.localeCompare(b.work_date))
    .map((s) => [
      s.work_date,
      workerById.get(s.worker_id)?.name ?? '',
      DISPATCH_POS[s.position] ?? s.position ?? '',
      hhmm(s.start_time),
      hhmm(s.end_time),
      Number(s.wage || 0),
      s.paid_date ? `송금 완료 (${s.paid_date})` : '송금 대기',
    ])
  const byName = new Map()
  for (const r of shiftRows) {
    const e = byName.get(r[1]) ?? { days: new Set(), wage: 0 }
    e.days.add(r[0])
    e.wage += r[5]
    byName.set(r[1], e)
  }
  const dispatchSheet = {
    name: '파출',
    rows: [
      [`${storeName} ${year}년 ${month}월 파출 근무`],
      [],
      ['날짜', '이름', '포지션', '시작', '종료', '일당', '송금'],
      ...shiftRows,
      ['합계', `${shiftRows.length}건`, '', '', '', shiftRows.reduce((s, r) => s + r[5], 0), ''],
      [],
      ['이름', '근무일수', '일당 합계'],
      ...[...byName.entries()].map(([name, e]) => [name, e.days.size, e.wage]),
    ],
    colWidths: [12, 12, 10, 8, 8, 12, 22],
    boldRows: [0, 2, 3 + shiftRows.length, 5 + shiftRows.length],
    titleRows: [0],
  }
  return [staffSheet, dispatchSheet]
}
