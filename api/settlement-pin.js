import {
  adminClient,
  hashPin,
  HttpError,
  isPin,
  requireStore,
  sendError,
  settlementSalt,
  verifyPinWithLock,
} from './_storeAuth.js'

// [매장운영결산] 화면 비밀번호. 비밀번호 값은 서버만 보고, 화면에는 설정 여부·잠금 상태만 알려준다.
// action: 'status' | 'unlock' | 'setup'(처음 설정) | 'change'
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  try {
    const { storeCode } = await requireStore(req)
    const { action, pin, currentPin, newPin } = req.body ?? {}
    const admin = adminClient()
    const { data: row, error } = await admin
      .from('stores')
      .select('settlement_pin_hash, settlement_locked_until')
      .eq('code', storeCode)
      .single()
    if (error) throw new HttpError(500, error.message)
    const salt = settlementSalt(storeCode)

    if (action === 'status') {
      res.status(200).json({ hasPin: Boolean(row.settlement_pin_hash), lockedUntil: row.settlement_locked_until })
      return
    }
    if (action === 'unlock') {
      if (!isPin(pin)) throw new HttpError(400, '비밀번호 4자리를 입력하세요.')
      await verifyPinWithLock(admin, storeCode, pin, 'settlement_')
      res.status(200).json({ ok: true })
      return
    }
    if (action === 'setup') {
      if (row.settlement_pin_hash) throw new HttpError(409, '이미 비밀번호가 설정돼 있어요.')
      if (!isPin(newPin)) throw new HttpError(400, '비밀번호 4자리를 입력하세요.')
    } else if (action === 'change') {
      if (!isPin(currentPin) || !isPin(newPin)) throw new HttpError(400, '비밀번호는 모두 4자리 숫자로 입력하세요.')
      if (hashPin(currentPin, salt) !== row.settlement_pin_hash) throw new HttpError(401, '현재 비밀번호가 틀렸습니다.')
    } else {
      throw new HttpError(400, '알 수 없는 요청이에요.')
    }
    const { error: updateErr } = await admin
      .from('stores')
      .update({ settlement_pin_hash: hashPin(newPin, salt), settlement_failed_attempts: 0, settlement_locked_until: null })
      .eq('code', storeCode)
    if (updateErr) throw new HttpError(500, updateErr.message)
    res.status(200).json({ ok: true })
  } catch (err) {
    sendError(res, err)
  }
}
