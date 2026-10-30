import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { monthRange } from '../lib/dateRange'
import { useHistoryState } from '../hooks/usePageHistoryState'
import {
  LEDGER_START_MONTH,
  currentMonth,
  groupByVendor,
  makeLedger,
  monthBounds,
  monthLabel,
  shiftMonth,
} from '../lib/vendorLedger'
import { findBatchesNeedingVatFix } from '../lib/vatAmountFix'

export default function VendorScreen() {
  const { store } = useStore()
  const navigate = useNavigate()

  const [vendors, setVendors] = useState([])
  const [ledgerByVendor, setLedgerByVendor] = useState(new Map())
  // 달·입금 기간·검색어는 이 화면의 방문 기록에 남겨, 거래처 상세를 보고 돌아와도 그대로 보이게 한다.
  const [month, setMonth] = useHistoryState('month', () => currentMonth())
  const [vatFixCount, setVatFixCount] = useState(0)
  const [allPayments, setAllPayments] = useState([])
  const [paymentDateFrom, setPaymentDateFrom] = useHistoryState('paymentDateFrom', () => monthRange().start)
  const [paymentDateTo, setPaymentDateTo] = useHistoryState('paymentDateTo', () => monthRange().end)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [dataKey, setDataKey] = useState(0)
  const [searchQuery, setSearchQuery] = useHistoryState('searchQuery', '')

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
      supabase.from('vendors').select('id, name, vat_separate').eq('store_code', store.code).order('name'),
      supabase
        .from('invoice_batches')
        .select(
          'id, vendor_id, total_amount, invoice_date, statement_balance, current_balance, created_at, invoices(item_name, quantity, unit_price, amount, vat)',
        )
        .eq('store_code', store.code),
      supabase.from('vendor_payments').select('vendor_id, amount, paid_date').eq('store_code', store.code),
      supabase.from('vendor_opening_balances').select('vendor_id, as_of_date, balance').eq('store_code', store.code),
    ]).then(([vendorsRes, batchesRes, paymentsRes, openingRes]) => {
      const err = vendorsRes.error || batchesRes.error || paymentsRes.error || openingRes.error
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }

      // 거래처마다 장부(시작 잔액 + 입고 − 결제)를 만들어둔다. 메인 메뉴·거래처 상세와 같은 계산이다.
      const batchesByVendor = groupByVendor(batchesRes.data)
      const paymentsByVendor = groupByVendor(paymentsRes.data)
      const openingByVendor = groupByVendor(openingRes.data)
      const ledgers = new Map()
      for (const v of vendorsRes.data ?? []) {
        const batches = batchesByVendor.get(v.id) ?? []
        const payments = paymentsByVendor.get(v.id) ?? []
        ledgers.set(v.id, {
          ...makeLedger({ batches, payments, openings: openingByVendor.get(v.id) }),
          hasActivity: batches.length > 0 || payments.length > 0,
        })
      }

      setVendors(vendorsRes.data ?? [])
      setLedgerByVendor(ledgers)
      const vatSeparateByVendor = new Map((vendorsRes.data ?? []).map((v) => [v.id, !!v.vat_separate]))
      setVatFixCount(findBatchesNeedingVatFix(batchesRes.data, vatSeparateByVendor).length)
      setAllPayments(paymentsRes.data ?? [])
      setLoading(false)
    })
  }, [store, dataKey])

  if (!store) return null

  const { start: monthStart, end: monthEnd } = monthBounds(month)
  const isCurrentMonth = month >= currentMonth()
  const isZero = (n) => Math.abs(Math.round(n)) < 1

  const vendorsWithBalance = vendors
    .map((v) => {
      const ledger = ledgerByVendor.get(v.id)
      const period = ledger ? ledger.period(monthStart, monthEnd) : { carryOver: 0, invoiced: 0, paid: 0, ending: 0 }
      return {
        ...v,
        ...period,
        balance: period.ending,
        issueCount: ledger ? ledger.reconcile().length : 0,
        needsSetup: ledger ? ledger.hasActivity && !ledger.hasOpening : false,
      }
    })
    // 미지급이 큰 거래처부터, 잔액 0원인 거래처는 맨 아래로 모은다.
    .sort((a, b) => {
      if (isZero(a.balance) !== isZero(b.balance)) return isZero(a.balance) ? 1 : -1
      if (isZero(a.balance)) return a.name.localeCompare(b.name)
      return b.balance - a.balance
    })

  const needsSetupCount = vendorsWithBalance.filter((v) => v.needsSetup).length

  const totalBalance = vendorsWithBalance.reduce((sum, v) => sum + v.balance, 0)
  const totalInvoiced = vendorsWithBalance.reduce((sum, v) => sum + v.invoiced, 0)
  const totalPaid = vendorsWithBalance.reduce((sum, v) => sum + v.paid, 0)

  // 전체 거래처 입금액(기간) = 선택한 기간에 실제로 등록된 결제 기록을 전 거래처 걸쳐 더한 값.
  // 결제일 없는 기록은 거래처 상세 화면과 같은 기준으로 제외한다.
  const totalPaymentInPeriod = allPayments
    .filter((p) => p.paid_date && (!paymentDateFrom || p.paid_date >= paymentDateFrom) && (!paymentDateTo || p.paid_date <= paymentDateTo))
    .reduce((sum, p) => sum + Number(p.amount), 0)

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

  const hasVendors = !loading && !error && vendors.length > 0

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/menu')}>
          ← 메인 메뉴
        </button>
        <div className="page-title-row">
          <div>
            <h1>거래처 관리</h1>
            <p className="subtitle">{store.name} · 거래처별 이월 잔액·입고·결제와 미지급금(장부)을 확인해요</p>
          </div>
          {hasVendors && (
            <div className="page-actions">
              <button type="button" className="action-btn" onClick={() => navigate('/vendors/ledger-setup')}>
                장부 시작 설정
              </button>
              <button type="button" className="action-btn" onClick={() => navigate('/vendors/vat-check')}>
                부가세 금액 점검{vatFixCount > 0 ? ` (${vatFixCount}장)` : ''}
              </button>
              <button
                type="button"
                className="action-btn action-btn-primary"
                onClick={() => navigate('/vendors/bulk-payment')}
              >
                💳 일괄 결제 입력 (15일·말일)
              </button>
            </div>
          )}
        </div>
      </div>

      {hasVendors && needsSetupCount > 0 && (
        <div className="price-alert-box">
          <p className="price-alert-title">장부 시작 잔액을 아직 안 넣은 거래처가 {needsSetupCount}곳 있어요</p>
          <p className="hint">시작 잔액(9월 말 잔액)이 없으면 0원부터 계산해서 미지급이 실제와 다를 수 있어요.</p>
        </div>
      )}
      {hasVendors && vatFixCount > 0 && (
        <div className="price-alert-box price-alert-box-danger">
          <p className="price-alert-title">부가세 금액 확인이 필요한 명세표가 {vatFixCount}장 있어요</p>
          <p className="hint">공급가만 들어가 입고액·미지급이 부가세만큼 적게 잡혀 있어요.</p>
        </div>
      )}

      {!supabase && <p className="hint">Supabase가 설정되지 않았습니다.</p>}
      {loading && <p className="hint">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}

      {hasVendors && (
        <div className="kpi-grid">
          <div className="kpi-card">
            <span className="kpi-label">{isCurrentMonth ? '전체 미지급금' : `전체 월말 잔액 (${monthLabel(month)})`}</span>
            <strong className={`kpi-value${totalBalance > 0 ? ' alert-up' : ''}`}>{Math.round(totalBalance).toLocaleString()}원</strong>
          </div>
          <div className="kpi-card">
            <span className="kpi-label">{monthLabel(month)} 입고</span>
            <strong className="kpi-value">{Math.round(totalInvoiced).toLocaleString()}원</strong>
          </div>
          <div className="kpi-card">
            <span className="kpi-label">{monthLabel(month)} 결제</span>
            <strong className="kpi-value">{Math.round(totalPaid).toLocaleString()}원</strong>
          </div>
          <div className="kpi-card">
            <span className="kpi-label">거래처 수</span>
            <strong className="kpi-value">{vendors.length}곳</strong>
          </div>
        </div>
      )}

      <div className="split-layout">
        <div className="split-main">
          {!loading && !error && vendors.length === 0 && <p className="hint">등록된 거래처가 없습니다.</p>}
          {hasVendors && (
            <div className="panel">
              <div className="panel-header">
                <h2 className="panel-title">
                  거래처 목록 <span className="count-badge">{vendors.length}곳</span>
                </h2>
                <div className="month-nav">
                  <button
                    type="button"
                    className="chip"
                    onClick={() => setMonth((m) => shiftMonth(m, -1))}
                    disabled={month <= LEDGER_START_MONTH}
                    aria-label="이전 달"
                  >
                    ◀
                  </button>
                  <strong>{monthLabel(month)}</strong>
                  <button type="button" className="chip" onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="다음 달">
                    ▶
                  </button>
                </div>
              </div>
              <div className="toolbar">
                <input
                  type="search"
                  className="input toolbar-search"
                  placeholder="🔍 거래처명으로 검색"
                  aria-label="거래처 검색"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              {trimmedQuery && <p className="hint">검색 결과 {visibleVendors.length}개</p>}
              {trimmedQuery && visibleVendors.length === 0 && <p className="hint">일치하는 거래처가 없어요.</p>}

              {visibleVendors.length > 0 && (
                <ul className="data-list">
                  <li className="data-head ven-line" aria-hidden="true">
                    <span className="ven-main">
                      <span className="ven-name">거래처</span>
                      <span className="ven-num">지난달 잔액</span>
                      <span className="ven-num">이달 입고</span>
                      <span className="ven-num">이달 결제</span>
                      <span className="ven-balance">{isCurrentMonth ? '현재 미지급' : '월말 잔액'}</span>
                    </span>
                    <span className="ven-actions">관리</span>
                  </li>
                  {visibleVendors.map((v) => (
                    <li key={v.id} className="data-row">
                      <div className="ven-line">
                        <button type="button" className="cost-row-btn ven-main" onClick={() => navigate(`/vendors/${v.id}`)}>
                          <span className="ven-name">
                            <span className="history-item">{v.name}</span>
                            {v.needsSetup && <span className="status-tag status-tag-danger">장부 시작 잔액 미입력</span>}
                            {v.issueCount > 0 && (
                              <span className="status-tag status-tag-danger">⚠️ 명세표 잔액 차이 {v.issueCount}건</span>
                            )}
                          </span>
                          <span className="ven-num" data-label="지난달">
                            {Math.round(v.carryOver).toLocaleString()}
                          </span>
                          <span className="ven-num" data-label="입고">
                            {Math.round(v.invoiced).toLocaleString()}
                          </span>
                          <span className="ven-num" data-label="결제">
                            {Math.round(v.paid).toLocaleString()}
                          </span>
                          <span className={`ven-balance${v.balance > 0 ? ' alert-up' : isZero(v.balance) ? ' paid-badge' : ''}`}>
                            {Math.round(v.balance).toLocaleString()}원
                          </span>
                        </button>
                        <div className="ven-actions">
                          <button
                            type="button"
                            className="mini-btn"
                            onClick={() => navigate(`/vendors/${v.id}`, { state: { scrollTo: 'payment' } })}
                          >
                            결제 입력
                          </button>
                          <button type="button" className="mini-btn mini-btn-danger" onClick={() => openDeleteConfirm(v)}>
                            삭제
                          </button>
                        </div>
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
              )}
            </div>
          )}
        </div>

        <aside className="split-side">
          <div className="panel">
            <h2 className="panel-title">➕ 새 거래처 추가</h2>
            <div className="field">
              <label htmlFor="newVendorName" className="sr-only">
                새 거래처명
              </label>
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
          </div>

          {hasVendors && (
            <div className="panel">
              <h2 className="panel-title">💰 기간별 입금액</h2>
              <div className="date-range">
                <input
                  type="date"
                  className="input"
                  value={paymentDateFrom}
                  onChange={(e) => setPaymentDateFrom(e.target.value)}
                  aria-label="시작일"
                />
                <span className="date-range-sep">~</span>
                <input
                  type="date"
                  className="input"
                  value={paymentDateTo}
                  onChange={(e) => setPaymentDateTo(e.target.value)}
                  aria-label="종료일"
                />
              </div>
              <button
                type="button"
                className="cost-row-btn"
                style={{ marginTop: 8 }}
                onClick={() =>
                  navigate('/vendor-payment-report', { state: { dateRange: { dateFrom: paymentDateFrom, dateTo: paymentDateTo } } })
                }
              >
                <div className="cost-summary-row">
                  <span>전체 입금액 (결제 입금 합계)</span>
                  <strong>{Math.round(totalPaymentInPeriod).toLocaleString()}원</strong>
                </div>
                <p className="hint" style={{ margin: '4px 0 0' }}>거래처별로 보기 →</p>
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
