import { adminClient, HttpError, isPin, issueStoreSession, sendError, verifyPinWithLock } from './_storeAuth.js'

// 매장 PIN을 서버에서 확인하고, 맞으면 그 매장 출입증(세션)을 돌려준다.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  try {
    const { storeCode, pin } = req.body ?? {}
    if (typeof storeCode !== 'string' || !storeCode) throw new HttpError(400, '매장을 선택하세요.')
    if (!isPin(pin)) throw new HttpError(400, '비밀번호 4자리를 입력하세요.')
    const admin = adminClient()
    await verifyPinWithLock(admin, storeCode, pin)
    res.status(200).json({ session: await issueStoreSession(admin, storeCode) })
  } catch (err) {
    sendError(res, err)
  }
}
