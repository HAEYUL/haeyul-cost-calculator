import { supabase } from './supabaseClient'
import { todayStr } from './vendorLedger'
import { rowDateStr } from './rowDateStr'
import { INSURANCE_DAY_LIMIT } from './dispatch'
import { stockKey } from './stockKey'
import { unusualQuantity } from './quantityCheck'
import { shiftDate } from './staffDaily'
import { analyzeReorder } from './reorderCalc'
import { loadReorderInputs } from './reorderData'
import { loadStaffStatus } from './staffStatus'

// 관리자 홈 "오늘의 매장 현황": 매장마다 이번 달 매출·식재료비율·미지급과 신호등(🔴/🟠),
// 펼치면 확인할 일 목록(🔴 바로 확인 / 🟠 이번 주 처리 / 🟡 참고)을 보여준다.

// 식재료비율(입고 ÷ 매출) 기준: 35% 이하 정상, 35~40% 주의, 40% 초과 위험
export const FOOD_COST_WARN = 35
export const FOOD_COST_DANGER = 40
export function foodCostLevel(ratio) {
  if (ratio == null || !Number.isFinite(ratio)) return null
  if (ratio > FOOD_COST_DANGER) return 'danger'
  if (ratio > FOOD_COST_WARN) return 'warn'
  return 'good'
}

const pad2 = (n) => String(n).padStart(2, '0')

function monthStart(dateStr) {
  return `${dateStr.slice(0, 7)}-01`
}

function prevMonthSameRange(today) {
  const [y, m, d] = today.split('-').map(Number)
  const prev = new Date(y, m - 2, 1)
  const py = prev.getFullYear()
  const pm = prev.getMonth() + 1
  const last = new Date(py, pm, 0).getDate()
  return { start: `${py}-${pad2(pm)}-01`, end: `${py}-${pad2(pm)}-${pad2(Math.min(d, last))}` }
}

// 이번 달 1일~오늘 매출과 지난달 같은 기간 매출, 매출 입력이 빠진 날(1일~어제).
// 오늘 매출이 아직 입력 전이면 비교는 어제까지끼리 한다(오늘 몫이 빠져 늘 "감소"로 보이지 않게).
export function salesStats(rows, today) {
  const start = monthStart(today)
  const daysWithSales = new Set()
  for (const r of rows) if (r.sale_date >= start && r.sale_date <= today) daysWithSales.add(r.sale_date)
  const compareEnd = daysWithSales.has(today) || today === start ? today : shiftDate(today, -1)
  const prev = prevMonthSameRange(compareEnd)
  let month = 0
  let monthCompare = 0
  let prevSame = 0
  for (const r of rows) {
    const amt = Number(r.total_amount || 0)
    if (r.sale_date >= start && r.sale_date <= today) {
      month += amt
      if (r.sale_date <= compareEnd) monthCompare += amt
    } else if (r.sale_date >= prev.start && r.sale_date <= prev.end) {
      prevSame += amt
    }
  }
  const missingDays = []
  for (let d = start; d < today; d = shiftDate(d, 1)) if (!daysWithSales.has(d)) missingDays.push(d)
  const change = prevSame > 0 ? ((monthCompare - prevSame) / prevSame) * 100 : null
  return { month, prevSame, change, missingDays, hasData: daysWithSales.size > 0 }
}

// 같은 거래처·같은 날짜·같은 금액 명세표가 2장 이상 → 같은 돈을 두 번 줄 수 있어 바로 확인
export function findDuplicateBatches(batches, vendorNameById, since) {
  const groups = new Map()
  for (const b of batches) {
    const date = rowDateStr(b)
    const amount = Number(b.total_amount || 0)
    if (date < since || amount <= 0 || !b.vendor_id) continue
    const key = `${b.vendor_id}|${date}|${amount}`
    if (!groups.has(key)) groups.set(key, { vendorId: b.vendor_id, vendor: vendorNameById.get(b.vendor_id) ?? '거래처', date, amount, count: 0 })
    groups.get(key).count += 1
  }
  return [...groups.values()].filter((g) => g.count > 1).sort((a, b) => b.date.localeCompare(a.date))
}

// 최근 입고 중 수량이 그 품목 평소 입고량의 3배 이상(이전 기록 3번 이상일 때) → 사진 인식 오류·과다 주문 의심
export function findUnusualReceipts(invoices, since) {
  const byItem = new Map()
  for (const r of invoices) {
    if (r.quantity == null || !r.invoice_date) continue
    const key = stockKey(r.item_name, r.unit)
    if (!byItem.has(key)) byItem.set(key, [])
    byItem.get(key).push(r)
  }
  const out = []
  for (const rows of byItem.values()) {
    rows.sort((a, b) => a.invoice_date.localeCompare(b.invoice_date))
    rows.forEach((r, i) => {
      if (r.invoice_date < since) return
      const warn = unusualQuantity(
        rows.slice(0, i).map((x) => x.quantity),
        r.quantity,
      )
      if (warn) out.push({ itemName: r.item_name, unit: r.unit, quantity: Number(r.quantity), usual: warn.usual, factor: warn.factor, date: r.invoice_date, vendor: r.vendor })
    })
  }
  return out.sort((a, b) => b.date.localeCompare(a.date))
}

// 파출: 이번 달 같은 사람 8일 이상(4대보험 확인), 3일 넘게 송금 대기, 근로내용확인신고 기한(매월 15일, 10~15일에만)
export function dispatchFindings({ shifts, workerNameById, today }) {
  const start = monthStart(today)
  const daysByWorker = new Map()
  let lastMonthCount = 0
  const prevStart = prevMonthSameRange(today).start
  for (const s of shifts) {
    if (s.work_date >= start && s.work_date <= today) {
      if (!daysByWorker.has(s.worker_id)) daysByWorker.set(s.worker_id, new Set())
      daysByWorker.get(s.worker_id).add(s.work_date)
    } else if (s.work_date >= prevStart && s.work_date < start) lastMonthCount += 1
  }
  const longWorkers = [...daysByWorker.entries()]
    .filter(([, days]) => days.size >= INSURANCE_DAY_LIMIT)
    .map(([id, days]) => ({ name: workerNameById.get(id) ?? '파출', days: days.size }))
    .sort((a, b) => b.days - a.days)
  const overdueLimit = shiftDate(today, -3)
  const overdue = shifts.filter((s) => !s.paid_date && s.work_date < overdueLimit)
  const unpaidOld = overdue.length
    ? { count: new Set(overdue.map((s) => s.worker_id)).size, amount: overdue.reduce((sum, s) => sum + Number(s.wage || 0), 0) }
    : null
  const day = Number(today.slice(8, 10))
  const reportDue = lastMonthCount > 0 && day >= 10 && day <= 15 ? { deadline: `${Number(today.slice(5, 7))}월 15일`, dDay: 15 - day } : null
  return { longWorkers, unpaidOld, reportDue }
}

function won(n) {
  return `${Math.round(Number(n) || 0).toLocaleString('ko-KR')}원`
}

function shortDate(d) {
  return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
}

// 🔴/🟠 목록 (첫 화면 신호등에 쓰인다)
export function buildMainAlerts({ duplicates, unusual, dispatch }) {
  const alerts = []
  for (const d of duplicates.slice(0, 5)) {
    alerts.push({ level: 'red', text: `중복 의심 명세서 — ${d.vendor} ${shortDate(d.date)} ${won(d.amount)} ${d.count}장`, to: `/vendors/${d.vendorId}` })
  }
  for (const u of unusual.slice(0, 5)) {
    alerts.push({
      level: 'red',
      text: `이상 입고 — ${u.itemName} ${u.quantity.toLocaleString()}${u.unit ?? ''} (평소 ${Math.round(u.usual * 10) / 10}${u.unit ?? ''}, ${Math.round(u.factor)}배)`,
      to: `/inventory/${encodeURIComponent(u.itemName)}/${u.unit ?? 'none'}`,
    })
  }
  for (const w of dispatch.longWorkers) {
    alerts.push({ level: 'orange', text: `파출 ${w.name} 이번 달 ${w.days}일 근무 — 4대보험 가입 대상 확인`, to: '/dispatch' })
  }
  if (dispatch.reportDue) {
    alerts.push({
      level: 'orange',
      text: `근로내용확인신고 ${dispatch.reportDue.deadline}까지 (${dispatch.reportDue.dDay === 0 ? '오늘 마감' : `D-${dispatch.reportDue.dDay}`})`,
      to: '/dispatch-report',
    })
  }
  if (dispatch.unpaidOld) {
    alerts.push({ level: 'orange', text: `파출비 3일 넘게 송금 대기 — ${dispatch.unpaidOld.count}명 · ${won(dispatch.unpaidOld.amount)}`, to: '/dispatch-payments' })
  }
  return alerts
}

// 첫 화면용: 매출·입고·식재료비율과 🔴/🟠 확인할 일
export async function loadStoreBriefing(storeCode, today = todayStr()) {
  const prevStart = prevMonthSameRange(today).start
  const recent = shiftDate(today, -14)
  const dupSince = shiftDate(today, -45)
  const historySince = shiftDate(today, -180)
  const [salesRes, batchesRes, vendorsRes, invoicesRes, shiftsRes, unpaidRes, workersRes] = await Promise.all([
    supabase.from('sales_daily').select('sale_date, total_amount').eq('store_code', storeCode).gte('sale_date', prevStart).lte('sale_date', today),
    supabase
      .from('invoice_batches')
      .select('id, vendor_id, invoice_date, total_amount, created_at')
      .eq('store_code', storeCode)
      .gte('created_at', `${shiftDate(prevStart, -10)}T00:00:00`),
    supabase.from('vendors').select('id, name').eq('store_code', storeCode),
    supabase.from('invoices').select('item_name, unit, quantity, invoice_date, vendor').eq('store_code', storeCode).gte('invoice_date', historySince),
    supabase.from('dispatch_shifts').select('worker_id, work_date, wage, paid_date').eq('store_code', storeCode).gte('work_date', prevStart),
    supabase.from('dispatch_shifts').select('worker_id, work_date, wage, paid_date').eq('store_code', storeCode).is('paid_date', null).lt('work_date', prevStart),
    supabase.from('dispatch_workers').select('id, name').eq('store_code', storeCode),
  ])
  const err = batchesRes.error || invoicesRes.error
  if (err) throw err

  const sales = salesStats(salesRes.error ? [] : salesRes.data ?? [], today)
  const start = monthStart(today)
  const batches = batchesRes.data ?? []
  const purchase = batches.filter((b) => {
    const d = rowDateStr(b)
    return d >= start && d <= today
  }).reduce((s, b) => s + Number(b.total_amount || 0), 0)
  const foodRatio = sales.month > 0 ? (purchase / sales.month) * 100 : null

  const vendorNameById = new Map((vendorsRes.data ?? []).map((v) => [v.id, v.name]))
  const duplicates = findDuplicateBatches(batches, vendorNameById, dupSince)
  const unusual = findUnusualReceipts(invoicesRes.data ?? [], recent)
  const shifts = [...(shiftsRes.error ? [] : shiftsRes.data ?? []), ...(unpaidRes.error ? [] : unpaidRes.data ?? [])]
  const workerNameById = new Map((workersRes.error ? [] : workersRes.data ?? []).map((w) => [w.id, w.name]))
  const dispatch = dispatchFindings({ shifts, workerNameById, today })
  const alerts = buildMainAlerts({ duplicates, unusual, dispatch })

  return { sales, purchase, foodRatio, foodLevel: foodCostLevel(foodRatio), alerts }
}

// 펼쳤을 때만 불러오는 🟡 참고: ★관심 품목 단가 10% 이상 인상(7일), 주문 후 3일째 입고 없음,
// ★관심 품목 재고 마이너스, 근무 기록 3일 이상 밀림
export async function loadBriefingDetails(storeCode, today = todayStr()) {
  const weekAgo = shiftDate(today, -7)
  const [inputs, priceRes, staff] = await Promise.all([
    loadReorderInputs(storeCode).catch(() => null),
    supabase.from('price_changes').select('item_name, vendor, previous_price, new_price, changed_at').eq('store_code', storeCode).gte('changed_at', `${weekAgo}T00:00:00`),
    loadStaffStatus(storeCode).catch(() => null),
  ])
  const pinned = inputs?.pinnedNames ?? new Set()
  const out = []

  const rises = new Map()
  for (const p of priceRes.error ? [] : priceRes.data ?? []) {
    if (!pinned.has(p.item_name) || !(Number(p.previous_price) > 0)) continue
    const pct = ((Number(p.new_price) - Number(p.previous_price)) / Number(p.previous_price)) * 100
    if (pct >= 10 && (!rises.has(p.item_name) || rises.get(p.item_name).pct < pct)) rises.set(p.item_name, { pct, vendor: p.vendor })
  }
  for (const [name, r] of rises) {
    out.push({ level: 'yellow', text: `★${name} 단가 ${Math.round(r.pct)}% 인상${r.vendor ? ` (${r.vendor})` : ''}`, to: '/price-trend' })
  }

  if (inputs) {
    const report = analyzeReorder(inputs.invoices, inputs)
    const pendingByVendor = new Map()
    for (const a of report.alerts.filter((x) => x.orderPending)) pendingByVendor.set(a.vendor, (pendingByVendor.get(a.vendor) ?? 0) + 1)
    for (const [vendor, n] of pendingByVendor) out.push({ level: 'yellow', text: `${vendor} 주문 후 ${3}일째 입고 없음 (${n}품목)`, to: '/reorder-alerts' })
    const negatives = [...inputs.stockByKey.values()].filter((s) => pinned.has(s.itemName) && s.current < 0)
    if (negatives.length) {
      out.push({ level: 'yellow', text: `★관심 품목 재고 마이너스 ${negatives.length}개 — ${negatives.slice(0, 3).map((s) => s.itemName).join(', ')}`, to: '/inventory' })
    }
  }

  if (staff && staff.missing.length >= 3) {
    out.push({ level: 'yellow', text: `근무 기록 안 된 날 ${staff.missing.length}일 — ${staff.missing.slice(-3).map(shortDate).join(', ')}`, to: '/staff-schedule' })
  }
  return out
}
