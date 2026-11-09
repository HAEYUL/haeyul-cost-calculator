import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { menuSectionsFor } from '../data/menuSections'
import AdminOverview from '../components/AdminOverview'
import ManagerNoticeBox from '../components/ManagerNoticeBox'
import ManagerOverview from '../components/ManagerOverview'
import ManagerReorderCard from '../components/ManagerReorderCard'
import StaffStatusCard from '../components/staff/StaffStatusCard'
import Icon from '../components/Icon'
import { eyebrowDate, nowLabel } from '../lib/storeSummary'

// 메인 화면. 메인 관리자는 전체 매장 숫자 + 오늘의 매장 현황(AdminOverview), 매니저는 내 매장 숫자·알림.
export default function MainMenuScreen() {
  const { store, stores, role, isAdmin, setStore, logout } = useStore()
  const navigate = useNavigate()

  if (!store) return null

  return (
    <div className={`screen screen-menu${isAdmin ? '' : ' screen-menu-manager'}`}>
      <header className="page-hero">
        <div>
          <div className="eyebrow">{eyebrowDate()}</div>
          <h1 className="hero-title">{isAdmin ? '안녕하세요, 사장님' : store.name}</h1>
          <p className="hero-sub">
            {isAdmin ? `${nowLabel()} · ${stores.length}개 매장 현황` : `매니저 · ${nowLabel()}`}
          </p>
        </div>
        <div className="hero-actions">
          {isAdmin && (
            <div className="seg-tabs" role="tablist" aria-label="보는 매장">
              {stores.map((s) => (
                <button
                  key={s.code}
                  type="button"
                  role="tab"
                  aria-selected={s.code === store.code}
                  className={s.code === store.code ? 'on' : ''}
                  onClick={() => setStore(s)}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className="logout-btn"
            onClick={async () => {
              await logout()
              navigate('/')
            }}
          >
            <Icon name="out" size={16} /> 로그아웃
          </button>
        </div>
      </header>

      {!isAdmin && supabase && <ManagerOverview storeCode={store.code} />}
      {!isAdmin && supabase && <StaffStatusCard storeCode={store.code} mode="manager" />}
      {!isAdmin && supabase && <ManagerReorderCard storeCode={store.code} />}
      {!isAdmin && supabase && <ManagerNoticeBox storeCode={store.code} />}

      {isAdmin && supabase && (
        <AdminOverview
          stores={stores}
          onGo={(s, path) => {
            setStore(s)
            navigate(path)
          }}
        />
      )}

      <h2 className="section-heading">{isAdmin ? '전체 메뉴' : '메뉴'}</h2>
      <div className={`menu-list${isAdmin ? '' : ' menu-list-manager'}`}>
        {menuSectionsFor(role).map((section) => (
          <div key={section.title} className={`menu-group menu-group-${section.area}`}>
            <p className="menu-group-title">
              <Icon name={section.icon} size={16} /> {section.title}
            </p>
            <div className="menu-group-items">
              {section.items.map((item) => (
                <button
                  key={item.path}
                  className="menu-btn"
                  onClick={() => navigate(item.path)}
                >
                  <span className="menu-btn-icon" aria-hidden="true">
                    <Icon name={item.icon} size={19} />
                  </span>
                  <span className="menu-btn-label">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
