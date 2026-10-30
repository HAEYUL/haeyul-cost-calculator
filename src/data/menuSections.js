// 메인 메뉴 버튼과 PC 화면 왼쪽 메뉴판이 같은 목록을 쓴다.
export const MENU_SECTIONS = [
  {
    title: '입고 · 재고',
    area: 'stock',
    icon: '📦',
    items: [
      { label: '입고 입력', path: '/invoices', icon: '🧾' },
      { label: '재고 관리', path: '/inventory', icon: '📦' },
    ],
  },
  {
    title: '거래처 · 정산',
    area: 'vendor',
    icon: '🤝',
    items: [
      { label: '거래처 관리', path: '/vendors', icon: '🏪' },
      { label: '거래처별 결제액', path: '/vendor-payment-report', icon: '💳' },
      { label: '거래처 물품 입고액', path: '/spending-report', icon: '📥' },
      { label: '단가 추이 조회', path: '/price-trend', icon: '📈' },
      { label: '매장운영결산', path: '/settlement', icon: '📊' },
    ],
  },
  {
    title: '레시피 · 원가',
    area: 'recipe',
    icon: '🍲',
    items: [
      { label: '레시피 입력', path: '/recipes', icon: '📝' },
      { label: '재료 매칭', path: '/ingredient-matching', icon: '🔗' },
      { label: '메뉴별 원가확인', path: '/cost', icon: '💰' },
    ],
  },
  {
    title: '리포트 · 분석',
    area: 'report',
    icon: '📊',
    items: [
      { label: '재주문 알림', path: '/reorder-alerts', icon: '🔔' },
      { label: '소비 패턴 분석', path: '/consumption-pattern', icon: '📉' },
      { label: '품목별 사용 리포트', path: '/usage-report', icon: '📋' },
      { label: '폐기/손실 리포트', path: '/waste-report', icon: '🗑️' },
    ],
  },
  {
    title: '설정 · 기타',
    area: 'settings',
    icon: '⚙️',
    items: [
      { label: '알림 설정', path: '/notification-settings', icon: '🔔' },
      { label: '데이터 백업', path: '/backup', icon: '💾' },
      { label: '직원 근무표', path: '/staff-schedule', icon: '👥' },
      { label: '불편사항/건의사항', path: '/feedback', icon: '💬' },
      { label: '사용법 물어보기', path: '/ask', icon: '❓' },
      { label: '매장 비밀번호 변경', path: '/change-pin', icon: '🔒' },
    ],
  },
]

// 지금 주소가 어느 메뉴 화면(또는 그 하위 화면)인지. 예: /vendors/12 → 거래처 관리
export function activeMenuPath(pathname) {
  let best = null
  for (const section of MENU_SECTIONS) {
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
