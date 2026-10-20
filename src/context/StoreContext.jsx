import { createContext, useContext, useEffect, useState } from 'react'
import { savedSessionStoreCode, supabase } from '../lib/supabaseClient'
import { AUTH_EXPIRED_EVENT } from '../lib/apiFetch'

const StoreContext = createContext(null)
const STORAGE_KEY = 'haeyul-selected-store'

export function StoreProvider({ children }) {
  const [store, setStoreState] = useState(() => {
    const saved = sessionStorage.getItem(STORAGE_KEY)
    const parsed = saved ? JSON.parse(saved) : null
    // 이 창에 그 매장의 출입증이 없으면(예전 방식으로 들어왔거나 로그인이 끊긴 경우) 매장을 다시 고르게 한다.
    if (parsed && savedSessionStoreCode() !== parsed.code) {
      sessionStorage.removeItem(STORAGE_KEY)
      return null
    }
    return parsed
  })

  const setStore = (nextStore) => {
    setStoreState(nextStore)
    if (nextStore) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(nextStore))
    } else {
      sessionStorage.removeItem(STORAGE_KEY)
    }
  }

  // 출입증이 만료·취소되면(예: 매장 PIN 변경) 매장 선택 화면으로 돌아간다.
  useEffect(() => {
    if (!supabase) return
    const clear = () => {
      setStoreState(null)
      sessionStorage.removeItem(STORAGE_KEY)
    }
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

  return (
    <StoreContext.Provider value={{ store, setStore }}>
      {children}
    </StoreContext.Provider>
  )
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}
