import { createHash, createHmac } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

// 매장 로그인(서버 전용). 매장 PIN은 서버에서만 확인하고, 맞으면 그 매장 전용 Supabase 계정으로 로그인한
// 세션(출입증)을 돌려준다. 데이터베이스는 출입증에 적힌 매장(app_metadata.store_code)의 자료만 열어준다.
// 매장 계정의 비밀번호는 STORE_AUTH_SECRET으로 만든 값이라 매니저도 모르고, 어디에도 저장하지 않는다.

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

// 매장 계정이 없으면 만들고, 비밀번호·매장 코드가 어긋나 있으면 맞춘다.
async function ensureStoreUser(admin, storeCode) {
  const email = storeEmail(storeCode)
  const password = storePassword(storeCode)
  const existing = await findStoreUser(admin, email)
  if (!existing) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { store_code: storeCode },
    })
    if (error) throw new HttpError(500, error.message)
    return data.user
  }
  if (existing.app_metadata?.store_code !== storeCode) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      app_metadata: { ...existing.app_metadata, store_code: storeCode },
    })
    if (error) throw new HttpError(500, error.message)
  }
  return existing
}

// 매장 계정으로 로그인한 새 세션(출입증)을 만든다.
export async function issueStoreSession(admin, storeCode) {
  const user = await ensureStoreUser(admin, storeCode)
  const signIn = () =>
    anonClient().auth.signInWithPassword({ email: storeEmail(storeCode), password: storePassword(storeCode) })
  let { data, error } = await signIn()
  if (error) {
    // STORE_AUTH_SECRET을 바꾼 경우 등: 비밀번호를 다시 맞추고 한 번 더 시도한다.
    const { error: updateErr } = await admin.auth.admin.updateUserById(user.id, { password: storePassword(storeCode) })
    if (updateErr) throw new HttpError(500, updateErr.message)
    ;({ data, error } = await signIn())
    if (error) throw new HttpError(500, error.message)
  }
  const { access_token, refresh_token, expires_at } = data.session
  return { access_token, refresh_token, expires_at }
}

// 요청의 출입증(Authorization: Bearer ...)을 확인하고 매장 코드를 돌려준다.
export async function requireStore(req) {
  assertConfigured()
  const header = req.headers?.authorization || req.headers?.Authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) throw new HttpError(401, '로그인이 필요해요. 매장을 다시 선택해주세요.')
  const { data, error } = await adminClient().auth.getUser(token)
  const storeCode = data?.user?.app_metadata?.store_code
  if (error || !storeCode) throw new HttpError(401, '로그인이 만료됐어요. 매장을 다시 선택해주세요.')
  return { storeCode, token }
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

// AI 기능 등 기존 API를 로그인한 매장만 쓸 수 있게 감싼다.
export function withStoreAuth(handler) {
  return async (req, res) => {
    try {
      await requireStore(req)
    } catch (err) {
      sendError(res, err)
      return
    }
    return handler(req, res)
  }
}
