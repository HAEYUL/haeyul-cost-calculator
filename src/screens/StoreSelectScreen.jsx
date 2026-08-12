import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { STORES } from '../data/stores'
import { useStore } from '../context/StoreContext'

export default function StoreSelectScreen() {
  const [stores, setStores] = useState(STORES)
  const { setStore } = useStore()
  const navigate = useNavigate()

  useEffect(() => {
    if (!supabase) return
    supabase
      .from('stores')
      .select('code, name')
      .order('created_at')
      .then(({ data, error }) => {
        if (!error && data?.length) setStores(data)
      })
  }, [])

  const handleSelect = (selected) => {
    setStore(selected)
    navigate('/menu')
  }

  return (
    <div className="screen">
      <h1>매장 선택</h1>
      <p className="subtitle">원가를 확인할 매장을 선택하세요</p>
      <div className="store-list">
        {stores.map((s) => (
          <button
            key={s.code}
            className="store-btn"
            onClick={() => handleSelect(s)}
          >
            {s.name}
          </button>
        ))}
      </div>
    </div>
  )
}
