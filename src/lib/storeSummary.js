import { supabase } from './supabaseClient'
import { groupByVendor, makeLedger, todayStr } from './vendorLedger'
import { rowDateStr } from './rowDateStr'
import { INSURANCE_DAY_LIMIT, monthRange } from './dispatch'

// 매장 한 곳의 오늘 현황: 오늘 명세표, 거래처 미지급, 파출 송금 대기, 이번 달 8일 이상 근무자
export async function loadStoreSummary(storeCode, today = todayStr()) {
  const { start, end } = monthRange(today.slice(0, 7))
  const [batchesRes, paymentsRes, openingRes, shiftsRes, monthRes] = await Promise.all([
    supabase
      .from('invoice_batches')
      .select('vendor_id, total_amount, invoice_date, statement_balance, current_balance, created_at')
      .eq('store_code', storeCode),
    supabase.from('vendor_payments').select('vendor_id, amount, paid_date').eq('store_code', storeCode),
    supabase.from('vendor_opening_balances').select('vendor_id, as_of_date, balance').eq('store_code', storeCode),
    supabase.from('dispatch_shifts').select('worker_id, wage').eq('store_code', storeCode).is('paid_date', null),
    supabase.from('dispatch_shifts').select('worker_id, work_date').eq('store_code', storeCode).gte('work_date', start).lt('work_date', end),
  ])
  const err = batchesRes.error || paymentsRes.error || openingRes.error
  if (err) throw err

  const batches = batchesRes.data ?? []
  const todayBatches = batches.filter((b) => rowDateStr(b) === today || (b.created_at ?? '').slice(0, 10) === today)

  const batchesByVendor = groupByVendor(batches)
  const paymentsByVendor = groupByVendor(paymentsRes.data)
  const openingByVendor = groupByVendor(openingRes.data)
  let balance = 0
  for (const vendorId of new Set([...batchesByVendor.keys(), ...paymentsByVendor.keys(), ...openingByVendor.keys()])) {
    balance += makeLedger({
      batches: batchesByVendor.get(vendorId),
      payments: paymentsByVendor.get(vendorId),
      openings: openingByVendor.get(vendorId),
    }).current
  }

  // 파출 표가 아직 없으면 0으로 둔다.
  const unpaid = shiftsRes.error ? [] : (shiftsRes.data ?? [])
  const daysByWorker = new Map()
  for (const s of monthRes.error ? [] : (monthRes.data ?? [])) {
    if (!daysByWorker.has(s.worker_id)) daysByWorker.set(s.worker_id, new Set())
    daysByWorker.get(s.worker_id).add(s.work_date)
  }
  return {
    todayCount: todayBatches.length,
    todayAmount: todayBatches.reduce((sum, b) => sum + Number(b.total_amount || 0), 0),
    balance,
    unpaidWorkers: new Set(unpaid.map((s) => s.worker_id)).size,
    unpaidAmount: unpaid.reduce((sum, s) => sum + Number(s.wage || 0), 0),
    longWorkers: [...daysByWorker.values()].filter((d) => d.size >= INSURANCE_DAY_LIMIT).length,
    monthShiftDays: [...daysByWorker.values()].reduce((sum, d) => sum + d.size, 0),
  }
}

// 일용직 신고 기한 안내: 이번 달 15일 전이면 '이번 달 15일(전월분 근로내용확인신고)', 지나면 다음 달 15일
export function nextReportDeadline(today = todayStr()) {
  const [y, m, d] = today.split('-').map(Number)
  if (d <= 15) return `${m}월 15일까지`
  const next = new Date(y, m, 15)
  return `${next.getMonth() + 1}월 15일까지`
}

export const wonFull = (n) => Math.round(Number(n) || 0).toLocaleString('ko-KR')

// 'TODAY · 2026.11.02 MON'
export function eyebrowDate(date = new Date()) {
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
  const p = (n) => String(n).padStart(2, '0')
  return `TODAY · ${date.getFullYear()}.${p(date.getMonth() + 1)}.${p(date.getDate())} ${days[date.getDay()]}`
}

export function nowLabel(date = new Date()) {
  const h = date.getHours()
  return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${String(date.getMinutes()).padStart(2, '0')} 기준`
}
