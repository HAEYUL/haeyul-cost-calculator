// 파출(일용직) 관리 공통 계산. 화면·서버·테스트가 같이 쓴다(브라우저 전용 API를 쓰지 않는다).

// ---------- 주민등록번호 ----------
export function rrnDigits(value) {
  return String(value ?? '').replace(/\D/g, '')
}

// 형식 확인: 13자리, 생년월일이 실제 날짜, 뒷자리 첫 숫자 1~8(5~8은 외국인등록번호). 맞으면 null, 틀리면 안내 문구.
// (2020년 10월 이후 번호는 끝자리 검증 규칙이 없어져서 검증숫자는 확인하지 않는다)
export function rrnError(value) {
  const d = rrnDigits(value)
  if (d.length !== 13) return '주민등록번호 13자리를 입력하세요.'
  const g = Number(d[6])
  if (g < 1 || g > 8) return '주민등록번호 뒷자리 첫 숫자를 확인하세요.'
  const century = g === 1 || g === 2 || g === 5 || g === 6 ? 1900 : 2000
  const year = century + Number(d.slice(0, 2))
  const month = Number(d.slice(2, 4))
  const day = Number(d.slice(4, 6))
  const date = new Date(year, month - 1, day)
  if (month < 1 || month > 12 || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return '주민등록번호 앞자리(생년월일)를 확인하세요.'
  }
  return null
}

// 화면에 보여줄 앞부분: 650312-2
export function rrnMaskedPart(value) {
  const d = rrnDigits(value)
  return `${d.slice(0, 6)}-${d.slice(6, 7)}`
}

// 650312-2 → 650312-2******
export function showMaskedRrn(masked) {
  return masked ? `${masked}******` : '-'
}

// 6503122123456 → 650312-2123456
export function formatRrn(value) {
  const d = rrnDigits(value)
  return d.length === 13 ? `${d.slice(0, 6)}-${d.slice(6)}` : d
}

// ---------- 비슷한 이름 찾기 ----------
const HANGUL_BASE = 0xac00
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'
const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'
const JONG = ['', ...'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ']

// 한글 음절을 자모로 풀어서 비교한다(애/에, 금/근 같은 한 획 차이 오타를 잡기 위해).
export function toJamo(text) {
  let out = ''
  for (const ch of text) {
    const code = ch.charCodeAt(0) - HANGUL_BASE
    if (code < 0 || code > 11171) {
      out += ch
      continue
    }
    out += CHO[Math.floor(code / 588)] + JUNG[Math.floor((code % 588) / 28)] + JONG[code % 28]
  }
  return out
}

export function levenshtein(a, b) {
  const x = [...a]
  const y = [...b]
  const dp = Array.from({ length: x.length + 1 }, (_, i) => [i, ...new Array(y.length).fill(0)])
  for (let j = 0; j <= y.length; j++) dp[0][j] = j
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      dp[i][j] = x[i - 1] === y[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[x.length][y.length]
}

const normName = (name) => String(name ?? '').replace(/\s+/g, '')

export const SIMILAR_REASON_LABELS = {
  same: '같은 이름',
  prefix: '이름이 이어짐',
  noSurname: '성 빼고 같음',
  oneChar: '한 글자 다름',
  typo: '받침·모음 오타',
}

// 입력한 이름과 비슷한 기존 인력을 찾는다. [{ worker, reason }] (가까운 순)
export function findSimilarWorkers(input, workers, limit = 5) {
  const q = normName(input)
  if (!q) return []
  const qJamo = toJamo(q)
  const order = ['same', 'prefix', 'noSurname', 'oneChar', 'typo']
  const found = []
  for (const worker of workers) {
    const name = normName(worker.name)
    if (!name) continue
    let reason = null
    if (name === q) reason = 'same'
    else if (q.length >= 1 && name.startsWith(q)) reason = 'prefix'
    else if (q.length >= 2 && name.length === q.length + 1 && name.endsWith(q)) reason = 'noSurname'
    else if (q.length >= 2 && name.length >= 2 && levenshtein(q, name) === 1) reason = 'oneChar'
    else if (q.length >= 2 && levenshtein(qJamo, toJamo(name)) <= 2) reason = 'typo'
    if (reason) found.push({ worker, reason })
  }
  return found
    .sort((a, b) => order.indexOf(a.reason) - order.indexOf(b.reason) || a.worker.name.localeCompare(b.worker.name, 'ko'))
    .slice(0, limit)
}

// ---------- 포지션 ----------
export const POSITIONS = [
  { key: 'hall', label: '홀', icon: '🍽️' },
  { key: 'kitchen', label: '주방', icon: '🔪' },
]
export const positionLabel = (key) => POSITIONS.find((p) => p.key === key)?.label ?? '-'

// 포지션별 합계: { hall: { count, total }, kitchen: {...}, none: {...} }
export function summarizeByPosition(shifts) {
  const out = { hall: { count: 0, total: 0 }, kitchen: { count: 0, total: 0 }, none: { count: 0, total: 0 } }
  for (const s of shifts) {
    const r = out[s.position] ?? out.none
    r.count += 1
    r.total += Number(s.wage || 0)
  }
  return out
}

// 한 사람이 한 달 동안 맡은 포지션: '홀', '주방', '홀·주방'
export function positionsOf(shifts) {
  const keys = POSITIONS.map((p) => p.key).filter((k) => shifts.some((s) => s.position === k))
  return keys.length ? keys.map(positionLabel).join('·') : '-'
}

// ---------- 시간·금액 ----------
export const won = (n) => `${Math.round(Number(n) || 0).toLocaleString('ko-KR')}원`
export const wonPlain = (n) => Math.round(Number(n) || 0).toLocaleString('ko-KR')

// '09:00:00' → '09:00'
export const hhmm = (t) => (t ? String(t).slice(0, 5) : '')

// 09:00~21:00 → '09~21', 09:30~14:00 → '09:30~14'
export function timeRangeLabel(start, end) {
  const short = (t) => {
    const v = hhmm(t)
    return v.endsWith(':00') ? v.slice(0, 2) : v
  }
  if (!start && !end) return '-'
  return `${short(start)}~${short(end)}`
}

// 근무시간 직접 입력(치는 중): 숫자만 쳐도 '09' → '09', '090' → '09:0', '0900' → '09:00' (24시간 기준)
export function formatTimeInput(raw) {
  const d = String(raw ?? '').replace(/\D/g, '').slice(0, 4)
  return d.length <= 2 ? d : `${d.slice(0, 2)}:${d.slice(2)}`
}

// 칸을 벗어날 때 정리: '9' → '09:00', '21' → '21:00', '930' → '09:30'
export function finishTimeInput(value) {
  const d = String(value ?? '').replace(/\D/g, '')
  if (d.length === 0) return ''
  if (d.length <= 2) return `${d.padStart(2, '0')}:00`
  if (d.length === 3) return `0${d[0]}:${d.slice(1)}`
  return `${d.slice(0, 2)}:${d.slice(2, 4)}`
}

// 00:00 ~ 24:00
export function isValidTime(t) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(t ?? ''))
  if (!m) return false
  const h = Number(m[1])
  const min = Number(m[2])
  return min < 60 && (h < 24 || (h === 24 && min === 0))
}

// 일용근로소득 원천징수: 일당 15만 원 초과분 × 6% × (1 − 55% 세액공제) = 2.7%.
// 소득세가 1,000원 미만이면 걷지 않는다(소액부징수). 지방소득세 = 소득세의 10%. 10원 미만 버림.
export const DAILY_TAX_FREE = 150000
export function dailyWageTax(wage) {
  const over = Math.max(0, Number(wage || 0) - DAILY_TAX_FREE)
  let incomeTax = Math.floor((over * 0.027) / 10) * 10
  if (incomeTax < 1000) incomeTax = 0
  const localTax = Math.floor((incomeTax * 0.1) / 10) * 10
  return { incomeTax, localTax }
}

// 한 달에 이만큼 이상 일하면 국민연금·건강보험 사업장 가입 확인 대상
export const INSURANCE_DAY_LIMIT = 8

// 'YYYY-MM' → 그 달 [첫날, 다음 달 첫날)
export function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number)
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  return { start: `${ym}-01`, end: `${next}-01` }
}

export function shiftMonthKey(ym, delta) {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// 근무자별 한 달 요약: 근무일수(같은 날 두 번이면 하루), 합계, 송금/대기 금액
export function summarizeByWorker(shifts) {
  const map = new Map()
  for (const s of shifts) {
    if (!map.has(s.worker_id)) map.set(s.worker_id, { workerId: s.worker_id, dates: new Set(), total: 0, paid: 0, unpaid: 0, shifts: [] })
    const r = map.get(s.worker_id)
    r.dates.add(s.work_date)
    r.total += Number(s.wage || 0)
    if (s.paid_date) r.paid += Number(s.wage || 0)
    else r.unpaid += Number(s.wage || 0)
    r.shifts.push(s)
  }
  for (const r of map.values()) {
    r.days = r.dates.size
    r.shifts.sort((a, b) => a.work_date.localeCompare(b.work_date))
  }
  return map
}

// 송금 대기 묶음: 매장·근무자별로 아직 송금 안 한 근무를 모은다.
export function groupUnpaid(shifts) {
  const groups = new Map()
  for (const s of shifts) {
    if (s.paid_date) continue
    const key = `${s.store_code}|${s.worker_id}`
    if (!groups.has(key)) groups.set(key, { key, storeCode: s.store_code, workerId: s.worker_id, shifts: [], total: 0 })
    const g = groups.get(key)
    g.shifts.push(s)
    g.total += Number(s.wage || 0)
  }
  for (const g of groups.values()) g.shifts.sort((a, b) => a.work_date.localeCompare(b.work_date))
  return [...groups.values()]
}

// 월간 지급대장 한 줄(근무자별): 근무일, 총지급액, 소득세·지방소득세(일당별로 계산해 합산), 실지급액
export function buildLedgerRows(shifts) {
  const map = new Map()
  for (const s of shifts) {
    if (!map.has(s.worker_id)) {
      map.set(s.worker_id, { workerId: s.worker_id, dates: new Set(), total: 0, incomeTax: 0, localTax: 0, unpaid: 0, shifts: [] })
    }
    const r = map.get(s.worker_id)
    const wage = Number(s.wage || 0)
    const tax = dailyWageTax(wage)
    r.dates.add(s.work_date)
    r.total += wage
    r.incomeTax += tax.incomeTax
    r.localTax += tax.localTax
    if (!s.paid_date) r.unpaid += wage
    r.shifts.push(s)
  }
  return [...map.values()].map((r) => ({
    ...r,
    days: r.dates.size,
    net: r.total - r.incomeTax - r.localTax,
    shifts: r.shifts.sort((a, b) => a.work_date.localeCompare(b.work_date) || String(a.start_time).localeCompare(String(b.start_time))),
  }))
}

// 연간 집계(근무자별 1~12월 지급액)
export function buildYearRows(shifts) {
  const map = new Map()
  for (const s of shifts) {
    if (!map.has(s.worker_id)) map.set(s.worker_id, { workerId: s.worker_id, months: new Array(12).fill(0), dates: new Set(), total: 0 })
    const r = map.get(s.worker_id)
    const wage = Number(s.wage || 0)
    r.months[Number(s.work_date.slice(5, 7)) - 1] += wage
    r.dates.add(s.work_date)
    r.total += wage
  }
  return [...map.values()].map((r) => ({ ...r, days: r.dates.size }))
}

// 급여명세서의 송금 칸: 같은 날 송금한 근무끼리 묶는다(연속된 줄만). [{ shifts, paidDate, amount }]
export function groupByPaidDate(sortedShifts) {
  const groups = []
  for (const s of sortedShifts) {
    const last = groups.at(-1)
    if (last && s.paid_date && last.paidDate === s.paid_date) {
      last.shifts.push(s)
      last.amount += Number(s.wage || 0)
    } else {
      groups.push({ shifts: [s], paidDate: s.paid_date ?? null, amount: s.paid_date ? Number(s.wage || 0) : 0 })
    }
  }
  return groups
}
