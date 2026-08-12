import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { latestInvoiceInfoByItem, computeMenuCost } from '../lib/costCalc'

const STATUS_LABEL = {
  unmapped: '재료 매칭 필요',
  no_price: '입고 단가 없음',
  no_amount: '사용량 미입력',
  unit_mismatch: '단가 환산 불가 (개/기타 단위)',
}

const UNIT_LABELS = { g: 'g', kg: 'kg', ea: '개', other: '기타' }

export default function CostDetailScreen() {
  const { store } = useStore()
  const navigate = useNavigate()
  const { menuName: encoded } = useParams()
  const menuName = decodeURIComponent(encoded ?? '')

  const [breakdown, setBreakdown] = useState([])
  const [totalCost, setTotalCost] = useState(0)
  const [hasMissing, setHasMissing] = useState(false)
  const [sellingPrice, setSellingPrice] = useState(null)
  const [priceInput, setPriceInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const [dataKey, setDataKey] = useState(0)

  useEffect(() => {
    if (!store) navigate('/', { replace: true })
  }, [store, navigate])

  useEffect(() => {
    if (!store || !supabase) return
    setLoading(true)
    setError('')
    Promise.all([
      supabase.from('recipes').select('ingredient_name, amount_g').eq('store_code', store.code).eq('menu_name', menuName),
      supabase.from('ingredient_mapping').select('recipe_ingredient_name, invoice_item_name').eq('store_code', store.code),
      supabase.from('invoices').select('item_name, unit_price, unit, created_at').eq('store_code', store.code),
      supabase
        .from('menu_prices')
        .select('selling_price')
        .eq('store_code', store.code)
        .eq('menu_name', menuName)
        .maybeSingle(),
    ]).then(([recipesRes, mappingRes, invoicesRes, priceRes]) => {
      const err = recipesRes.error || mappingRes.error || invoicesRes.error || priceRes.error
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }

      const mappingByIngredient = new Map(
        (mappingRes.data ?? []).map((m) => [m.recipe_ingredient_name, m.invoice_item_name]),
      )
      const infoByItem = latestInvoiceInfoByItem(invoicesRes.data ?? [])
      const { totalCost: cost, hasMissing: missing, breakdown: items } = computeMenuCost({
        recipeRows: recipesRes.data ?? [],
        mappingByIngredient,
        infoByItem,
      })

      setBreakdown(items)
      setTotalCost(cost)
      setHasMissing(missing)

      const sp = priceRes.data?.selling_price != null ? Number(priceRes.data.selling_price) : null
      setSellingPrice(sp)
      setPriceInput(sp != null ? String(sp) : '')
      setLoading(false)
    })
  }, [store, menuName, dataKey])

  if (!store) return null

  const previewPrice = priceInput === '' ? null : Number(priceInput)
  const effectivePrice = Number.isFinite(previewPrice) && previewPrice > 0 ? previewPrice : null
  const ratio = effectivePrice ? (totalCost / effectivePrice) * 100 : null
  const margin = effectivePrice ? effectivePrice - totalCost : null

  const handleSavePrice = async () => {
    if (!supabase) return
    if (effectivePrice == null) {
      setError('판매가를 0보다 크게 입력하세요.')
      return
    }
    setSaving(true)
    setError('')
    setSaveMessage('')
    const { error: err } = await supabase.from('menu_prices').upsert(
      {
        store_code: store.code,
        menu_name: menuName,
        selling_price: effectivePrice,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'store_code,menu_name' },
    )
    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }
    setSaveMessage('판매가를 저장했습니다.')
    setDataKey((k) => k + 1)
  }

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/cost')}>
          ← 원가 확인 목록
        </button>
        <h1>{menuName}</h1>
        <p className="subtitle">{store.name} · 재료별 원가 상세</p>
      </div>

      {!supabase && <p className="hint">Supabase가 설정되지 않았습니다.</p>}
      {loading && <p className="hint">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}

      {!loading && supabase && (
        <>
          <div className="cost-summary">
            <div className="cost-summary-row">
              <span>재료 원가</span>
              <strong>{Math.round(totalCost).toLocaleString()}원</strong>
            </div>

            <div className="field">
              <label htmlFor="sellingPrice">판매가</label>
              <input
                id="sellingPrice"
                className="input"
                inputMode="decimal"
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                placeholder="예: 15000"
              />
            </div>
            <button type="button" className="btn-secondary" onClick={handleSavePrice} disabled={saving}>
              {saving ? '저장 중...' : sellingPrice != null ? '판매가 수정' : '판매가 저장'}
            </button>
            {saveMessage && <p className="success-text">{saveMessage}</p>}

            {ratio != null ? (
              <>
                <div className="cost-summary-row">
                  <span>원가율</span>
                  <strong className={ratio >= 40 ? 'alert-up' : ratio <= 25 ? 'alert-down' : ''}>
                    {ratio.toFixed(1)}%
                  </strong>
                </div>
                <div className="cost-summary-row">
                  <span>마진</span>
                  <strong>{Math.round(margin).toLocaleString()}원</strong>
                </div>
              </>
            ) : (
              <p className="hint">판매가를 입력하면 원가율과 마진이 계산됩니다.</p>
            )}

            {hasMissing && <p className="hint">일부 재료는 매칭 또는 단가 정보가 없어 원가에서 제외됐습니다.</p>}
          </div>

          <h2 className="section-title">재료별 원가</h2>
          {breakdown.length === 0 && <p className="hint">이 메뉴의 재료 정보가 없습니다.</p>}
          <ul className="history-list">
            {breakdown.map((item) => (
              <li key={item.ingredientName} className="history-row">
                <div className="history-row-main">
                  <span className="history-item">{item.ingredientName}</span>
                  <span>{item.cost != null ? `${Math.round(item.cost).toLocaleString()}원` : STATUS_LABEL[item.status]}</span>
                </div>
                <div className="history-row-sub">
                  {item.amountG != null && <span>{item.amountG}g</span>}
                  {item.mappedItem && <span>→ {item.mappedItem}</span>}
                  {item.unitPrice != null && (
                    <span>
                      단가 {item.unitPrice.toLocaleString()}원{item.unit ? `/${UNIT_LABELS[item.unit] ?? item.unit}` : ''}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
