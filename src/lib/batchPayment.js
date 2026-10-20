import { supabase } from './supabaseClient'

export const LATE_PAYMENT_MEMO = '즉시 결제(나중에 처리)'

// 결제 기록은 어느 명세표의 결제인지 따로 저장하지 않으므로, 같은 거래처·같은 날짜·같은 금액의
// 결제가 있으면 그 명세표는 결제된 것으로 본다. 결제 하나는 명세표 하나에만 짝지어서, 같은 날
// 같은 금액 명세표가 두 장이면 결제도 두 건 있어야 둘 다 결제됨으로 표시된다.
export function paidBatchIds(batches, payments) {
  const unused = payments.map((p) => ({
    vendorId: p.vendor_id,
    date: p.paid_date,
    amount: Math.round(Number(p.amount)),
  }))
  const paid = new Set()
  for (const batch of batches) {
    const vendorId = batch.vendor_id ?? batch.vendors?.id
    const amount = Math.round(Number(batch.total_amount))
    const idx = unused.findIndex(
      (p) => p.vendorId === vendorId && p.date === batch.invoice_date && p.amount === amount,
    )
    if (idx !== -1) {
      paid.add(batch.id)
      unused.splice(idx, 1)
    }
  }
  return paid
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
