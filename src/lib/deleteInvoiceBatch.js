import { supabase } from './supabaseClient'

// 명세표(전표) 삭제: 품목 → 명세표 → (선택) 같이 생긴 결제 기록 → 원본 사진 순서로 지운다.
// 거래처 상세 화면의 삭제와 같은 순서다. 반환: { error, warning }
export async function deleteInvoiceBatch({ batch, linkedPaymentId }) {
  const { error: itemsErr } = await supabase.from('invoices').delete().eq('batch_id', batch.id)
  if (itemsErr) return { error: itemsErr }

  const { error: batchErr } = await supabase.from('invoice_batches').delete().eq('id', batch.id)
  if (batchErr) return { error: batchErr }

  let warning = ''
  if (linkedPaymentId) {
    const { error: paymentErr } = await supabase.from('vendor_payments').delete().eq('id', linkedPaymentId)
    if (paymentErr) warning = `명세표는 지웠지만 결제 기록을 지우지 못했어요. 거래처 관리에서 지워주세요. (${paymentErr.message})`
  }

  if (batch.photo_path) {
    supabase.storage
      .from('invoice-photos')
      .remove([batch.photo_path])
      .then(({ error: removeErr }) => removeErr && console.error(removeErr))
  }
  return { error: null, warning }
}
