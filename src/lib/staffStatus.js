import { supabase } from './supabaseClient'
import { todayStr } from './vendorLedger'
import { monthRangeOf, parseDate, shiftDate, unrecordedDates } from './staffDaily'

// 홈 화면 알림용: 이번 달 근무 기록 상태.
// - todayRecorded: 오늘 [저장]했거나 근무표에 오늘 표시가 있음
// - missing: 이번 달 1일 ~ 어제 중 기록 안 된 날
// 재직 직원이 없으면(직원근무표를 아직 안 쓰는 매장) null을 돌려줘서 알림을 띄우지 않는다.
export async function loadStaffStatus(storeCode) {
  const today = todayStr()
  const { year, month } = parseDate(today)
  const { start } = monthRangeOf(today)
  const [membersRes, rowsRes, logsRes, closesRes] = await Promise.all([
    supabase.from('staff_members').select('id').eq('store_code', storeCode).eq('active', true).limit(1),
    supabase.from('staff_schedules').select('year, month, days').eq('store_code', storeCode).eq('year', year).eq('month', month),
    supabase.from('staff_day_logs').select('work_date').eq('store_code', storeCode).gte('work_date', start).lte('work_date', today),
    supabase.from('staff_month_closes').select('year').eq('store_code', storeCode).eq('year', year).eq('month', month),
  ])
  if (membersRes.error || rowsRes.error || logsRes.error) return null
  if ((membersRes.data ?? []).length === 0) return null
  if (!closesRes.error && (closesRes.data ?? []).length > 0) return null
  const savedDates = new Set((logsRes.data ?? []).map((l) => l.work_date))
  const scheduleRows = rowsRes.data ?? []
  const missing = unrecordedDates({ start, endExclusive: today, savedDates, scheduleRows })
  const todayRecorded = unrecordedDates({ start: today, endExclusive: shiftDate(today, 1), savedDates, scheduleRows }).length === 0
  return { today, todayRecorded, missing }
}
