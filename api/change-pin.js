import { adminClient, hashPin, HttpError, isPin, issueStoreSession, requireStore, sendError } from './_storeAuth.js'

// 매장 PIN 변경. 현재 PIN을 확인한 뒤 새 PIN을 저장하고, 이 매장의 기존 출입증을 모두 취소한다
// (예전 매니저 기기를 막기 위함). 바꾼 사람에게는 새 출입증을 돌려준다.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  try {
    const { storeCode, token } = await requireStore(req)
    const { currentPin, newPin } = req.body ?? {}
    if (!isPin(currentPin) || !isPin(newPin)) throw new HttpError(400, '비밀번호는 4자리 숫자로 입력하세요.')

    const admin = adminClient()
    const { data: row, error } = await admin.from('stores').select('pin_hash').eq('code', storeCode).single()
    if (error) throw new HttpError(500, error.message)
    if (hashPin(currentPin, storeCode) !== row.pin_hash) throw new HttpError(401, '현재 비밀번호가 틀렸습니다.')

    const { error: updateErr } = await admin
      .from('stores')
      .update({ pin_hash: hashPin(newPin, storeCode), failed_attempts: 0, locked_until: null })
      .eq('code', storeCode)
    if (updateErr) throw new HttpError(500, updateErr.message)

    // 이 매장 계정의 모든 기기 로그인을 끊는다(다른 기기는 출입증 만료 시점, 늦어도 1시간 안에 막힌다).
    const { error: signOutErr } = await admin.auth.admin.signOut(token, 'global')
    if (signOutErr) console.error(signOutErr)

    res.status(200).json({ session: await issueStoreSession(admin, storeCode) })
  } catch (err) {
    sendError(res, err)
  }
}
