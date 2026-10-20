import { supabase } from './supabaseClient'

export const AUTH_EXPIRED_EVENT = 'haeyul-auth-expired'

// 우리 서버 기능(/api/...)을 부를 때 매장 출입증을 같이 보낸다. 출입증이 만료·취소돼 401이 오면
// 앱 전체에 알려서 매장 선택 화면으로 돌려보낸다.
export async function apiFetch(url, options = {}) {
  const { data } = supabase ? await supabase.auth.getSession() : { data: null }
  const token = data?.session?.access_token
  const res = await fetch(url, {
    ...options,
    headers: { ...(options.headers ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  })
  if (res.status === 401 && token) window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
  return res
}
