import { createContext, useContext, useEffect, useState } from 'react'
import { savedSessionInfo, supabase } from '../lib/supabaseClient'
import { AUTH_EXPIRED_EVENT } from '../lib/apiFetch'
import { STORES } from '../data/stores'

const StoreContext = createContext(null)
const STORAGE_KEY = 'haeyul-selected-store'
const STORE_ORDER = STORES.map((s) => s.code)

function readSaved() {
  const info = savedSessionInfo()
  if (!info) return { role: null, store: null }
  let saved = null
  try {
    saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null')
  } catch {
    saved = null
  }
  if (info.role === 'admin') {
    // 메인 관리자: 마지막으로 보던 매장(없으면 첫 매장)
    const store = saved && STORE_ORDER.includes(saved.code) ? saved : STORES[0]
    return { role: 'admin', store }
  }
  // 매니저: 이 창의 출입증 매장과 저장된 매장이 같아야 들어간다(예전 방식으로 들어왔거나 끊긴 경우 다시 로그인).
  if (saved && saved.code === info.storeCode) return { role: 'manager', store: saved }
  return { role: null, store: null }
}

export function StoreProvider({ children }) {
  const [{ role, store }, setState] = useState(readSaved)
  const [stores, setStores] = useState(STORES)

  // 매장 목록(이름은 DB 값을 쓰고, 순서는 STORES에 정해둔 순서로 고정)
  useEffect(() => {
    if (!supabase) return
    supabase
      .from('stores')
      .select('code, name')
      .then(({ data, error }) => {
        if (!error && data?.length) {
          setStores([...data].sort((a, b) => STORE_ORDER.indexOf(a.code) - STORE_ORDER.indexOf(b.code)))
        }
      })
  }, [])

  const clear = () => {
    setState({ role: null, store: null })
    sessionStorage.removeItem(STORAGE_KEY)
  }

  // 로그인 직후: 출입증 종류와 보여줄 매장을 정한다.
  const signIn = (nextRole, nextStore) => {
    setState({ role: nextRole, store: nextStore })
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(nextStore))
  }

  // 메인 관리자만: 다시 로그인하지 않고 보는 매장을 바꾼다.
  const setStore = (nextStore) => {
    if (!nextStore) return
    if (role !== 'admin') return
    setState((prev) => ({ ...prev, store: nextStore }))
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(nextStore))
  }

  const logout = async () => {
    clear()
    if (supabase) await supabase.auth.signOut({ scope: 'local' })
  }

  // 출입증이 만료·취소되면(예: 비밀번호 변경) 첫 화면으로 돌아간다.
  useEffect(() => {
    if (!supabase) return
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') clear()
    })
    const onExpired = () => {
      supabase.auth.signOut({ scope: 'local' })
      clear()
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired)
    return () => {
      data.subscription.unsubscribe()
      window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired)
    }
  }, [])

  const value = {
    store,
    stores,
    role,
    isAdmin: role === 'admin',
    isManager: role === 'manager',
    signIn,
    setStore,
    logout,
  }
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}
