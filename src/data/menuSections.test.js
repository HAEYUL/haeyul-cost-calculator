import { describe, it, expect } from 'vitest'
import { isPathAllowed, menuSectionsFor } from './menuSections'

describe('매니저가 들어갈 수 있는 화면', () => {
  it('입력 메뉴 3개와 그 하위 화면만 열린다', () => {
    for (const p of ['/menu', '/invoices', '/invoices/edit/abc', '/stock-count', '/dispatch', '/dispatch/new', '/dispatch/workers/1']) {
      expect(isPathAllowed('manager', p)).toBe(true)
    }
  })
  it('결제·거래처·결산·원가·송금·세무 출력은 막힌다', () => {
    for (const p of ['/vendors', '/vendors/1', '/settlement', '/cost', '/inventory', '/dispatch-payments', '/dispatch-report', '/change-pin', '/admin-pin']) {
      expect(isPathAllowed('manager', p)).toBe(false)
    }
  })
  it('메인 관리자는 모두 열린다', () => {
    expect(isPathAllowed('admin', '/dispatch-payments')).toBe(true)
  })
  it('매니저 메뉴는 3개, 관리자 메뉴 맨 아래는 관리자 비밀번호 변경', () => {
    expect(menuSectionsFor('manager').flatMap((s) => s.items)).toHaveLength(3)
    expect(menuSectionsFor('admin').at(-1).items.at(-1).path).toBe('/admin-pin')
  })
})
