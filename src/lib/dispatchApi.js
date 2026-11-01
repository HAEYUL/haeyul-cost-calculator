import { supabase } from './supabaseClient'
import { apiFetch } from './apiFetch'

// 인력 명부에서 화면이 읽을 수 있는 칸(암호화된 주민번호는 읽을 수 없다)
export const WORKER_COLUMNS =
  'id, store_code, name, rrn_masked, bank, account, is_fixed, default_start, default_end, default_wage, memo, created_at'

export const SHIFT_COLUMNS =
  'id, store_code, worker_id, work_date, start_time, end_time, wage, bank, account, memo, paid_date, paid_marked_at, created_at'

export async function fetchWorkers(storeCodes) {
  const codes = Array.isArray(storeCodes) ? storeCodes : [storeCodes]
  const { data, error } = await supabase.from('dispatch_workers').select(WORKER_COLUMNS).in('store_code', codes).order('name')
  if (error) throw friendly(error)
  return data ?? []
}

// [start, end) 기간의 근무 (start/end = 'YYYY-MM-DD', 비우면 제한 없음)
export async function fetchShifts({ storeCodes, start, end, workerId, unpaidOnly = false }) {
  let q = supabase.from('dispatch_shifts').select(SHIFT_COLUMNS)
  if (storeCodes) q = q.in('store_code', Array.isArray(storeCodes) ? storeCodes : [storeCodes])
  if (workerId) q = q.eq('worker_id', workerId)
  if (start) q = q.gte('work_date', start)
  if (end) q = q.lt('work_date', end)
  if (unpaidOnly) q = q.is('paid_date', null)
  const { data, error } = await q.order('work_date', { ascending: false }).order('created_at', { ascending: false }).limit(5000)
  if (error) throw friendly(error)
  return data ?? []
}

function friendly(error) {
  if (/dispatch_/.test(error.message ?? '') && /exist|find|schema cache/i.test(error.message ?? '')) {
    return new Error('파출 표가 아직 없어요. Supabase에서 supabase/roles.sql을 실행해주세요.')
  }
  return error
}

// 서버(api/dispatch) 호출. 메인 관리자는 storeCode로 매장을 알려줘야 한다.
export async function dispatchRequest(action, payload = {}) {
  const res = await apiFetch('/api/dispatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

// 인력 정보 저장용 내용 (기존 값을 그대로 넘기고 바꿀 칸만 덮어쓴다)
export function workerPayload(worker, overrides = {}) {
  return {
    id: worker?.id,
    name: worker?.name ?? '',
    bank: worker?.bank ?? '',
    account: worker?.account ?? '',
    isFixed: worker?.is_fixed ?? false,
    defaultStart: worker?.default_start ? String(worker.default_start).slice(0, 5) : null,
    defaultEnd: worker?.default_end ? String(worker.default_end).slice(0, 5) : null,
    defaultWage: worker?.default_wage ?? null,
    memo: worker?.memo ?? '',
    ...overrides,
  }
}
