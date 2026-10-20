import { supabase } from './supabaseClient'

export const LATE_PAYMENT_MEMO = '즉시 결제(나중에 처리)'

// 결제 기록은 어느 명세표의 결제인지 따로 저장하지 않으므로, 같은 거래처·같은 날짜·같은 금액의
// 결제가 있으면 그 명세표는 결제된 것으로 본다. 결제 하나는 명세표 하나에만 짝지어서, 같은 날
// 같은 금액 명세표가 두 장이면 결제도 두 건 있어야 둘 다 결제됨으로 표시된다.
export function matchPaymentsToBatches(batches, payments) {
  const unused = [...payments]
  const matched = new Map()
  for (const batch of batches) {
    const vendorId = batch.vendor_id ?? batch.vendors?.id
    const amount = Math.round(Number(batch.total_amount))
    const idx = unused.findIndex(
      (p) => p.vendor_id === vendorId && p.paid_date === batch.invoice_date && Math.round(Number(p.amount)) === amount,
    )
    if (idx !== -1) {
      matched.set(batch.id, unused[idx])
      unused.splice(idx, 1)
    }
  }
  return matched
}

export function paidBatchIds(batches, payments) {
  return new Set(matchPaymentsToBatches(batches, payments).keys())
}

// 명세표 하나에 짝지어진 결제를 DB에서 찾는다(수정·삭제할 때 결제도 같이 맞추기 위함). 같은 거래처·
// 같은 날 명세표들과 결제들을 함께 짝지어서, 같은 금액 명세표가 여러 장이어도 엉뚱한 결제를 고르지 않는다.
export async function findLinkedPayment({ storeCode, batch }) {
  if (!batch?.invoice_date || !batch.vendor_id) return null
  const [batchesRes, paymentsRes] = await Promise.all([
    supabase
      .from('invoice_batches')
      .select('id, vendor_id, invoice_date, total_amount, created_at')
      .eq('store_code', storeCode)
      .eq('vendor_id', batch.vendor_id)
      .eq('invoice_date', batch.invoice_date)
      .order('created_at', { ascending: true }),
    supabase
      .from('vendor_payments')
      .select('id, vendor_id, amount, paid_date, memo')
      .eq('store_code', storeCode)
      .eq('vendor_id', batch.vendor_id)
      .eq('paid_date', batch.invoice_date),
  ])
  if (batchesRes.error || paymentsRes.error) return null
  // 수정 전 값으로 짝지어야 하므로, DB의 이 명세표 행 대신 넘겨받은(수정 전) 값을 쓴다.
  const batches = (batchesRes.data ?? []).map((b) => (b.id === batch.id ? { ...b, total_amount: batch.total_amount } : b))
  return matchPaymentsToBatches(batches, paymentsRes.data ?? []).get(batch.id) ?? null
}

// 입고 때 "바로 결제 완료" 체크를 빠뜨린 명세표에, 체크했을 때와 똑같이 합계금액·입고일로 결제를 남긴다.
export function canRecordBatchPayment(batch) {
  return Boolean(batch.invoice_date) && Number(batch.total_amount) > 0
}

export function recordBatchPayment({ storeCode, vendorId, batch }) {
  return supabase.from('vendor_payments').insert({
    store_code: storeCode,
    vendor_id: vendorId,
    amount: Number(batch.total_amount),
    paid_date: batch.invoice_date,
    memo: LATE_PAYMENT_MEMO,
  })
}
