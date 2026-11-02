// 메인 메뉴 버튼과 PC 화면 왼쪽 메뉴판이 같은 목록을 쓴다.
// MENU_SECTIONS = 메인 관리자(전체 메뉴), MANAGER_MENU_SECTIONS = 매니저(메뉴 5개).
export const MENU_SECTIONS = [
  {
    title: '입고 · 재고',
    area: 'stock',
    icon: 'box',
    items: [
      { label: '입고 입력', path: '/invoices', icon: 'receipt' },
      { label: '재고 관리', path: '/inventory', icon: 'box' },
      { label: '실재고 조사', path: '/stock-count', icon: 'check' },
    ],
  },
  {
    title: '거래처 · 정산',
    area: 'vendor',
    icon: 'hand',
    items: [
      { label: '거래처 관리', path: '/vendors', icon: 'store' },
      { label: '거래처별 결제액', path: '/vendor-payment-report', icon: 'card' },
      { label: '거래처 물품 입고액', path: '/spending-report', icon: 'inbox' },
      { label: '단가 추이 조회', path: '/price-trend', icon: 'trend' },
      { label: '매장운영결산', path: '/settlement', icon: 'chart' },
      { label: '통합 매출·결산', path: '/consolidated', icon: 'sum' },
    ],
  },
  {
    title: '인력 · 파출',
    area: 'dispatch',
    icon: 'user',
    items: [
      { label: '파출 관리', path: '/dispatch', icon: 'user' },
      { label: '파출비 송금 관리', path: '/dispatch-payments', icon: 'send' },
      { label: '파출 세무 출력', path: '/dispatch-report', icon: 'print' },
    ],
  },
  {
    title: '레시피 · 원가',
    area: 'recipe',
    icon: 'book',
    items: [
      { label: '레시피 입력', path: '/recipes', icon: 'book' },
      { label: '재료 매칭', path: '/ingredient-matching', icon: 'link' },
      { label: '메뉴별 원가확인', path: '/cost', icon: 'coin' },
    ],
  },
  {
    title: '리포트 · 분석',
    area: 'report',
    icon: 'chart',
    items: [
      { label: '재주문 알림', path: '/reorder-alerts', icon: 'bell' },
      { label: '소비 패턴 분석', path: '/consumption-pattern', icon: 'wave' },
      { label: '품목별 사용 리포트', path: '/usage-report', icon: 'list' },
      { label: '폐기/손실 리포트', path: '/waste-report', icon: 'trash' },
    ],
  },
  {
    title: '설정 · 기타',
    area: 'settings',
    icon: 'settings',
    items: [
      { label: '매니저 전달사항', path: '/notices', icon: 'mega' },
      { label: '알림 설정', path: '/notification-settings', icon: 'bell' },
      { label: '데이터 백업', path: '/backup', icon: 'save' },
      { label: '직원 근무표', path: '/staff-schedule', icon: 'users' },
      { label: '불편사항/건의사항', path: '/feedback', icon: 'chat' },
      { label: '사용법 물어보기', path: '/ask', icon: 'help' },
      { label: '매장(매니저) 비밀번호 변경', path: '/change-pin', icon: 'lock' },
      { label: '관리자 비밀번호 변경', path: '/admin-pin', icon: 'key' },
    ],
  },
]

export const MANAGER_MENU_SECTIONS = [
  {
    title: '입고 · 재고',
    area: 'stock',
    icon: 'box',
    items: [
      { label: '입고 입력', path: '/invoices', icon: 'receipt' },
      { label: '실재고 조사', path: '/stock-count', icon: 'check' },
    ],
  },
  {
    title: '거래처',
    area: 'vendor',
    icon: 'hand',
    items: [
      { label: '거래처 관리', path: '/vendors', icon: 'store' },
      { label: '단가 추이 조회', path: '/price-trend', icon: 'trend' },
    ],
  },
  {
    title: '인력',
    area: 'dispatch',
    icon: 'user',
    items: [{ label: '파출 관리', path: '/dispatch', icon: 'user' }],
  },
]

// 매니저 메뉴 안에 있어도 메인 관리자만 쓰는 하위 화면 (장부 시작 설정·부가세 점검)
const ADMIN_ONLY_SUBPATHS = ['/vendors/ledger-setup', '/vendors/vat-check']

export function menuSectionsFor(role) {
  return role === 'admin' ? MENU_SECTIONS : MANAGER_MENU_SECTIONS
}

// 매니저가 들어갈 수 있는 주소: 메인 메뉴, 매니저 메뉴 5개와 그 하위 화면(명세표 수정, 거래처 상세, 파출 등록·개인 페이지)
export function isPathAllowed(role, pathname) {
  if (role === 'admin') return true
  if (pathname === '/menu' || pathname === '/notices' || pathname.startsWith('/notices/')) return true
  if (ADMIN_ONLY_SUBPATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return false
  return MANAGER_MENU_SECTIONS.some((section) =>
    section.items.some((item) => pathname === item.path || pathname.startsWith(`${item.path}/`)),
  )
}

// 지금 주소가 어느 메뉴 화면(또는 그 하위 화면)인지. 예: /vendors/12 → 거래처 관리
export function activeMenuPath(pathname, role = 'admin') {
  let best = null
  for (const section of menuSectionsFor(role)) {
    for (const item of section.items) {
      if (pathname === item.path || pathname.startsWith(`${item.path}/`)) {
        if (!best || item.path.length > best.length) best = item.path
      }
    }
  }
  // 단가 알림은 입고 입력 화면에서 들어가는 하위 화면이다.
  if (!best && pathname.startsWith('/price-alerts')) best = '/invoices'
  return best
}
