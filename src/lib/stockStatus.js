// 재고 상태 표시(부족/적음/충분). 매장마다 "적정 재고"를 따로 정해두지 않았으므로,
// 평소 한 번 들어오는 양(입고량 ÷ 입고 횟수)의 절반보다 적게 남으면 "적음"으로 본다.
export const STOCK_STATUS = {
  short: { label: '부족', className: 'status-tag-danger' },
  low: { label: '적음', className: 'status-tag-warn' },
  ok: { label: '충분', className: 'status-tag-ok' },
}

export const LOW_STOCK_RATIO = 0.5

export function stockStatus({ current, received, receiptCount }) {
  if (current < 0) return 'short'
  if (receiptCount > 0 && received > 0) {
    const perDelivery = received / receiptCount
    if (current < perDelivery * LOW_STOCK_RATIO) return 'low'
  }
  return 'ok'
}
