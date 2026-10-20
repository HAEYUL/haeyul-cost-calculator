import { describe, it, expect } from 'vitest'
import { hashPin, settlementSalt, verifyPinWithLock, HttpError } from './_storeAuth.js'

// stores 한 줄만 들고 있는 가짜 관리자 클라이언트
function fakeAdmin(row) {
  const updates = []
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => ({ data: row, error: null }),
    update: (patch) => {
      updates.push(patch)
      Object.assign(row, patch)
      return { eq: async () => ({ error: null }) }
    },
  }
  return { admin: { from: () => builder }, updates }
}

describe('hashPin', () => {
  it('브라우저 pinHash.js·SQL digest와 같은 sha256("<pin>:<salt>")', () => {
    expect(hashPin('1234', 'haeyul')).toMatch(/^[0-9a-f]{64}$/)
    expect(hashPin('1234', settlementSalt('haeyul'))).not.toBe(hashPin('1234', 'haeyul'))
  })
})

describe('verifyPinWithLock', () => {
  it('맞으면 통과하고 틀린 횟수를 초기화한다', async () => {
    const { admin, updates } = fakeAdmin({ pin_hash: hashPin('1234', 'haeyul'), failed_attempts: 2, locked_until: null })
    await verifyPinWithLock(admin, 'haeyul', '1234')
    expect(updates.at(-1)).toEqual({ failed_attempts: 0, locked_until: null })
  })

  it('틀리면 횟수를 올리고, 5번째에 5분 잠근다', async () => {
    const row = { pin_hash: hashPin('1234', 'haeyul'), failed_attempts: 3, locked_until: null }
    const { admin } = fakeAdmin(row)
    await expect(verifyPinWithLock(admin, 'haeyul', '9999')).rejects.toMatchObject({ status: 401 })
    expect(row.failed_attempts).toBe(4)
    const err = await verifyPinWithLock(admin, 'haeyul', '9999').catch((e) => e)
    expect(err).toBeInstanceOf(HttpError)
    expect(err.status).toBe(423)
    expect(new Date(err.extra.lockedUntil).getTime()).toBeGreaterThan(Date.now())
  })

  it('잠겨 있으면 맞는 비밀번호도 거절한다', async () => {
    const { admin } = fakeAdmin({
      pin_hash: hashPin('1234', 'haeyul'),
      failed_attempts: 0,
      locked_until: new Date(Date.now() + 60000).toISOString(),
    })
    await expect(verifyPinWithLock(admin, 'haeyul', '1234')).rejects.toMatchObject({ status: 423 })
  })

  it('결산 비밀번호는 settlement_ 칸과 결산용 salt로 확인한다', async () => {
    const { admin } = fakeAdmin({
      settlement_pin_hash: hashPin('5678', settlementSalt('haeyul')),
      settlement_failed_attempts: 0,
      settlement_locked_until: null,
    })
    await expect(verifyPinWithLock(admin, 'haeyul', '5678', 'settlement_')).resolves.toBeUndefined()
  })
})
