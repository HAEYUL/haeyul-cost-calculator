import { createContext, useContext, useState } from 'react'

const StoreContext = createContext(null)
const STORAGE_KEY = 'haeyul-selected-store'

export function StoreProvider({ children }) {
  const [store, setStoreState] = useState(() => {
    const saved = sessionStorage.getItem(STORAGE_KEY)
    return saved ? JSON.parse(saved) : null
  })

  const setStore = (nextStore) => {
    setStoreState(nextStore)
    if (nextStore) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(nextStore))
    } else {
      sessionStorage.removeItem(STORAGE_KEY)
    }
  }

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
