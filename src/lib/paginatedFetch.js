// Supabase(PostgREST)는 한 번 조회할 때 최대 1,000줄까지만 돌려준다(프로젝트 기본 설정).
// 화면들이 "이 매장 기록 전부" 식으로 한 번만 조회하면 1,000줄 뒤의 기록이 경고 없이 빠져서,
// 최근 입고 물품·거래처가 재고관리/단가추이에서 사라지고 재고 수량도 틀려졌다.
//
// 이 fetch를 Supabase 클라이언트에 끼우면, 범위를 직접 정하지 않은 모든 목록 조회(GET /rest/v1/...)를
// 1,000줄씩 끝까지 이어 받아 한 번에 돌려준다. 화면 코드는 바꾸지 않아도 되고, 앞으로 추가하는 조회도 자동 적용된다.
// - .limit()/.range()/.single() 처럼 범위·건수를 직접 정한 조회, 저장/수정/삭제, rpc, storage는 건드리지 않는다.
// - 1,000줄이 안 되면 첫 응답을 그대로 돌려줘서 지금과 똑같이 동작한다(요청 1번).
// - 1,000줄이 꽉 차면 페이지마다 순서가 섞이지 않도록 id 순서를 덧붙여 처음부터 다시 나눠 받는다.

export const PAGE_SIZE = 1000
// 안전장치: 한 번 조회에 최대 PAGE_SIZE * MAX_PAGES 줄(20만 줄)까지.
const MAX_PAGES = 200

function headerValue(headers, name) {
  if (!headers) return null
  return new Headers(headers).get(name)
}

export function shouldPaginate(urlStr, init = {}) {
  const method = (init.method ?? 'GET').toUpperCase()
  if (method !== 'GET') return false
  let url
  try {
    url = new URL(urlStr)
  } catch {
    return false
  }
  if (!url.pathname.includes('/rest/v1/') || url.pathname.includes('/rest/v1/rpc/')) return false
  if (url.searchParams.has('limit') || url.searchParams.has('offset')) return false
  if (headerValue(init.headers, 'Range')) return false
  const accept = headerValue(init.headers, 'Accept') ?? ''
  // single()(한 줄), csv(), explain()은 목록이 아니므로 그대로 보낸다.
  if (accept.includes('vnd.pgrst.object') || accept.includes('text/csv') || accept.includes('vnd.pgrst.plan')) return false
  return true
}

function pageUrl(baseUrl, offset) {
  const url = new URL(baseUrl)
  url.searchParams.set('limit', String(PAGE_SIZE))
  url.searchParams.set('offset', String(offset))
  return url.toString()
}

// 기존 정렬 뒤에 id 순서를 덧붙여, 같은 값이 많은 정렬(예: created_at)에서도 페이지 경계가 흔들리지 않게 한다.
function withStableOrder(urlStr) {
  const url = new URL(urlStr)
  const order = url.searchParams.get('order')
  if (!order) url.searchParams.set('order', 'id.asc')
  else if (!order.split(',').some((part) => part.split('.')[0] === 'id')) url.searchParams.set('order', `${order},id.asc`)
  return url.toString()
}

function totalFromContentRange(res) {
  const total = res.headers.get('content-range')?.split('/')[1]
  return total && total !== '*' ? total : null
}

function combinedResponse(rows, lastRes) {
  const headers = new Headers(lastRes.headers)
  headers.delete('content-length')
  headers.delete('content-encoding')
  const total = totalFromContentRange(lastRes) ?? '*'
  headers.set('content-range', rows.length > 0 ? `0-${rows.length - 1}/${total}` : `*/${total}`)
  headers.set('content-type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(rows), { status: 200, statusText: 'OK', headers })
}

async function readRows(res) {
  const rows = await res.clone().json()
  return Array.isArray(rows) ? rows : null
}

// startRows/startOffset: 이미 받아 둔 앞부분이 있으면 그 다음부터 이어 받는다.
async function fetchRest(baseFetch, baseUrl, init, startRows, startOffset) {
  const all = [...startRows]
  let offset = startOffset
  let lastRes = null
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const res = await baseFetch(pageUrl(baseUrl, offset), init)
    if (!res.ok) return { error: res }
    const rows = await readRows(res)
    if (!rows) return { error: res }
    lastRes = res
    all.push(...rows)
    if (rows.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
  return { rows: all, lastRes }
}

// 나눠 받는 사이에 새 기록이 저장되면 같은 줄이 두 번 들어올 수 있어, id가 있으면 중복을 뺀다.
function dedupeById(rows) {
  if (rows.length === 0 || rows[0] == null || typeof rows[0] !== 'object' || !('id' in rows[0])) return rows
  const seen = new Set()
  return rows.filter((r) => {
    if (r?.id == null) return true
    if (seen.has(r.id)) return false
    seen.add(r.id)
    return true
  })
}

export function createPaginatedFetch(baseFetch = (...args) => fetch(...args)) {
  return async function paginatedFetch(input, init = {}) {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input?.url
    if (!urlStr || !shouldPaginate(urlStr, init)) return baseFetch(input, init)

    const first = await baseFetch(pageUrl(urlStr, 0), init)
    if (!first.ok) return first
    const firstRows = await readRows(first)
    if (!firstRows || firstRows.length < PAGE_SIZE) return first

    // 1,000줄이 꽉 찼다 → 안정된 순서로 처음부터 끝까지 나눠 받는다.
    const ordered = await fetchRest(baseFetch, withStableOrder(urlStr), init, [], 0)
    if (ordered.rows) return combinedResponse(dedupeById(ordered.rows), ordered.lastRes)

    // id 열이 없는 표라 정렬을 못 붙이면, 원래 순서로 이어 받는다(최선).
    const fallback = await fetchRest(baseFetch, urlStr, init, firstRows, PAGE_SIZE)
    if (fallback.rows) return combinedResponse(dedupeById(fallback.rows), fallback.lastRes)
    return fallback.error
  }
}
