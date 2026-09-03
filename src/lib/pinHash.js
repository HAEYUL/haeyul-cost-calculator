// 매장 비밀번호(4자리)를 매장 코드로 솔트를 섞어 SHA-256으로 해시한다.
// DB에는 원문 대신 이 해시만 저장한다. Supabase SQL 쪽에서 초기 비밀번호를 넣을 때도
// 같은 방식(digest(pin || ':' || code, 'sha256'))으로 만들어야 값이 일치한다.
export async function hashPin(pin, storeCode) {
  const data = new TextEncoder().encode(`${pin}:${storeCode}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
