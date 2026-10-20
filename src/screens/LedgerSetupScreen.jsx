import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import AmountInput from '../components/AmountInput'
import { LEDGER_START, addDays, groupByVendor, suggestOpening } from '../lib/vendorLedger'

// 장부 시작 설정: 거래처마다 장부 시작일 전날(9월 말) 잔액을 한 번 정한다. 명세표 잔액으로
// 계산한 값을 미리 채워두고, 사장님은 확인·수정 후 한 번에 저장한다.
export default function LedgerSetupScreen() {
  const { store } = useStore()
  const navigate = useNavigate()

  const [rows, setRows] = useState([])
  const [inputs, setInputs] = useState({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

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
        .select('id, vendor_id, total_amount, invoice_date, statement_balance, current_balance, created_at')
        .eq('store_code', store.code),
      supabase.from('vendor_payments').select('vendor_id, amount, paid_date').eq('store_code', store.code),
      supabase
        .from('vendor_opening_balances')
        .select('vendor_id, balance')
        .eq('store_code', store.code)
        .eq('as_of_date', LEDGER_START),
    ]).then(([vendorsRes, batchesRes, paymentsRes, openingRes]) => {
      const err = vendorsRes.error || batchesRes.error || paymentsRes.error || openingRes.error
      setLoading(false)
      if (err) {
        setError(err.message)
        return
      }
      const batchesByVendor = groupByVendor(batchesRes.data)
      const paymentsByVendor = groupByVendor(paymentsRes.data)
      const savedByVendor = new Map((openingRes.data ?? []).map((o) => [o.vendor_id, Number(o.balance)]))

      const nextRows = (vendorsRes.data ?? []).map((v) => ({
        ...v,
        saved: savedByVendor.has(v.id) ? savedByVendor.get(v.id) : null,
        suggestion: suggestOpening({ batches: batchesByVendor.get(v.id), payments: paymentsByVendor.get(v.id) }),
      }))
      // 아직 저장 안 한 거래처를 위로 올려 확인할 곳부터 보이게 한다.
      nextRows.sort((a, b) => Number(a.saved != null) - Number(b.saved != null))
      setRows(nextRows)
      setInputs(
        Object.fromEntries(
          nextRows.map((r) => [
            r.id,
            r.saved != null ? String(Math.round(r.saved)) : r.suggestion ? String(Math.round(r.suggestion.amount)) : '',
          ]),
        ),
      )
    })
  }, [store])

  if (!store) return null

  const handleSave = async () => {
    const upserts = rows
      .filter((r) => inputs[r.id] !== '' && inputs[r.id] != null)
      .map((r) => ({ store_code: store.code, vendor_id: r.id, as_of_date: LEDGER_START, balance: Number(inputs[r.id]) }))
    if (upserts.length === 0) {
      setError('저장할 잔액을 하나 이상 입력하세요.')
      return
    }
    setSaving(true)
    setError('')
    const { error: err } = await supabase
      .from('vendor_opening_balances')
      .upsert(upserts, { onConflict: 'vendor_id,as_of_date' })
    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }
    navigate('/vendors')
  }

  const unsavedCount = rows.filter((r) => r.saved == null).length

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/vendors')}>
          ← 거래처 관리
        </button>
        <h1>장부 시작 설정</h1>
        <p className="subtitle">
          {store.name} · {LEDGER_START} 시작 ({addDays(LEDGER_START, -1)} 기준 잔액)
        </p>
      </div>

      <p className="hint">
        거래처마다 {addDays(LEDGER_START, -1)}까지 남아 있던 미지급 잔액을 넣어주세요. 명세표 잔액으로 계산한 값을 미리
        채워뒀어요. 거래처 장부와 다르면 고친 뒤 저장하면 돼요. 외상이 없는 거래처는 0으로 두세요.
      </p>

      {!supabase && <p className="hint">Supabase가 설정되지 않았습니다.</p>}
      {loading && <p className="hint">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}
      {!loading && unsavedCount > 0 && <p className="hint">아직 저장하지 않은 거래처 {unsavedCount}곳</p>}

      <ul className="history-list">
        {rows.map((r) => (
          <li key={r.id} className="history-row">
            <div className="history-row-main">
              <span className="history-item">{r.name}</span>
              <span className={r.saved != null ? 'paid-badge' : 'hint'}>{r.saved != null ? '✓ 저장됨' : '미저장'}</span>
            </div>
            <AmountInput
              className="input"
              value={inputs[r.id] ?? ''}
              onChange={(value) => setInputs((prev) => ({ ...prev, [r.id]: value }))}
              placeholder="예: 3,000,000"
              aria-label={`${r.name} 장부 시작 잔액`}
            />
            <p className="hint" style={{ margin: '4px 0 0' }}>
              {r.suggestion
                ? `제안 ${Math.round(r.suggestion.amount).toLocaleString()}원 · ${r.suggestion.source}`
                : '명세표 잔액 정보가 없어 계산할 수 없어요. 직접 넣어주세요.'}
            </p>
          </li>
        ))}
      </ul>

      {rows.length > 0 && (
        <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? '저장 중...' : '모두 저장'}
        </button>
      )}
    </div>
  )
}
