import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { rowsToCsv, downloadCsv } from '../lib/csvExport'

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

export default function BackupScreen() {
  const { store } = useStore()
  const navigate = useNavigate()
  const [loadingKey, setLoadingKey] = useState(null)
  const [error, setError] = useState('')
  const [doneKeys, setDoneKeys] = useState(new Set())

  useEffect(() => {
    if (!store) navigate('/', { replace: true })
  }, [store, navigate])

  if (!store) return null

  const fetchVendorNames = async () => {
    const { data, error: err } = await supabase.from('vendors').select('id, name').eq('store_code', store.code)
    if (err) throw err
    return new Map((data ?? []).map((v) => [v.id, v.name]))
  }

  const exporters = [
    {
      key: 'vendors',
      label: '거래처 목록',
      run: async () => {
        const { data, error: err } = await supabase
          .from('vendors')
          .select('name, vat_separate')
          .eq('store_code', store.code)
          .order('name')
        if (err) throw err
        return rowsToCsv(data ?? [], [
          { label: '거래처명', value: 'name' },
          { label: '부가세별도', value: (r) => (r.vat_separate ? 'Y' : 'N') },
        ])
      },
    },
    {
      key: 'batches',
      label: '입고 명세표',
      run: async () => {
        const vendorNames = await fetchVendorNames()
        const { data, error: err } = await supabase
          .from('invoice_batches')
          .select('vendor_id, invoice_date, total_amount, statement_balance, current_balance, created_at')
          .eq('store_code', store.code)
          .order('invoice_date')
        if (err) throw err
        return rowsToCsv(data ?? [], [
          { label: '거래처', value: (r) => vendorNames.get(r.vendor_id) ?? '' },
          { label: '입고일', value: (r) => r.invoice_date ?? r.created_at?.slice(0, 10) },
          { label: '합계금액', value: 'total_amount' },
          { label: '전잔액', value: 'statement_balance' },
          { label: '현잔액', value: 'current_balance' },
        ])
      },
    },
    {
      key: 'invoices',
      label: '입고 품목 상세',
      run: async () => {
        const { data, error: err } = await supabase
          .from('invoices')
          .select('vendor, item_name, quantity, unit_price, unit, amount, vat, invoice_date, created_at')
          .eq('store_code', store.code)
          .order('invoice_date')
        if (err) throw err
        return rowsToCsv(data ?? [], [
          { label: '거래처', value: 'vendor' },
          { label: '입고일', value: (r) => r.invoice_date ?? r.created_at?.slice(0, 10) },
          { label: '품목명', value: 'item_name' },
          { label: '수량', value: 'quantity' },
          { label: '단가', value: 'unit_price' },
          { label: '단위', value: 'unit' },
          { label: '금액', value: 'amount' },
          { label: '부가세', value: 'vat' },
        ])
      },
    },
    {
      key: 'payments',
      label: '결제 기록',
      run: async () => {
        const vendorNames = await fetchVendorNames()
        const { data, error: err } = await supabase
          .from('vendor_payments')
          .select('vendor_id, amount, paid_date, memo')
          .eq('store_code', store.code)
          .order('paid_date')
        if (err) throw err
        return rowsToCsv(data ?? [], [
          { label: '거래처', value: (r) => vendorNames.get(r.vendor_id) ?? '' },
          { label: '결제일', value: 'paid_date' },
          { label: '금액', value: 'amount' },
          { label: '메모', value: 'memo' },
        ])
      },
    },
    {
      key: 'openingBalances',
      label: '기초 잔액',
      run: async () => {
        const vendorNames = await fetchVendorNames()
        const { data, error: err } = await supabase
          .from('vendor_opening_balances')
          .select('vendor_id, as_of_date, balance, memo')
          .eq('store_code', store.code)
          .order('as_of_date')
        if (err) throw err
        return rowsToCsv(data ?? [], [
          { label: '거래처', value: (r) => vendorNames.get(r.vendor_id) ?? '' },
          { label: '기준일', value: 'as_of_date' },
          { label: '잔액', value: 'balance' },
          { label: '메모', value: 'memo' },
        ])
      },
    },
    {
      key: 'settlements',
      label: '매장운영결산',
      run: async () => {
        const { data, error: err } = await supabase
          .from('store_settlements')
          .select('year, month, revenue, ingredient_cost, labor_cost, general_cost, total_expense, operating_profit, pretax_profit')
          .eq('store_code', store.code)
          .order('year')
          .order('month')
        if (err) throw err
        return rowsToCsv(data ?? [], [
          { label: '연도', value: 'year' },
          { label: '월', value: 'month' },
          { label: '총매출액', value: 'revenue' },
          { label: '총식재료비', value: 'ingredient_cost' },
          { label: '인건비', value: 'labor_cost' },
          { label: '일반경비', value: 'general_cost' },
          { label: '지출총합계', value: 'total_expense' },
          { label: '영업손익', value: 'operating_profit' },
          { label: '소득세차감전이익', value: 'pretax_profit' },
        ])
      },
    },
  ]

  const handleExport = async (exp) => {
    if (!supabase) return
    setLoadingKey(exp.key)
    setError('')
    try {
      const csv = await exp.run()
      downloadCsv(`${store.name}_${exp.label}_${todayStr()}.csv`, csv)
      setDoneKeys((prev) => new Set(prev).add(exp.key))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoadingKey(null)
    }
  }

  const handleExportAll = async () => {
    for (const exp of exporters) {
      // eslint-disable-next-line no-await-in-loop
      await handleExport(exp)
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 400))
    }
  }

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/menu')}>
          ← 메인 메뉴
        </button>
        <h1>데이터 백업</h1>
        <p className="subtitle">{store.name} · 거래처·입고·결제 자료를 CSV 파일로 내려받아요</p>
      </div>

      {!supabase && <p className="hint">Supabase가 설정되지 않았습니다.</p>}
      {error && <p className="error-text">{error}</p>}
      <p className="hint">
        Supabase가 매일 자동으로 백업하지만 7일이 지나면 사라지고, 복원도 그 시점 전체로 되돌리는 방식이에요. 월말·분기
        말처럼 중요한 시점마다 여기서 CSV로 따로 받아 컴퓨터나 구글드라이브에 보관해두시는 걸 추천드려요.
      </p>

      <button type="button" className="btn-primary" onClick={handleExportAll} disabled={loadingKey != null}>
        {loadingKey ? '내려받는 중...' : '전체 한번에 내려받기'}
      </button>

      <ul className="history-list" style={{ marginTop: 16 }}>
        {exporters.map((exp) => (
          <li key={exp.key} className="history-row">
            <div className="history-row-main">
              <span className="history-item">
                {exp.label}
                {doneKeys.has(exp.key) ? ' ✓' : ''}
              </span>
              <button
                type="button"
                className="btn-secondary"
                style={{ marginTop: 0, width: 'auto', padding: '8px 14px' }}
                onClick={() => handleExport(exp)}
                disabled={loadingKey != null}
              >
                {loadingKey === exp.key ? '내려받는 중...' : 'CSV 내려받기'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
