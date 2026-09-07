// 명세표(invoice_batches 등) 행의 날짜를 "YYYY-MM-DD" 문자열로 뽑는다. invoice_date가
// 있으면 그대로 쓰고, 없는 옛 데이터는 created_at에서 날짜만 뽑아 대신 쓴다.
export function rowDateStr(row) {
  if (row.invoice_date) return row.invoice_date
  const d = new Date(row.created_at)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
