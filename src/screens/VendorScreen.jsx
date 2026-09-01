import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'

export default function VendorScreen() {
  const { store } = useStore()
  const navigate = useNavigate()

  const [vendors, setVendors] = useState([])
  const [totalsByVendor, setTotalsByVendor] = useState(new Map())
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
      supabase.from('invoice_batches').select('vendor_id, total_amount').eq('store_code', store.code),
    ]).then(([vendorsRes, batchesRes]) => {
      const err = vendorsRes.error || batchesRes.error
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }
      const totals = new Map()
      for (const b of batchesRes.data ?? []) {
        totals.set(b.vendor_id, (totals.get(b.vendor_id) ?? 0) + Number(b.total_amount))
      }
      setVendors(vendorsRes.data ?? [])
      setTotalsByVendor(totals)
      setLoading(false)
    })
  }, [store, dataKey])

  if (!store) return null

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
        <p className="subtitle">{store.name} · 거래처별 입고 내역을 확인해요</p>
      </div>

      {!supabase && <p className="hint">Supabase가 설정되지 않았습니다.</p>}

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
        {vendors.map((v) => (
          <li key={v.id} className="history-row">
            <button type="button" className="cost-row-btn" onClick={() => navigate(`/vendors/${v.id}`)}>
              <div className="history-row-main">
                <span className="history-item">{v.name}</span>
                <span>{Math.round(totalsByVendor.get(v.id) ?? 0).toLocaleString()}원</span>
              </div>
              <div className="history-row-sub">
                <span>누적 입고액</span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
