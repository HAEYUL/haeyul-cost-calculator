import { adminClient, HttpError, requireAdmin, requireStore, sendError, serverSecret } from './_storeAuth.js'
import { decryptRrn, encryptRrn, rrnHash } from './_dispatchCrypto.js'
import { formatRrn, rrnDigits, rrnError, rrnMaskedPart } from '../src/lib/dispatch.js'

// 파출 인력 명부 저장(주민번호 암호화 때문에 서버에서만 저장한다). 근무 기록은 화면에서 바로 저장한다.
// action:
//   'saveWorker'  인력 등록·수정 (매니저: 자기 매장, 관리자: body.storeCode 매장)
//   'deleteWorker' 근무 기록이 하나도 없는 인력만 지운다
//   'revealRrn'   세무 출력용 주민번호 전체 (메인 관리자만)

const PUBLIC_COLUMNS =
  'id, store_code, name, rrn_masked, bank, account, is_fixed, default_start, default_end, default_wage, default_position, default_source_id, memo, created_at, updated_at'

const cleanText = (v, max = 60) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const isUuid = (v) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)
const cleanTime = (v) => (typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : null)
function cleanWage(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  if (!Number.isInteger(n) || n < 0 || n > 10000000) throw new HttpError(400, '일당을 확인하세요.')
  return n
}

async function loadWorker(db, id) {
  const { data, error } = await db.from('dispatch_workers').select('id, store_code').eq('id', id).maybeSingle()
  if (error) throw new HttpError(500, tableError(error))
  if (!data) throw new HttpError(404, '인력을 찾을 수 없어요.')
  return data
}

function tableError(error) {
  if (/dispatch_/.test(error?.message ?? '') && /exist|find/i.test(error?.message ?? '')) {
    return '파출 표가 아직 없어요. Supabase에서 supabase/roles.sql을 실행해주세요.'
  }
  return error?.message || '서버 오류가 발생했어요'
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  try {
    const { action } = req.body ?? {}
    const db = adminClient()

    if (action === 'saveWorker') {
      const { storeCode } = await requireStore(req)
      const body = req.body
      const name = cleanText(body.name, 30)
      if (!name) throw new HttpError(400, '이름을 입력하세요.')

      const row = {
        name,
        bank: cleanText(body.bank, 30) || null,
        account: cleanText(body.account, 40) || null,
        is_fixed: Boolean(body.isFixed),
        default_start: cleanTime(body.defaultStart),
        default_end: cleanTime(body.defaultEnd),
        default_wage: cleanWage(body.defaultWage),
        default_position: ['hall', 'kitchen'].includes(body.defaultPosition) ? body.defaultPosition : null,
        default_source_id: isUuid(body.defaultSourceId) ? body.defaultSourceId : null,
        memo: cleanText(body.memo, 300) || null,
        updated_at: new Date().toISOString(),
      }

      const secret = serverSecret()
      if (body.rrn != null && body.rrn !== '') {
        const err = rrnError(body.rrn)
        if (err) throw new HttpError(400, err)
        const digits = rrnDigits(body.rrn)
        row.rrn_masked = rrnMaskedPart(digits)
        row.rrn_encrypted = encryptRrn(digits, secret)
        row.rrn_hash = rrnHash(digits, secret)

        // 같은 매장에 같은 주민번호가 이미 있으면 같은 사람이다 → 새로 만들지 않고 알려준다.
        let dup = db.from('dispatch_workers').select('id, name').eq('store_code', storeCode).eq('rrn_hash', row.rrn_hash)
        if (body.id) dup = dup.neq('id', body.id)
        const { data: dupRows, error: dupErr } = await dup.limit(1)
        if (dupErr) throw new HttpError(500, tableError(dupErr))
        if (dupRows?.length) {
          throw new HttpError(409, `같은 주민번호로 이미 등록된 분이 있어요: ${dupRows[0].name}`, { duplicate: dupRows[0] })
        }
      }

      let result
      if (body.id) {
        const existing = await loadWorker(db, body.id)
        if (existing.store_code !== storeCode) throw new HttpError(403, '다른 매장의 인력은 고칠 수 없어요.')
        result = await db.from('dispatch_workers').update(row).eq('id', body.id).select(PUBLIC_COLUMNS).single()
      } else {
        result = await db
          .from('dispatch_workers')
          .insert({ ...row, store_code: storeCode })
          .select(PUBLIC_COLUMNS)
          .single()
      }
      if (result.error) throw new HttpError(500, tableError(result.error))
      res.status(200).json({ worker: result.data })
      return
    }

    if (action === 'deleteWorker') {
      const { storeCode } = await requireStore(req)
      const existing = await loadWorker(db, req.body.id)
      if (existing.store_code !== storeCode) throw new HttpError(403, '다른 매장의 인력은 지울 수 없어요.')
      const { count, error: countErr } = await db
        .from('dispatch_shifts')
        .select('id', { count: 'exact', head: true })
        .eq('worker_id', existing.id)
      if (countErr) throw new HttpError(500, tableError(countErr))
      if (count > 0) throw new HttpError(409, '근무 기록이 있는 인력은 지울 수 없어요. 세무 신고 자료로 남겨둬야 해요.')
      const { error } = await db.from('dispatch_workers').delete().eq('id', existing.id)
      if (error) throw new HttpError(500, tableError(error))
      res.status(200).json({ ok: true })
      return
    }

    if (action === 'revealRrn') {
      await requireAdmin(req)
      const ids = Array.isArray(req.body.workerIds) ? req.body.workerIds.filter((v) => typeof v === 'string').slice(0, 1000) : []
      if (ids.length === 0) {
        res.status(200).json({ rrns: {} })
        return
      }
      const { data, error } = await db.from('dispatch_workers').select('id, rrn_encrypted').in('id', ids)
      if (error) throw new HttpError(500, tableError(error))
      const secret = serverSecret()
      const rrns = {}
      for (const w of data ?? []) {
        const digits = decryptRrn(w.rrn_encrypted, secret)
        if (digits) rrns[w.id] = formatRrn(digits)
      }
      res.status(200).json({ rrns })
      return
    }

    throw new HttpError(400, '알 수 없는 요청이에요.')
  } catch (err) {
    sendError(res, err)
  }
}
