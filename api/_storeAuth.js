import { createHash, createHmac } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

// 매장 로그인(서버 전용). 매장 PIN은 서버에서만 확인하고, 맞으면 그 매장 전용 Supabase 계정으로 로그인한
// 세션(출입증)을 돌려준다. 데이터베이스는 출입증에 적힌 매장(app_metadata.store_code)의 자료만 열어준다.
// 매장 계정의 비밀번호는 STORE_AUTH_SECRET으로 만든 값이라 매니저도 모르고, 어디에도 저장하지 않는다.
//
// 출입증은 두 종류다.
//   매니저(매장 PIN):   app_metadata = { store_code, role: 'manager' }  → 자기 매장의 입력 화면만
//   메인 관리자:        app_metadata = { role: 'admin' }               → 4개 매장 전부 (supabase/roles.sql)

export const MAX_ATTEMPTS = 5
export const LOCK_MINUTES = 5

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const STORE_AUTH_SECRET = process.env.STORE_AUTH_SECRET

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message)
    this.status = status
    this.extra = extra
  }
}

// 서버 비밀값(STORE_AUTH_SECRET). 파출 주민번호 암호화에도 쓰므로 한 번 정하면 바꾸지 않는다.
export function serverSecret() {
  assertConfigured()
  return STORE_AUTH_SECRET
}

export function isConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SERVICE_ROLE_KEY && STORE_AUTH_SECRET)
}

function assertConfigured() {
  if (!isConfigured()) {
    throw new HttpError(
      503,
      '서버 보안 설정이 아직 안 됐어요. Vercel에 SUPABASE_SERVICE_ROLE_KEY와 STORE_AUTH_SECRET을 넣고 다시 배포해주세요.',
    )
  }
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false } }

export function adminClient() {
  assertConfigured()
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, noSession)
}

function anonClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, noSession)
}

// 클라이언트 pinHash.js와 같은 방식: sha256("<pin>:<salt>")
export function hashPin(pin, salt) {
  return createHash('sha256').update(`${pin}:${salt}`).digest('hex')
}

export const settlementSalt = (storeCode) => `${storeCode}:settlement`

export function isPin(value) {
  return typeof value === 'string' && /^\d{4}$/.test(value)
}

// 메인 관리자 비밀번호: 숫자 6~12자리
export function isAdminPin(value) {
  return typeof value === 'string' && /^\d{6,12}$/.test(value)
}

export const ROLE_MANAGER = 'manager'
export const ROLE_ADMIN = 'admin'

const storeEmail = (storeCode) => `store-${storeCode}@stores.haeyul.invalid`
const storePassword = (storeCode) => createHmac('sha256', STORE_AUTH_SECRET).update(`store:${storeCode}`).digest('hex')

async function findStoreUser(admin, email) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new HttpError(500, error.message)
    const found = data.users.find((u) => u.email === email)
    if (found) return found
    if (data.users.length < 200) return null
  }
  return null
}

const ADMIN_EMAIL = 'admin@stores.haeyul.invalid'
const adminPassword = () => createHmac('sha256', STORE_AUTH_SECRET).update('admin-account').digest('hex')

// 계정이 없으면 만들고, 비밀번호·app_metadata가 어긋나 있으면 맞춘다.
async function ensureUser(admin, email, appMetadata) {
  const existing = await findStoreUser(admin, email)
  if (!existing) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: appMetadata.role === ROLE_ADMIN ? adminPassword() : storePassword(appMetadata.store_code),
      email_confirm: true,
      app_metadata: appMetadata,
    })
    if (error) throw new HttpError(500, error.message)
    return data.user
  }
  const current = existing.app_metadata ?? {}
  const mismatched = Object.entries(appMetadata).some(([k, v]) => current[k] !== v)
  if (mismatched) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      app_metadata: { ...current, ...appMetadata },
    })
    if (error) throw new HttpError(500, error.message)
  }
  return existing
}

// 계정으로 로그인한 새 세션(출입증)을 만든다.
async function issueSession(admin, { email, password, appMetadata }) {
  const user = await ensureUser(admin, email, appMetadata)
  const signIn = () => anonClient().auth.signInWithPassword({ email, password })
  let { data, error } = await signIn()
  if (error) {
    // STORE_AUTH_SECRET을 바꾼 경우 등: 비밀번호를 다시 맞추고 한 번 더 시도한다.
    const { error: updateErr } = await admin.auth.admin.updateUserById(user.id, { password })
    if (updateErr) throw new HttpError(500, updateErr.message)
    ;({ data, error } = await signIn())
    if (error) throw new HttpError(500, error.message)
  }
  const { access_token, refresh_token, expires_at } = data.session
  return { access_token, refresh_token, expires_at }
}

// 매장 PIN으로 들어온 매니저의 출입증 (그 매장 1곳)
export function issueStoreSession(admin, storeCode) {
  return issueSession(admin, {
    email: storeEmail(storeCode),
    password: storePassword(storeCode),
    appMetadata: { store_code: storeCode, role: ROLE_MANAGER },
  })
}

// 메인 관리자 출입증 (4개 매장 전부)
export function issueAdminSession(admin) {
  return issueSession(admin, {
    email: ADMIN_EMAIL,
    password: adminPassword(),
    appMetadata: { role: ROLE_ADMIN },
  })
}

// 메인 관리자 비밀번호 암호값. DB가 새어도 짧은 숫자를 맞춰보기 어렵게 서버 비밀값을 섞는다.
export function hashAdminPin(pin) {
  return createHmac('sha256', STORE_AUTH_SECRET).update(`admin-pin:${pin}`).digest('hex')
}

// 출입증의 종류. role이 없는 예전 매장 출입증은 매니저로 본다.
export function roleOf(appMetadata) {
  if (appMetadata?.role === ROLE_ADMIN) return ROLE_ADMIN
  if (appMetadata?.store_code) return ROLE_MANAGER
  return null
}

// 요청의 출입증(Authorization: Bearer ...)을 확인하고 { role, storeCode(매니저만), token }을 돌려준다.
export async function requireAuth(req) {
  assertConfigured()
  const header = req.headers?.authorization || req.headers?.Authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) throw new HttpError(401, '로그인이 필요해요. 매장을 다시 선택해주세요.')
  const { data, error } = await adminClient().auth.getUser(token)
  const meta = data?.user?.app_metadata
  const role = error ? null : roleOf(meta)
  if (!role) throw new HttpError(401, '로그인이 만료됐어요. 매장을 다시 선택해주세요.')
  return { role, storeCode: role === ROLE_MANAGER ? meta.store_code : null, token }
}

// 매장 하나에 대한 요청. 매니저는 자기 매장, 메인 관리자는 요청에 담긴 매장(body.storeCode).
export async function requireStore(req) {
  const auth = await requireAuth(req)
  if (auth.role === ROLE_MANAGER) return auth
  const storeCode = req.body?.storeCode
  if (typeof storeCode !== 'string' || !/^[a-z0-9_-]{1,32}$/i.test(storeCode)) {
    throw new HttpError(400, '매장을 선택하세요.')
  }
  const { data, error } = await adminClient().from('stores').select('code').eq('code', storeCode).maybeSingle()
  if (error) throw new HttpError(500, error.message)
  if (!data) throw new HttpError(404, '매장을 찾을 수 없어요.')
  return { ...auth, storeCode }
}

// 메인 관리자만 쓰는 요청
export async function requireAdmin(req) {
  const auth = await requireAuth(req)
  if (auth.role !== ROLE_ADMIN) throw new HttpError(403, '메인 관리자만 할 수 있어요.')
  return auth
}

// 메인 관리자 비밀번호 확인 + 5회 틀리면 5분 잠금
export async function verifyAdminPinWithLock(admin, pin) {
  const { data: row, error } = await admin
    .from('admin_settings')
    .select('pin_hash, failed_attempts, locked_until')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw new HttpError(500, adminSettingsError(error))
  if (!row?.pin_hash) throw new HttpError(409, '관리자 비밀번호가 아직 설정되지 않았어요.', { notSet: true })

  const lockedUntil = row.locked_until ? new Date(row.locked_until).getTime() : 0
  if (lockedUntil > Date.now()) {
    throw new HttpError(423, '비밀번호를 여러 번 틀려 잠겼어요.', { lockedUntil: row.locked_until })
  }
  if (hashAdminPin(pin) === row.pin_hash) {
    if (row.failed_attempts || row.locked_until) {
      await admin.from('admin_settings').update({ failed_attempts: 0, locked_until: null }).eq('id', 1)
    }
    return
  }
  const nextAttempts = (row.failed_attempts ?? 0) + 1
  const shouldLock = nextAttempts >= MAX_ATTEMPTS
  const nextLockedUntil = shouldLock ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString() : null
  await admin
    .from('admin_settings')
    .update({ failed_attempts: shouldLock ? 0 : nextAttempts, locked_until: nextLockedUntil })
    .eq('id', 1)
  if (shouldLock) throw new HttpError(423, '비밀번호를 여러 번 틀려 잠겼어요.', { lockedUntil: nextLockedUntil })
  throw new HttpError(401, `비밀번호가 틀렸습니다 (${nextAttempts}/${MAX_ATTEMPTS})`)
}

// admin_settings 표가 없으면(roles.sql 실행 전) 알아보기 쉬운 안내로 바꾼다.
export function adminSettingsError(error) {
  if (/admin_settings/.test(error?.message ?? '') || error?.code === '42P01' || error?.code === 'PGRST205') {
    return '데이터베이스 설정이 아직 안 됐어요. Supabase에서 supabase/roles.sql을 실행해주세요.'
  }
  return error?.message || '서버 오류가 발생했어요'
}

// 비밀번호 확인 + 5회 틀리면 5분 잠금. column 접두사: '' (매장 진입) 또는 'settlement_' (결산).
export async function verifyPinWithLock(admin, storeCode, pin, prefix = '') {
  const hashCol = `${prefix}pin_hash`
  const attemptsCol = `${prefix}failed_attempts`
  const lockedCol = `${prefix}locked_until`
  const { data: row, error } = await admin
    .from('stores')
    .select(`${hashCol}, ${attemptsCol}, ${lockedCol}`)
    .eq('code', storeCode)
    .maybeSingle()
  if (error) throw new HttpError(500, error.message)
  if (!row) throw new HttpError(404, '매장을 찾을 수 없어요.')
  if (!row[hashCol]) throw new HttpError(409, '비밀번호가 아직 설정되지 않았어요.', { notSet: true })

  const lockedUntil = row[lockedCol] ? new Date(row[lockedCol]).getTime() : 0
  if (lockedUntil > Date.now()) {
    throw new HttpError(423, '비밀번호를 여러 번 틀려 잠겼어요.', { lockedUntil: row[lockedCol] })
  }

  const salt = prefix === 'settlement_' ? settlementSalt(storeCode) : storeCode
  if (hashPin(pin, salt) === row[hashCol]) {
    if (row[attemptsCol] || row[lockedCol]) {
      await admin.from('stores').update({ [attemptsCol]: 0, [lockedCol]: null }).eq('code', storeCode)
    }
    return
  }

  const nextAttempts = (row[attemptsCol] ?? 0) + 1
  const shouldLock = nextAttempts >= MAX_ATTEMPTS
  const nextLockedUntil = shouldLock ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString() : null
  await admin
    .from('stores')
    .update({ [attemptsCol]: shouldLock ? 0 : nextAttempts, [lockedCol]: nextLockedUntil })
    .eq('code', storeCode)
  if (shouldLock) throw new HttpError(423, '비밀번호를 여러 번 틀려 잠겼어요.', { lockedUntil: nextLockedUntil })
  throw new HttpError(401, `비밀번호가 틀렸습니다 (${nextAttempts}/${MAX_ATTEMPTS})`)
}

export function sendError(res, err) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, ...err.extra })
    return
  }
  console.error(err)
  res.status(500).json({ error: err?.message || '서버 오류가 발생했어요' })
}

// AI 기능 등 기존 API를 로그인한 사람(매니저·메인 관리자)만 쓸 수 있게 감싼다.
export function withStoreAuth(handler) {
  return async (req, res) => {
    try {
      await requireAuth(req)
    } catch (err) {
      sendError(res, err)
      return
    }
    return handler(req, res)
  }
}
