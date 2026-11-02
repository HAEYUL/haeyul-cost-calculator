export const STORES = [
  { code: 'haeyul', name: '해율만두전골' },
  { code: 'gondre', name: '곤드레밥집' },
  { code: 'namwon', name: '정담명가 남원추어탕' },
  { code: 'spare', name: '정담카페' },
]

// 매장 색 (보석 톤): 메인 화면 카드·표 등에서 매장을 구분할 때 쓴다.
export const STORE_COLORS = {
  haeyul: '#7d2433',
  gondre: '#2d5a4a',
  namwon: '#9a6a26',
  spare: '#5a4535',
}
export const storeColor = (code) => STORE_COLORS[code] ?? '#3a4660'

// 매장 소개 (평수·층)
export const STORE_INFO = {
  haeyul: '300평 · 1층 / 2,3층',
  gondre: '170평 · 1층',
  namwon: '180평 · 1층',
  spare: '카페',
}
