import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { createPaginatedFetch, shouldPaginate, PAGE_SIZE } from './paginatedFetch'

const BASE = 'https://example.supabase.co'

// PostgREST 흉내: 표마다 최대 1,000줄(max-rows)까지만 돌려주고, store_code=eq. 필터·order·limit·offset을 지원한다.
function fakePostgrest(tables, { maxRows = 1000 } = {}) {
  const calls = []
  const baseFetch = async (input, init = {}) => {
    const url = new URL(input)
    calls.push({ url: url.toString(), method: init.method ?? 'GET' })
    const table = url.pathname.split('/rest/v1/')[1]
    if (!(table in tables)) return new Response(JSON.stringify({ message: 'not found' }), { status: 404 })
    let rows = [...tables[table]]
    const store = url.searchParams.get('store_code')
    if (store?.startsWith('eq.')) rows = rows.filter((r) => r.store_code === store.slice(3))
    const order = url.searchParams.get('order')
    if (order) {
      const keys = order.split(',').map((p) => p.split('.'))
      for (const [col] of keys) {
        if (rows.length > 0 && !(col in rows[0])) {
          return new Response(JSON.stringify({ message: `column ${col} does not exist` }), { status: 400 })
        }
      }
      rows.sort((a, b) => {
        for (const [col, dir] of keys) {
          if (a[col] < b[col]) return dir === 'desc' ? 1 : -1
          if (a[col] > b[col]) return dir === 'desc' ? -1 : 1
        }
        return 0
      })
    }
    const total = rows.length
    const offset = Number(url.searchParams.get('offset') ?? 0)
    const limit = Math.min(Number(url.searchParams.get('limit') ?? maxRows), maxRows)
    const page = rows.slice(offset, offset + limit)
    return new Response(JSON.stringify(page), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-range': page.length ? `${offset}-${offset + page.length - 1}/${total}` : `*/${total}`,
      },
    })
  }
  return { baseFetch, calls }
}

function makeInvoices(n, extra = {}) {
  return Array.from({ length: n }, (_, i) => ({
    id: `id-${String(i).padStart(6, '0')}`,
    store_code: 'haeyul',
    item_name: `물품${i}`,
    // 같은 created_at이 여러 줄 → id로 순서를 고정해야 페이지 경계에서 빠지거나 겹치지 않는다.
    created_at: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
    ...extra,
  }))
}

function client(baseFetch) {
  return createClient(BASE, 'anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createPaginatedFetch(baseFetch) },
  })
}

describe('shouldPaginate', () => {
  it('범위를 정하지 않은 목록 조회만 나눠 받는다', () => {
    expect(shouldPaginate(`${BASE}/rest/v1/invoices?select=*`, { method: 'GET' })).toBe(true)
    expect(shouldPaginate(`${BASE}/rest/v1/invoices?select=*&limit=5`, { method: 'GET' })).toBe(false)
    expect(shouldPaginate(`${BASE}/rest/v1/invoices?select=*&offset=0`, { method: 'GET' })).toBe(false)
    expect(shouldPaginate(`${BASE}/rest/v1/invoices`, { method: 'POST' })).toBe(false)
    expect(shouldPaginate(`${BASE}/rest/v1/invoices`, { method: 'HEAD' })).toBe(false)
    expect(shouldPaginate(`${BASE}/rest/v1/rpc/foo`, { method: 'GET' })).toBe(false)
    expect(shouldPaginate(`${BASE}/storage/v1/object/x`, { method: 'GET' })).toBe(false)
    expect(
      shouldPaginate(`${BASE}/rest/v1/invoices`, { method: 'GET', headers: { Accept: 'application/vnd.pgrst.object+json' } }),
    ).toBe(false)
  })
})

describe('createPaginatedFetch + supabase-js', () => {
  it('1,000줄이 넘는 표를 끝까지 빠짐없이 가져온다 (퀸스유통 염장연근채 재현)', async () => {
    const rows = makeInvoices(2500)
    rows.push({ id: 'zzz-last', store_code: 'haeyul', item_name: '염장연근채(중국산/진공/1kg*10)box', created_at: '2026-11-05' })
    const { baseFetch } = fakePostgrest({ invoices: rows })
    const { data, error } = await client(baseFetch).from('invoices').select('id, item_name').eq('store_code', 'haeyul')
    expect(error).toBeNull()
    expect(data).toHaveLength(2501)
    expect(new Set(data.map((r) => r.id)).size).toBe(2501)
    expect(data.some((r) => r.item_name.startsWith('염장연근채'))).toBe(true)
  })

  it('패치가 없으면 1,000줄에서 잘린다 (원래 버그)', async () => {
    const { baseFetch } = fakePostgrest({ invoices: makeInvoices(2500) })
    const raw = createClient(BASE, 'anon-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: baseFetch },
    })
    const { data } = await raw.from('invoices').select('id').eq('store_code', 'haeyul')
    expect(data).toHaveLength(1000)
  })

  it('1,000줄 미만이면 요청 1번으로 지금과 똑같이 동작한다', async () => {
    const { baseFetch, calls } = fakePostgrest({ invoices: makeInvoices(300) })
    const { data } = await client(baseFetch).from('invoices').select('id').eq('store_code', 'haeyul')
    expect(data).toHaveLength(300)
    expect(calls).toHaveLength(1)
  })

  it('정확히 1,000줄이어도 빠짐없이 가져온다', async () => {
    const { baseFetch } = fakePostgrest({ invoices: makeInvoices(PAGE_SIZE) })
    const { data } = await client(baseFetch).from('invoices').select('id').eq('store_code', 'haeyul')
    expect(data).toHaveLength(PAGE_SIZE)
  })

  it('화면이 정한 정렬 순서를 유지한다', async () => {
    const { baseFetch, calls } = fakePostgrest({ invoices: makeInvoices(2300) })
    const { data } = await client(baseFetch)
      .from('invoices')
      .select('id, created_at')
      .eq('store_code', 'haeyul')
      .order('created_at', { ascending: true })
    expect(data).toHaveLength(2300)
    for (let i = 1; i < data.length; i += 1) expect(data[i - 1].created_at <= data[i].created_at).toBe(true)
    expect(new URL(calls.at(-1).url).searchParams.get('order')).toBe('created_at.asc,id.asc')
  })

  it('id 열이 없는 표도 원래 순서로 이어 받는다', async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => ({ store_code: 'haeyul', menu_name: `메뉴${i}` }))
    const { baseFetch } = fakePostgrest({ recipe_meta: rows })
    const { data, error } = await client(baseFetch).from('recipe_meta').select('menu_name').eq('store_code', 'haeyul')
    expect(error).toBeNull()
    expect(data).toHaveLength(1500)
  })

  it('count 옵션을 쓰면 전체 건수도 그대로 받는다', async () => {
    const { baseFetch } = fakePostgrest({ invoices: makeInvoices(1800) })
    const { data, count } = await client(baseFetch)
      .from('invoices')
      .select('id', { count: 'exact' })
      .eq('store_code', 'haeyul')
    expect(data).toHaveLength(1800)
    expect(count).toBe(1800)
  })

  it('limit/range/single 조회는 손대지 않는다', async () => {
    const { baseFetch } = fakePostgrest({ invoices: makeInvoices(2500) })
    const c = client(baseFetch)
    expect((await c.from('invoices').select('id').limit(5)).data).toHaveLength(5)
    expect((await c.from('invoices').select('id').range(10, 19)).data).toHaveLength(10)
    const one = await c.from('invoices').select('id').eq('store_code', 'haeyul').order('id').limit(1).maybeSingle()
    expect(one.data.id).toBe('id-000000')
  })

  it('오류 응답은 그대로 돌려준다', async () => {
    const { baseFetch } = fakePostgrest({})
    const { data, error } = await client(baseFetch).from('nope').select('id')
    expect(data).toBeNull()
    expect(error).not.toBeNull()
  })
})
