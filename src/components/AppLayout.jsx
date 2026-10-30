import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { MENU_SECTIONS, activeMenuPath } from '../data/menuSections'

// 매장에 들어온 뒤의 모든 화면을 감싼다. PC(넓은 화면)에서는 왼쪽에 메뉴판을 띄워 어느 화면에서든
// 바로 다른 메뉴로 갈 수 있게 하고, 휴대폰에서는 메뉴판을 숨겨 지금처럼 한 줄 화면으로 보인다.
export default function AppLayout() {
  const { store, setStore } = useStore()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const activePath = activeMenuPath(pathname)

  return (
    <div className="app-shell">
      {store && (
        <aside className="side-nav" aria-label="전체 메뉴">
          <div className="side-nav-store">
            <strong>{store.name}</strong>
            <button
              type="button"
              className="side-nav-change"
              onClick={() => {
                setStore(null)
                navigate('/')
              }}
            >
              매장 변경
            </button>
          </div>
          <Link to="/menu" className={`side-nav-home${pathname === '/menu' ? ' active' : ''}`}>
            🏠 메인 메뉴
          </Link>
          {MENU_SECTIONS.map((section) => (
            <div key={section.title} className="side-nav-group">
              <p className="side-nav-group-title">{section.title}</p>
              {section.items.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`side-nav-link${activePath === item.path ? ' active' : ''}`}
                  aria-current={activePath === item.path ? 'page' : undefined}
                >
                  <span className="side-nav-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </aside>
      )}
      <div className="app-main">
        <Outlet />
      </div>
    </div>
  )
}
