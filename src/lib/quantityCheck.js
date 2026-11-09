// 명세서 입력 때 수량이 평소보다 지나치게 많으면 확인하라고 알려준다.
// 사진 인식에서 0이 하나 더 붙거나(60 → 600) 과다 주문한 경우를 저장 전에 잡기 위해서다.
// 이런 오류는 재고·재주문 계산을 모두 틀리게 만든다.
export const UNUSUAL_QTY_FACTOR = 3
const MIN_HISTORY = 3

// history: 같은 물품명+단위의 과거 입고 수량 목록. 평소 수량(평균)과 몇 배인지 돌려준다. 문제 없으면 null.
export function unusualQuantity(history, qty) {
  const q = Number(qty)
  if (!(q > 0)) return null
  const past = history.map(Number).filter((n) => n > 0)
  if (past.length < MIN_HISTORY) return null
  const usual = past.reduce((s, n) => s + n, 0) / past.length
  const factor = q / usual
  return factor >= UNUSUAL_QTY_FACTOR ? { usual, factor } : null
}
