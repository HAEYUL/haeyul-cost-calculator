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
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteCounts, setDeleteCounts] = useState(null)
  const [deleteConfirmStage, setDeleteConfirmStage] = useState(1)
  const [deleting, setDeleting] = useState(false)

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
          // 명세표에 적힌 잔액은 그날 입고분을 더하기 전의 전잔액이라, 당일 입고액을 더해야
          // 그 시점의 실제 잔액이 된다.
          const value = Number(b.statement_balance) + Number(b.total_amount)

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

  const trimmedQuery = searchQuery.trim()
  const visibleVendors = trimmedQuery
    ? vendorsWithBalance.filter((v) => v.name.includes(trimmedQuery))
    : vendorsWithBalance

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

  // 삭제 버튼을 누르면, 이 거래처에 딸린 자료(입고·결제·기초 잔액)가 있는지부터 센다.
  // 자료가 하나도 없으면 바로 지워도 되지만, 있으면 되돌릴 수 없는 삭제라 한 번 더 확인받는다.
  const openDeleteConfirm = async (vendor) => {
    setDeleteTarget(vendor)
    setDeleteConfirmStage(1)
    setDeleteCounts(null)
    setError('')
    if (!supabase) return
    const [batchesRes, paymentsRes, balancesRes] = await Promise.all([
      supabase.from('invoice_batches').select('id', { count: 'exact', head: true }).eq('vendor_id', vendor.id),
      supabase.from('vendor_payments').select('id', { count: 'exact', head: true }).eq('vendor_id', vendor.id),
      supabase.from('vendor_opening_balances').select('id', { count: 'exact', head: true }).eq('vendor_id', vendor.id),
    ])
    setDeleteCounts({
      batches: batchesRes.count ?? 0,
      payments: paymentsRes.count ?? 0,
      balances: balancesRes.count ?? 0,
    })
  }

  const closeDeleteConfirm = () => {
    setDeleteTarget(null)
    setDeleteCounts(null)
    setDeleteConfirmStage(1)
  }

  const hasVendorData = deleteCounts != null && (deleteCounts.batches > 0 || deleteCounts.payments > 0 || deleteCounts.balances > 0)

  const handleConfirmClick = () => {
    // 자료가 있는 거래처는 첫 클릭에서 바로 지우지 않고, 한 번 더 눌러야 지워지게 한다.
    if (hasVendorData && deleteConfirmStage === 1) {
      setDeleteConfirmStage(2)
      return
    }
    handleDeleteVendor()
  }

  // 이 거래처에 걸린 입고(+품목)·결제·기초 잔액을 모두 지우고 나서 거래처 자체를 지운다.
  // price_changes(단가 변동 로그)는 지우지 않고 vendor_id만 비워서, 기록은 남기되 연결만 끊는다.
  const handleDeleteVendor = async () => {
    if (!deleteTarget || !supabase) return
    setDeleting(true)
    setError('')

    const { data: batchesData, error: batchesErr } = await supabase
      .from('invoice_batches')
      .select('id, photo_path')
      .eq('vendor_id', deleteTarget.id)
    if (batchesErr) {
      setDeleting(false)
      setError(batchesErr.message)
      return
    }

    const { error: invoicesErr } = await supabase.from('invoices').delete().eq('vendor_id', deleteTarget.id)
    if (invoicesErr) {
      setDeleting(false)
      setError(invoicesErr.message)
      return
    }

    const { error: batchDeleteErr } = await supabase.from('invoice_batches').delete().eq('vendor_id', deleteTarget.id)
    if (batchDeleteErr) {
      setDeleting(false)
      setError(batchDeleteErr.message)
      return
    }

    const { error: paymentsErr } = await supabase.from('vendor_payments').delete().eq('vendor_id', deleteTarget.id)
    if (paymentsErr) {
      setDeleting(false)
      setError(paymentsErr.message)
      return
    }

    const { error: balancesErr } = await supabase
      .from('vendor_opening_balances')
      .delete()
      .eq('vendor_id', deleteTarget.id)
    if (balancesErr) {
      setDeleting(false)
      setError(balancesErr.message)
      return
    }

    const { error: priceChangesErr } = await supabase
      .from('price_changes')
      .update({ vendor_id: null })
      .eq('vendor_id', deleteTarget.id)
    if (priceChangesErr) console.error(priceChangesErr)

    const { error: vendorDeleteErr } = await supabase.from('vendors').delete().eq('id', deleteTarget.id)
    setDeleting(false)
    if (vendorDeleteErr) {
      setError(vendorDeleteErr.message)
      return
    }

    // 명세표 원본 사진 정리는 최선 노력 — 실패해도 이미 삭제 자체는 끝난 뒤라 막지 않는다.
    const photoPaths = (batchesData ?? []).map((b) => b.photo_path).filter(Boolean)
    if (photoPaths.length > 0) {
      supabase.storage
        .from('invoice-photos')
        .remove(photoPaths)
        .then(({ error: removeErr }) => {
          if (removeErr) console.error(removeErr)
        })
    }

    closeDeleteConfirm()
    setDataKey((k) => k + 1)
  }

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/menu')}>
          ← 메인 메뉴
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

      {!loading && vendors.length > 0 && (
        <div className="history-header">
          <h2 className="section-title">거래처 목록</h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="거래처 검색"
            onClick={() => {
              setSearchOpen((v) => !v)
              setSearchQuery('')
            }}
          >
            🔍
          </button>
        </div>
      )}

      {searchOpen && (
        <div className="field">
          <input
            type="text"
            className="input"
            placeholder="거래처명으로 검색"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
        </div>
      )}

      {trimmedQuery && <p className="hint">검색 결과 {visibleVendors.length}개</p>}
      {trimmedQuery && visibleVendors.length === 0 && <p className="hint">일치하는 거래처가 없어요.</p>}

      <ul className="history-list">
        {visibleVendors.map((v) => (
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
            <div className="inventory-row-actions">
              <button
                type="button"
                className="link-btn link-btn-danger"
                onClick={() => openDeleteConfirm(v)}
              >
                거래처 삭제
              </button>
            </div>

            {deleteTarget?.id === v.id && (
              <div className="price-alert-box price-alert-box-danger">
                {deleteCounts == null ? (
                  <p className="hint">확인 중...</p>
                ) : !hasVendorData ? (
                  <>
                    <p className="price-alert-title">"{v.name}" 거래처를 삭제할까요?</p>
                    <p className="hint">입고·결제·기초 잔액 자료가 없는 거래처예요. 삭제하면 되돌릴 수 없어요.</p>
                  </>
                ) : deleteConfirmStage === 1 ? (
                  <>
                    <p className="price-alert-title">⚠️ "{v.name}"에는 자료가 있어요</p>
                    <p className="hint">
                      입고 {deleteCounts.batches}건, 결제 {deleteCounts.payments}건, 기초 잔액 {deleteCounts.balances}
                      건이 함께 삭제돼요. 되돌릴 수 없어요.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="price-alert-title">정말 삭제할까요?</p>
                    <p className="hint">다시 한번 확인할게요. "{v.name}"의 모든 자료가 지금 삭제돼요.</p>
                  </>
                )}
                {error && <p className="error-text">{error}</p>}
                <div className="invoice-form">
                  <button type="button" className="btn-secondary" onClick={closeDeleteConfirm} disabled={deleting}>
                    취소
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleConfirmClick}
                    disabled={deleting || deleteCounts == null}
                  >
                    {deleting
                      ? '삭제 중...'
                      : hasVendorData && deleteConfirmStage === 1
                        ? '자료 있음, 계속하기'
                        : '삭제'}
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
