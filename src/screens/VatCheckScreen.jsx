import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { findBatchesNeedingVatFix } from '../lib/vatAmountFix'

const fmt = (n) => Math.round(Number(n)).toLocaleString()

// 부가세 금액 점검: 저장된 명세표 중 부가세 품목 금액에 공급가만 들어간(부가세 별도 거래처는 반대로
// 부가세가 이미 들어간) 것만 모아 보여준다. [수정]으로 들어가 버튼 하나로 고치고 돌아오면 목록에서 빠진다.
export default function VatCheckScreen() {
  const { store } = useStore()
  const navigate = useNavigate()

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!store) navigate('/', { replace: true })
  }, [store, navigate])

  useEffect(() => {
    if (!store || !supabase) return
    setLoading(true)
    setError('')
    supabase
      .from('invoice_batches')
      .select(
        'id, vendor_id, invoice_date, created_at, total_amount, vendors(id, name, vat_separate), invoices(item_name, quantity, unit_price, amount, vat)',
      )
      .eq('store_code', store.code)
      .order('invoice_date', { ascending: false, nullsFirst: false })
      .then(({ data, error: err }) => {
        setLoading(false)
        if (err) {
          setError(err.message)
          return
        }
        const vatSeparateByVendor = new Map((data ?? []).map((b) => [b.vendor_id, !!b.vendors?.vat_separate]))
        setRows(findBatchesNeedingVatFix(data, vatSeparateByVendor))
      })
  }, [store])

  if (!store) return null

  const missingVat = rows.filter((r) => r.diff > 0).reduce((sum, r) => sum + r.diff, 0)

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/vendors')}>
          ← 거래처 관리
        </button>
        <h1>부가세 금액 점검</h1>
        <p className="subtitle">{store.name} · 공급가만 들어간 명세표를 찾아 고쳐요</p>
      </div>

      <p className="hint">
        [수정]을 누르고 [부가세 포함 금액으로 모두 고치기] → [수정 저장]을 하면 이 목록에서 빠져요.
      </p>

      {!supabase && <p className="hint">Supabase가 설정되지 않았습니다.</p>}
      {loading && <p className="hint">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}
      {!loading && !error && rows.length === 0 && <p className="success-text">고칠 명세표가 없어요. 모두 맞게 저장돼 있어요.</p>}

      {rows.length > 0 && (
        <div className="cost-summary">
          <div className="cost-summary-row">
            <span>고칠 명세표</span>
            <strong>{rows.length}장</strong>
          </div>
          <div className="cost-summary-row">
            <span>빠진 부가세 합계</span>
            <strong className="alert-up">{fmt(missingVat)}원</strong>
          </div>
        </div>
      )}

      <ul className="history-list">
        {rows.map((r) => (
          <li key={r.id} className="history-row">
            <div className="history-row-main">
              <span className="history-vendor">{r.vendors?.name ?? '거래처 미지정'}</span>
              <div className="history-row-main-end">
                <span>{r.invoice_date ?? '날짜 미입력'}</span>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => navigate(`/invoices/edit/${r.id}`)}
                >
                  수정
                </button>
              </div>
            </div>
            <div className="history-row-sub">
              <span>
                {r.fixes.length}개 품목 ·{' '}
                {r.diff > 0 ? `부가세 ${fmt(r.diff)}원 빠짐` : `부가세 ${fmt(-r.diff)}원 더 들어감 (부가세 별도 거래처)`}
              </span>
            </div>
            <ul className="batch-items">
              {r.fixes.map((f) => (
                <li key={f.index} className="batch-item-row">
                  <span>{f.name}</span>
                  <span>
                    {fmt(f.from)}원 → {fmt(f.to)}원
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  )
}
