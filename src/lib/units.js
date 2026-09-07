// 단위 표시 이름. 재고·명세표 등에서 실제 단위 그대로 보여줄 때 쓴다.
export const UNIT_LABELS = { g: 'g', kg: 'kg', ea: '개', box: '박스', other: '기타' }

// 레시피 재료량 입력칸 placeholder용. g/kg 단위 재료는 항상 g(그램)로 입력받으므로
// kg도 'g'로 표시한다 (costCalc.js의 계산 방식과 짝을 이룬다).
export const RECIPE_UNIT_LABELS = { g: 'g', kg: 'g', ea: '개', box: '박스', other: '기타' }
