import { countMarks, daysInMonth } from './staffSchedule'
import { WEEKDAY_LABELS } from './staffDaily'

function hhmm(t) {
  return t ? String(t).slice(0, 5) : ''
}

// 월 근무표 엑셀: 1번 시트 "근무표"(직원 × 날짜 + 합계), 2번 시트 "파출"(그 달 파출 근무 목록 + 합계)
// rows: staff_schedules 행들(employee_name, days), order: 직원 이름 순서(명부 순서), shifts/workers: 파출
export function buildStaffMonthSheets({ storeName, year, month, rows, order = [], shifts = [], workers = [] }) {
  const n = daysInMonth(year, month)
  const dayNums = Array.from({ length: n }, (_, i) => i + 1)
  const rank = new Map(order.map((name, i) => [name, i]))
  const sorted = [...rows].sort(
    (a, b) => (rank.get(a.employee_name) ?? 9999) - (rank.get(b.employee_name) ?? 9999) || a.employee_name.localeCompare(b.employee_name),
  )

  const title = [`${storeName} ${year}년 ${month}월 직원 근무표`]
  const legend = ['O=종일  △=반타임  연=연차  X=휴무  (총 근무일 = 종일 + 반타임)']
  const head = ['직원명', ...dayNums.map((d) => d), '종일', '반타임', '연차', '휴무', '총 근무일']
  const weekdays = ['요일', ...dayNums.map((d) => WEEKDAY_LABELS[new Date(year, month - 1, d).getDay()]), '', '', '', '', '']
  const body = sorted.map((r) => {
    const c = countMarks(r.days)
    return [r.employee_name, ...dayNums.map((d) => r.days?.[String(d)] ?? ''), c.full, c.half, c.leave, c.off, c.total]
  })
  const totals = body.reduce(
    (acc, row) => acc.map((v, i) => v + Number(row[n + 1 + i] || 0)),
    [0, 0, 0, 0, 0],
  )
  const staffSheet = {
    name: '근무표',
    rows: [title, legend, [], head, weekdays, ...body, ['합계', ...dayNums.map(() => ''), ...totals]],
    colWidths: [12, ...dayNums.map(() => 4.5), 7, 7, 7, 7, 9],
    boldRows: [0, 3, 4, 5 + body.length],
    titleRows: [0, 1],
  }

  const workerById = new Map(workers.map((w) => [w.id, w]))
  const shiftRows = [...shifts]
    .sort((a, b) => a.work_date.localeCompare(b.work_date))
    .map((s) => [
      s.work_date,
      workerById.get(s.worker_id)?.name ?? '',
      s.position ?? '',
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
