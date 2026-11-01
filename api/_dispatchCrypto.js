import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto'

// 파출 인력 주민등록번호 암호화(AES-256-GCM). 키는 서버 비밀값에서 만들고 어디에도 저장하지 않는다.
// 저장 형식: "v1:" + base64(iv 12바이트 | 인증태그 16바이트 | 암호문)

const keyFrom = (secret) => createHash('sha256').update(`dispatch-rrn:${secret}`).digest()

export function encryptRrn(digits, secret) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv)
  const encrypted = Buffer.concat([cipher.update(digits, 'utf8'), cipher.final()])
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64')}`
}

export function decryptRrn(stored, secret) {
  if (!stored?.startsWith('v1:')) return null
  try {
    const raw = Buffer.from(stored.slice(3), 'base64')
    const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), raw.subarray(0, 12))
    decipher.setAuthTag(raw.subarray(12, 28))
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

// 같은 주민번호인지 확인용(복원할 수 없는 값)
export function rrnHash(digits, secret) {
  return createHmac('sha256', secret).update(`rrn:${digits}`).digest('hex')
}
