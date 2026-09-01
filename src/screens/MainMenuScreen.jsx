import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'

const MENU_ITEMS = [
  { label: '입고 입력', path: '/invoices' },
  { label: '거래처 관리', path: '/vendors' },
  { label: '재고 관리', path: '/inventory' },
  { label: '레시피 입력', path: '/recipes' },
  { label: '재료 매칭', path: '/ingredient-matching' },
  { label: '원가 확인', path: '/cost' },
]

export default function MainMenuScreen() {
  const { store, setStore } = useStore()
  const navigate = useNavigate()

  useEffect(() => {
    if (!store) navigate('/', { replace: true })
  }, [store, navigate])

  if (!store) return null

  return (
    <div className="screen">
      <div className="store-badge">{store.name}</div>
      <div className="menu-list">
        {MENU_ITEMS.map((item) => (
          <button
            key={item.path}
            className="menu-btn"
            onClick={() => navigate(item.path)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="link-btn"
        onClick={() => {
          setStore(null)
          navigate('/')
        }}
      >
        매장 변경
      </button>
    </div>
  )
}
