import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { activeMenuPath, isPathAllowed, menuSectionsFor } from '../data/menuSections'
import StoreSwitcher from './StoreSwitcher'
import ErrorBoundary from './ErrorBoundary'
import Icon from './Icon'

// 매장에 들어온 뒤의 모든 화면을 감싼다. PC(넓은 화면)에서는 왼쪽에 메뉴판을 띄워 어느 화면에서든
// 바로 다른 메뉴로 갈 수 있게 하고, 휴대폰에서는 메뉴판을 숨겨 지금처럼 한 줄 화면으로 보인다.
// 매니저는 입력 메뉴 3개만 보이고, 다른 주소로 들어오면 메인 메뉴로 돌려보낸다.
export default function AppLayout() {
  const { store, stores, role, isAdmin, setStore, logout } = useStore()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  if (!store || !role) return <Navigate to="/" replace />
  if (!isPathAllowed(role, pathname)) return <Navigate to="/menu" replace />

  const activePath = activeMenuPath(pathname, role)
  const handleLogout = async () => {
    await logout()
    navigate('/')
  }

  return (
    <div className="app-shell">
      <aside className="side-nav" aria-label="전체 메뉴">
        <div className="side-brand">
          <span className="brand-mark">해</span>
          <div>
            <b>해율 경영관리</b>
            <small>HAEYUL</small>
          </div>
        </div>
        <div className="side-nav-store">
          {isAdmin ? (
            <>
              <span className="side-role">메인 관리자 · 보는 매장</span>
              <StoreSwitcher stores={stores} store={store} onChange={setStore} className="side-nav-store-select" />
            </>
          ) : (
            <>
              <span className="side-role">매니저</span>
              <strong>{store.name}</strong>
            </>
          )}
          <button type="button" className="side-nav-change" onClick={handleLogout}>
            <Icon name="out" size={14} /> 로그아웃
          </button>
        </div>
        <Link to="/menu" className={`side-nav-home${pathname === '/menu' ? ' active' : ''}`}>
          <span className="side-nav-icon" aria-hidden="true">
            <Icon name="home" size={17} />
          </span>
          대시보드
        </Link>
        {menuSectionsFor(role).map((section) => (
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
                  <Icon name={item.icon} size={17} />
                </span>
                {item.label}
              </Link>
            ))}
          </div>
        ))}
      </aside>
      <div className="app-main">
        <ErrorBoundary resetKey={pathname}>
          <Outlet key={isAdmin ? store.code : undefined} />
        </ErrorBoundary>
      </div>
    </div>
  )
}
