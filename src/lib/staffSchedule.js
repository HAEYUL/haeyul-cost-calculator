// 근무표 화면 공통 로직. days는 {"1":"O","2":"△",...} 형태로, 키는 그 달의 날짜(1부터),
// 값은 O(종일근무)/△(반타임)/X(휴무) 중 하나다.

export const MARK_LABELS = {
  O: 'O(종일근무)',
  '△': '△(반타임)',
  X: 'X(휴무)',
}

const MARK_CYCLE = [null, 'O', '△', 'X']

// 칸을 클릭할 때마다 비어있음 → O → △ → X → 비어있음 순서로 돌린다.
export function cycleMark(mark) {
  const idx = MARK_CYCLE.indexOf(mark ?? null)
  return MARK_CYCLE[(idx + 1) % MARK_CYCLE.length]
}

export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

// 총근무일수 = 종일근무(O) + 반타임(△). 휴무(X)는 근무일수에 포함하지 않는다.
export function countMarks(days) {
  const values = Object.values(days ?? {})
  const full = values.filter((v) => v === 'O').length
  const half = values.filter((v) => v === '△').length
  const off = values.filter((v) => v === 'X').length
  return { full, half, off, total: full + half }
}
