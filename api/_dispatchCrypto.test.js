import { describe, it, expect } from 'vitest'
import { decryptRrn, encryptRrn, rrnHash } from './_dispatchCrypto.js'

describe('주민번호 암호화', () => {
  it('암호화한 값을 같은 비밀값으로만 되돌릴 수 있다', () => {
    const stored = encryptRrn('6503122123456', 'secret-a')
    expect(stored).toMatch(/^v1:/)
    expect(stored).not.toContain('6503122123456')
    expect(decryptRrn(stored, 'secret-a')).toBe('6503122123456')
    expect(decryptRrn(stored, 'secret-b')).toBeNull()
  })
  it('같은 번호도 매번 다른 암호문, 중복 확인값은 같다', () => {
    expect(encryptRrn('6503122123456', 's')).not.toBe(encryptRrn('6503122123456', 's'))
    expect(rrnHash('6503122123456', 's')).toBe(rrnHash('6503122123456', 's'))
    expect(rrnHash('6503122123456', 's')).not.toBe(rrnHash('6503122123457', 's'))
  })
})
