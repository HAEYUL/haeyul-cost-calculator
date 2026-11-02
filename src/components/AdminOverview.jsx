import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { groupByVendor, makeLedger, todayStr } from '../lib/vendorLedger'
import { rowDateStr } from '../lib/rowDateStr'
import { fetchNotices } from '../lib/notices'

const won = (n) => `${Math.round(n).toLocaleString('ko-KR')}원`

// 메인 관리자 메인 화면: 4개 매장 현황을 한눈에 (오늘 명세표, 파출 송금 대기, 거래처 미지급)
async function loadStoreSummary(storeCode, today) {
  const [batchesRes, paymentsRes, openingRes, shiftsRes] = await Promise.all([
    supabase
      .from('invoice_batches')
      .select('vendor_id, total_amount, invoice_date, statement_balance, current_balance, created_at')
      .eq('store_code', storeCode),
    supabase.from('vendor_payments').select('vendor_id, amount, paid_date').eq('store_code', storeCode),
    supabase.from('vendor_opening_balances').select('vendor_id, as_of_date, balance').eq('store_code', storeCode),
    supabase.from('dispatch_shifts').select('worker_id, wage').eq('store_code', storeCode).is('paid_date', null),
  ])
  const err = batchesRes.error || paymentsRes.error || openingRes.error
  if (err) throw err

  const batches = batchesRes.data ?? []
  const todayBatches = batches.filter((b) => rowDateStr(b) === today || (b.created_at ?? '').slice(0, 10) === today)

  const batchesByVendor = groupByVendor(batches)
  const paymentsByVendor = groupByVendor(paymentsRes.data)
  const openingByVendor = groupByVendor(openingRes.data)
  let balance = 0
  for (const vendorId of new Set([...batchesByVendor.keys(), ...paymentsByVendor.keys(), ...openingByVendor.keys()])) {
    balance += makeLedger({
      batches: batchesByVendor.get(vendorId),
      payments: paymentsByVendor.get(vendorId),
      openings: openingByVendor.get(vendorId),
    }).current
  }

  // 파출 표가 아직 없으면(roles.sql 실행 전) 0으로 둔다.
  const unpaid = shiftsRes.error ? [] : (shiftsRes.data ?? [])
  return {
    todayCount: todayBatches.length,
    todayAmount: todayBatches.reduce((sum, b) => sum + Number(b.total_amount || 0), 0),
    balance,
    unpaidWorkers: new Set(unpaid.map((s) => s.worker_id)).size,
    unpaidAmount: unpaid.reduce((sum, s) => sum + Number(s.wage || 0), 0),
  }
}

export default function AdminOverview({ stores, onOpenStore }) {
  const navigate = useNavigate()
  const [summaries, setSummaries] = useState(null)
  const [noticeInfo, setNoticeInfo] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    const today = todayStr()
    Promise.all(stores.map((s) => loadStoreSummary(s.code, today)))
      .then((rows) => {
        if (!cancelled) setSummaries(new Map(stores.map((s, i) => [s.code, rows[i]])))
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    fetchNotices({ storeCodes: stores.map((st) => st.code), sinceDays: 30 })
      .then((rows) => {
        if (cancelled) return
        const weekAgo = Date.now() - 7 * 86400000
        setNoticeInfo({
          pending: rows.filter((n) => !n.confirmed_at).length,
          replies: rows.filter((n) => n.reply && new Date(n.replied_at).getTime() > weekAgo).length,
        })
      })
      .catch(() => !cancelled && setNoticeInfo(null))
    return () => {
      cancelled = true
    }
  }, [stores])

  if (error) return <p className="error-text">{error}</p>
  if (!summaries) return <p className="hint">4개 매장 현황을 불러오는 중...</p>

  const all = [...summaries.values()]
  const unpaidTotal = all.reduce((sum, r) => sum + r.unpaidAmount, 0)
  const unpaidWorkers = all.reduce((sum, r) => sum + r.unpaidWorkers, 0)
  const balanceTotal = all.reduce((sum, r) => sum + r.balance, 0)

  return (
    <div className="admin-overview">
      <p className="menu-group-title">📋 {stores.length}개 매장 현황</p>
      <div className="admin-overview-grid">
        {stores.map((s) => {
          const r = summaries.get(s.code)
          return (
            <button type="button" key={s.code} className="cost-summary admin-overview-card" onClick={() => onOpenStore(s)}>
              <strong className="admin-overview-name">{s.name}</strong>
              <div className="cost-summary-row">
                <span>🧾 오늘 명세표</span>
                <span>
                  {r.todayCount}건{r.todayCount > 0 ? ` · ${won(r.todayAmount)}` : ''}
                </span>
              </div>
              <div className="cost-summary-row">
                <span>💸 파출 송금 대기</span>
                <span className={r.unpaidAmount > 0 ? 'cost-warning' : ''}>
                  {r.unpaidAmount > 0 ? `${r.unpaidWorkers}명 · ${won(r.unpaidAmount)}` : '없음'}
                </span>
              </div>
              <div className="cost-summary-row">
                <span>🤝 거래처 미지급</span>
                <span>{won(r.balance)}</span>
              </div>
            </button>
          )
        })}
      </div>
      <div className="admin-overview-totals">
        <button type="button" className="cost-summary admin-overview-card" onClick={() => navigate('/dispatch-payments')}>
          <div className="cost-summary-row">
            <span>💸 파출비 송금 대기 합계</span>
            <strong className={unpaidTotal > 0 ? 'alert-up' : ''}>
              {unpaidTotal > 0 ? `${unpaidWorkers}명 · ${won(unpaidTotal)}` : '없음'}
            </strong>
          </div>
          <p className="hint">눌러서 송금 관리로 가기 →</p>
        </button>
        <div className="cost-summary admin-overview-card">
          <div className="cost-summary-row">
            <span>🤝 거래처 미지급 합계</span>
            <strong>{won(balanceTotal)}</strong>
          </div>
          <p className="hint">매장 카드를 누르면 그 매장으로 바뀌어요</p>
        </div>
        <button type="button" className="cost-summary admin-overview-card" onClick={() => navigate('/notices')}>
          <div className="cost-summary-row">
            <span>📢 매니저 전달사항</span>
            <strong className={noticeInfo?.pending ? 'cost-warning' : ''}>
              {noticeInfo ? `미확인 ${noticeInfo.pending}건 · 새 답장 ${noticeInfo.replies}건` : '보내기 →'}
            </strong>
          </div>
          <p className="hint">매장 매니저에게 메모를 보내고 확인·답장을 받아요</p>
        </button>
        <button type="button" className="cost-summary admin-overview-card" onClick={() => navigate('/consolidated')}>
          <div className="cost-summary-row">
            <span>🧮 통합 매출·결산</span>
            <strong>4개 매장 합산 →</strong>
          </div>
          <p className="hint">매장운영결산·일매출을 기간·월별/년별로 합쳐서 봐요</p>
        </button>
      </div>
    </div>
  )
}
