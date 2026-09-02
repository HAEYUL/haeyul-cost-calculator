import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'

// 명세표에 적힌 입고일(invoice_date)을 우선 기준으로 삼고, 없는 옛 데이터만 저장 시각
// (created_at)의 날짜로 대신한다.
function rowDateStr(row) {
  if (row.invoice_date) return row.invoice_date
  const d = new Date(row.created_at)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// 이번 달의 [시작일, 다음 달 시작일) 범위. dateStr이 start 이상 end 미만이면 이번 달.
function monthBounds() {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const start = `${y}-${String(m + 1).padStart(2, '0')}-01`
  const next = new Date(y, m + 1, 1)
  const end = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`
  return { start, end }
}

export default function VendorScreen() {
  const { store } = useStore()
  const navigate = useNavigate()

  const [vendors, setVendors] = useState([])
  const [monthlyTotalByVendor, setMonthlyTotalByVendor] = useState(new Map())
  const [estimatedPaymentByVendor, setEstimatedPaymentByVendor] = useState(new Map())
  const [latestBalanceByVendor, setLatestBalanceByVendor] = useState(new Map())
  const [staleBalanceVendors, setStaleBalanceVendors] = useState(new Set())
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
    ]).then(([vendorsRes, batchesRes]) => {
      const err = vendorsRes.error || batchesRes.error
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }

      const { start: monthStart, end: monthEnd } = monthBounds()
      const monthlyTotal = new Map()
      const latestBalance = new Map() // 전체 기간 중 가장 최근 잔액 (우측 표시용)
      const monthLatestBalance = new Map() // 이번 달 안에서 가장 최근 잔액
      const prevBalance = new Map() // 이번 달 시작 전 마지막 잔액
      const latestAnyDateValue = new Map() // 잔액 유무와 무관한, 진짜 가장 최근 명세표 날짜

      for (const b of batchesRes.data ?? []) {
        const dateStr = rowDateStr(b)
        const isThisMonth = dateStr >= monthStart && dateStr < monthEnd
        const dateValue = new Date(b.invoice_date ?? b.created_at).getTime()

        if (isThisMonth) {
          monthlyTotal.set(b.vendor_id, (monthlyTotal.get(b.vendor_id) ?? 0) + Number(b.total_amount))
        }

        const existingAnyDate = latestAnyDateValue.get(b.vendor_id)
        if (!existingAnyDate || dateValue > existingAnyDate) {
          latestAnyDateValue.set(b.vendor_id, dateValue)
        }

        if (b.statement_balance != null) {
          const value = Number(b.statement_balance)

          const existing = latestBalance.get(b.vendor_id)
          if (!existing || dateValue > existing.dateValue) {
            latestBalance.set(b.vendor_id, { value, dateValue })
          }

          if (isThisMonth) {
            const existingMonth = monthLatestBalance.get(b.vendor_id)
            if (!existingMonth || dateValue > existingMonth.dateValue) {
              monthLatestBalance.set(b.vendor_id, { value, dateValue })
            }
          } else if (dateStr < monthStart) {
            const existingPrev = prevBalance.get(b.vendor_id)
            if (!existingPrev || dateValue > existingPrev.dateValue) {
              prevBalance.set(b.vendor_id, { value, dateValue })
            }
          }
        }
      }

      // 결제액(추정) = 당월 입고금액 − (당월 최근 잔액 − 전월까지의 마지막 잔액).
      // 당월에 잔액이 찍힌 명세표가 없으면(당월 입고 자체가 없거나 잔액 미기재) 추정할 수 없다.
      const estimatedPayment = new Map()
      for (const [vendorId, { value: monthBalance }] of monthLatestBalance) {
        const prev = prevBalance.get(vendorId)?.value ?? 0
        const monthTotal = monthlyTotal.get(vendorId) ?? 0
        estimatedPayment.set(vendorId, monthTotal - (monthBalance - prev))
      }

      // 잔액이 적힌 것보다 더 최근 명세표가 있으면(그 명세표엔 잔액이 없다는 뜻) 미지급금이
      // 최신이 아닐 수 있다는 표시를 해준다.
      const stale = new Set()
      for (const [vendorId, balanceInfo] of latestBalance) {
        const anyDateValue = latestAnyDateValue.get(vendorId)
        if (anyDateValue != null && anyDateValue > balanceInfo.dateValue) {
          stale.add(vendorId)
        }
      }

      setVendors(vendorsRes.data ?? [])
      setMonthlyTotalByVendor(monthlyTotal)
      setEstimatedPaymentByVendor(estimatedPayment)
      setLatestBalanceByVendor(latestBalance)
      setStaleBalanceVendors(stale)
      setLoading(false)
    })
  }, [store, dataKey])

  if (!store) return null

  const vendorsWithBalance = vendors
    .map((v) => {
      const monthTotal = monthlyTotalByVendor.get(v.id) ?? 0
      const estimatedPayment = estimatedPaymentByVendor.has(v.id) ? estimatedPaymentByVendor.get(v.id) : null
      const balance = latestBalanceByVendor.get(v.id)?.value ?? null
      const isStale = staleBalanceVendors.has(v.id)
      return { ...v, monthTotal, estimatedPayment, balance, isStale }
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
        <p className="subtitle">{store.name} · 거래처별 당월 입고·결제와 최근 명세표 잔액을 확인해요</p>
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
                <span>당월 입고 {Math.round(v.monthTotal).toLocaleString()}원</span>
                <span>결제(추정) {v.estimatedPayment != null ? `${Math.round(v.estimatedPayment).toLocaleString()}원` : '-'}</span>
              </div>
              {v.isStale && <p className="hint alert-up">⚠️ 더 최근 명세표에 잔액이 기록 안 됨</p>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
