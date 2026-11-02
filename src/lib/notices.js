import { supabase } from './supabaseClient'

export const NOTICE_COLUMNS = 'id, store_code, message, created_at, confirmed_at, reply, replied_at'

export async function fetchNotices({ storeCodes, sinceDays = 90, unconfirmedOnly = false }) {
  let q = supabase.from('store_notices').select(NOTICE_COLUMNS).in('store_code', storeCodes)
  if (unconfirmedOnly) q = q.is('confirmed_at', null)
  else {
    const since = new Date(Date.now() - sinceDays * 86400000).toISOString()
    q = q.gte('created_at', since)
  }
  const { data, error } = await q.order('created_at', { ascending: false }).limit(500)
  if (error) {
    if (/store_notices/.test(error.message ?? '')) {
      throw new Error('전달사항 표가 아직 없어요. Supabase에서 supabase/manager-menu.sql을 실행해주세요.')
    }
    throw error
  }
  return data ?? []
}

// 매니저: 확인(+답장)
export function confirmNotice(id, reply) {
  const now = new Date().toISOString()
  const text = (reply ?? '').trim()
  return supabase
    .from('store_notices')
    .update({ confirmed_at: now, ...(text ? { reply: text, replied_at: now } : {}) })
    .eq('id', id)
}

export function noticeTime(iso) {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
