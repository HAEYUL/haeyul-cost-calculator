import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// 매장 출입증(로그인 세션)은 창(탭)마다 따로 보관한다. PC에서 창 여러 개로 다른 매장을 동시에 볼 수 있고,
// 지금처럼 창을 닫으면 다음에 PIN을 다시 입력한다.
export const AUTH_STORAGE_KEY = 'haeyul-auth'

export const supabase =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          storage: typeof window !== 'undefined' ? window.sessionStorage : undefined,
          storageKey: AUTH_STORAGE_KEY,
          persistSession: true,
          autoRefreshToken: true,
        },
      })
    : null

// 출입증 종류: 'admin'(메인 관리자, 4개 매장) / 'manager'(매장 PIN, 그 매장 1곳). role이 없는 예전 출입증은 매니저.
export function roleFromAppMetadata(meta) {
  if (meta?.role === 'admin') return 'admin'
  if (meta?.store_code) return 'manager'
  return null
}

// 지금 창에 저장된 출입증 정보 { role, storeCode }(없으면 null). 화면을 처음 그릴 때 바로 확인하려고 저장소를 직접 읽는다.
export function savedSessionInfo() {
  try {
    const raw = window.sessionStorage.getItem(AUTH_STORAGE_KEY)
    const meta = raw ? JSON.parse(raw)?.user?.app_metadata : null
    const role = roleFromAppMetadata(meta)
    return role ? { role, storeCode: role === 'manager' ? meta.store_code : null } : null
  } catch {
    return null
  }
}
