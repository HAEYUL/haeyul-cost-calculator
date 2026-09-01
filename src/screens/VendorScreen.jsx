import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'

export default function VendorScreen() {
  const { store } = useStore()
  const navigate = useNavigate()

  const [vendors, setVendors] = useState([])
  const [totalsByVendor, setTotalsByVendor] = useState(new Map())
  const [paidByVendor, setPaidByVendor] = useState(new Map())
  const [latestBalanceByVendor, setLatestBalanceByVendor] = useState(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [dataKey, setDataKey] = useState(0)

  useEffect(() => {
    if (!store) navigate('/', { replace: true })
  }, [store, navigate])

  useEffect(() => {
    if (!store || !supabase) return
    setLoading(true)
    setError('')
    Promise.all([
      supabase.from('vendors').select('id, name').eq('store_code', store.code).order('name'),
      supabase
        .from('invoice_batches')
        .select('vendor_id, total_amount, invoice_date, statement_balance, created_at')
        .eq('store_code', store.code),
      supabase.from('vendor_payments').select('vendor_id, amount').eq('store_code', store.code),
    ]).then(([vendorsRes, batchesRes, paymentsRes]) => {
      const err = vendorsRes.error || batchesRes.error || paymentsRes.error
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }
      const totals = new Map()
      const latestBalance = new Map()
      for (const b of batchesRes.data ?? []) {
        totals.set(b.vendor_id, (totals.get(b.vendor_id) ?? 0) + Number(b.total_amount))
        if (b.statement_balance != null) {
          const dateValue = b.invoice_date ? new Date(b.invoice_date).getTime() : new Date(b.created_at).getTime()
          const existing = latestBalance.get(b.vendor_id)
          if (!existing || dateValue > existing.dateValue) {
            latestBalance.set(b.vendor_id, { value: Number(b.statement_balance), dateValue })
          }
        }
      }
      const paid = new Map()
      for (const p of paymentsRes.data ?? []) {
        paid.set(p.vendor_id, (paid.get(p.vendor_id) ?? 0) + Number(p.amount))
      }
      setVendors(vendorsRes.data ?? [])
      setTotalsByVendor(totals)
      setPaidByVendor(paid)
      setLatestBalanceByVendor(latestBalance)
      setLoading(false)
    })
  }, [store, dataKey])

  if (!store) return null

  const vendorsWithBalance = vendors
    .map((v) => {
      const totalAmount = totalsByVendor.get(v.id) ?? 0
      const totalPaid = paidByVendor.get(v.id) ?? 0
      const balance = latestBalanceByVendor.get(v.id)?.value ?? null
      return { ...v, totalAmount, totalPaid, balance }
    })
    .sort((a, b) => {
      if (a.balance == null && b.balance == null) return a.name.localeCompare(b.name)
      if (a.balance == null) return 1
      if (b.balance == null) return -1
      return b.balance - a.balance
    })

  const totalBalance = vendorsWithBalance.reduce((sum, v) => sum + (v.balance ?? 0), 0)

  const handleAdd = async () => {
    const trimmed = newName.trim()
    if (!trimmed || !supabase) return
    setSaving(true)
    setError('')
    const { error: err } = await supabase
      .from('vendors')
      .upsert({ store_code: store.code, name: trimmed }, { onConflict: 'store_code,name' })
    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }
    setNewName('')
    setDataKey((k) => k + 1)
  }

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/invoices')}>
          ← 입고 입력
        </button>
        <h1>거래처 관리</h1>
        <p className="subtitle">{store.name} · 거래처별 최근 명세표 잔액을 확인해요</p>
      </div>

      {!supabase && <p className="hint">Supabase가 설정되지 않았습니다.</p>}

      {!loading && !error && vendors.length > 0 && (
        <div className="cost-summary">
          <div className="cost-summary-row">
            <span>전체 미지급금 (명세표 잔액 합계)</span>
            <strong className={totalBalance > 0 ? 'alert-up' : ''}>{Math.round(totalBalance).toLocaleString()}원</strong>
          </div>
        </div>
      )}

      <div className="field">
        <label htmlFor="newVendorName">새 거래처 추가</label>
        <input
          id="newVendorName"
          className="input"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="예: 국일농산"
        />
      </div>
      <button type="button" className="btn-secondary" onClick={handleAdd} disabled={!newName.trim() || saving}>
        {saving ? '추가 중...' : '거래처 추가'}
      </button>

      {loading && <p className="hint">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}
      {!loading && !error && vendors.length === 0 && <p className="hint">등록된 거래처가 없습니다.</p>}

      <ul className="history-list">
        {vendorsWithBalance.map((v) => (
          <li key={v.id} className="history-row">
            <button type="button" className="cost-row-btn" onClick={() => navigate(`/vendors/${v.id}`)}>
              <div className="history-row-main">
                <span className="history-item">{v.name}</span>
                {v.balance != null ? (
                  <span className={v.balance > 0 ? 'alert-up' : ''}>미지급 {Math.round(v.balance).toLocaleString()}원</span>
                ) : (
                  <span className="hint">명세표 잔액 정보 없음</span>
                )}
              </div>
              <div className="history-row-sub">
                <span>입고 {Math.round(v.totalAmount).toLocaleString()}원</span>
                <span>결제 {Math.round(v.totalPaid).toLocaleString()}원</span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
