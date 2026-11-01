import {
  adminClient,
  adminSettingsError,
  hashAdminPin,
  hashPin,
  HttpError,
  isAdminPin,
  isPin,
  issueAdminSession,
  issueStoreSession,
  requireAdmin,
  requireStore,
  sendError,
  verifyAdminPinWithLock,
} from './_storeAuth.js'

// 메인 관리자 로그인과 비밀번호.
// action:
//   'status'      비밀번호가 설정됐는지, 잠겼는지 (로그인 전)
//   'setup'       처음 들어갈 때 비밀번호 설정 → 바로 관리자 출입증 (아직 설정 안 됐을 때만)
//   'login'       비밀번호 확인 → 관리자 출입증 (4개 매장 전부)
//   'change'      관리자 비밀번호 변경 (관리자만, 현재 비밀번호 확인)
//   'setStorePin' 매장(매니저) 비밀번호 변경 (관리자만). 그 매장의 기존 매니저 로그인은 모두 끊긴다.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  try {
    const { action } = req.body ?? {}
    const admin = adminClient()

    if (action === 'status') {
      const { data, error } = await admin.from('admin_settings').select('pin_hash, locked_until').eq('id', 1).maybeSingle()
      if (error) throw new HttpError(500, adminSettingsError(error))
      res.status(200).json({ hasPin: Boolean(data?.pin_hash), lockedUntil: data?.locked_until ?? null })
      return
    }

    if (action === 'setup') {
      const { newPin } = req.body
      if (!isAdminPin(newPin)) throw new HttpError(400, '관리자 비밀번호는 숫자 6~12자리로 정해주세요.')
      // 아직 비어 있을 때만 채운다(동시에 두 곳에서 설정해도 먼저 한 쪽만 성공).
      const { data, error } = await admin
        .from('admin_settings')
        .update({ pin_hash: hashAdminPin(newPin), failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString() })
        .eq('id', 1)
        .is('pin_hash', null)
        .select('id')
      if (error) throw new HttpError(500, adminSettingsError(error))
      if (!data?.length) throw new HttpError(409, '이미 관리자 비밀번호가 설정돼 있어요. 비밀번호로 로그인해주세요.')
      res.status(200).json({ session: await issueAdminSession(admin) })
      return
    }

    if (action === 'login') {
      const { pin } = req.body
      if (!isAdminPin(pin)) throw new HttpError(400, '관리자 비밀번호(숫자 6~12자리)를 입력하세요.')
      await verifyAdminPinWithLock(admin, pin)
      res.status(200).json({ session: await issueAdminSession(admin) })
      return
    }

    if (action === 'change') {
      const { token } = await requireAdmin(req)
      const { currentPin, newPin } = req.body
      if (!isAdminPin(currentPin) || !isAdminPin(newPin)) {
        throw new HttpError(400, '비밀번호는 숫자 6~12자리로 입력하세요.')
      }
      await verifyAdminPinWithLock(admin, currentPin)
      const { error } = await admin
        .from('admin_settings')
        .update({ pin_hash: hashAdminPin(newPin), failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString() })
        .eq('id', 1)
      if (error) throw new HttpError(500, adminSettingsError(error))
      // 다른 기기의 관리자 로그인은 모두 끊고, 이 기기는 새 출입증으로 계속 쓴다.
      const { error: signOutErr } = await admin.auth.admin.signOut(token, 'global')
      if (signOutErr) console.error(signOutErr)
      res.status(200).json({ session: await issueAdminSession(admin) })
      return
    }

    if (action === 'setStorePin') {
      await requireAdmin(req)
      const { storeCode } = await requireStore(req)
      const { newPin } = req.body
      if (!isPin(newPin)) throw new HttpError(400, '매장 비밀번호는 4자리 숫자로 입력하세요.')
      const { error } = await admin
        .from('stores')
        .update({ pin_hash: hashPin(newPin, storeCode), failed_attempts: 0, locked_until: null })
        .eq('code', storeCode)
      if (error) throw new HttpError(500, error.message)
      // 그 매장 계정의 모든 기기 로그인을 끊는다(예전 매니저 기기는 늦어도 1시간 안에 막힌다).
      const storeSession = await issueStoreSession(admin, storeCode)
      const { error: signOutErr } = await admin.auth.admin.signOut(storeSession.access_token, 'global')
      if (signOutErr) console.error(signOutErr)
      res.status(200).json({ ok: true })
      return
    }

    throw new HttpError(400, '알 수 없는 요청이에요.')
  } catch (err) {
    sendError(res, err)
  }
}
