// 매출 구분(POS). 매장에 POS가 여러 대면 구분별로 따로 입력하고, 매장 매출은 항상 합산한다.
// 나중에 OKPOS를 연결하면 POS마다 이 구분 코드로 들어온다.
export const MAIN_CHANNEL = 'main'

const CHANNELS = {
  haeyul: [
    { code: '1f', label: '1층 매장', icon: '1️⃣' },
    { code: '23f', label: '2,3층 매장', icon: '2️⃣' },
  ],
}

// 매장의 구분 목록. 구분이 없는 매장은 [{ code: 'main' }] 하나.
export function channelsFor(storeCode) {
  return CHANNELS[storeCode] ?? [{ code: MAIN_CHANNEL, label: '', icon: '' }]
}

export const hasChannels = (storeCode) => Boolean(CHANNELS[storeCode])

export function channelLabel(storeCode, code) {
  if (code === MAIN_CHANNEL) return hasChannels(storeCode) ? '구분 없음' : ''
  return channelsFor(storeCode).find((c) => c.code === code)?.label ?? code
}
