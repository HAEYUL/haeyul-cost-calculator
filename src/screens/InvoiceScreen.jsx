import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { compressImage } from '../lib/compressImage'
import InvoiceHistory from '../components/InvoiceHistory'

const UNIT_LABELS = { g: 'g', kg: 'kg', ea: '개', other: '기타' }

function emptyItem() {
  return { name: '', quantity: '', unitPrice: '', unit: 'kg', amount: '' }
}

export default function InvoiceScreen() {
  const { store } = useStore()
  const navigate = useNavigate()

  const [previewUrl, setPreviewUrl] = useState(null)
  const [pendingImage, setPendingImage] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState('')
  const [vendor, setVendor] = useState('')
  const [date, setDate] = useState('')
  const [items, setItems] = useState([])
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const [priceChanges, setPriceChanges] = useState([])
  const [historyKey, setHistoryKey] = useState(0)

  useEffect(() => {
    if (!store) navigate('/', { replace: true })
  }, [store, navigate])

  if (!store) return null

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    setSaveMessage('')
    try {
      const { base64, mediaType, previewUrl: preview } = await compressImage(file)
      setPendingImage({ imageBase64: base64, mediaType })
      setPreviewUrl(preview)
      setVendor('')
      setDate('')
      setItems([])
    } catch (err) {
      setError(err.message)
    }
  }

  const handleAnalyze = async () => {
    if (!pendingImage) return
    setAnalyzing(true)
    setError('')
    try {
      const res = await fetch('/api/analyze-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pendingImage),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '분석에 실패했습니다')
      setVendor(data.vendor ?? '')
      setDate(data.date ?? '')
      setItems(
        (data.items ?? []).map((item) => ({
          name: item.name ?? '',
          quantity: item.quantity ?? '',
          unitPrice: item.unitPrice ?? '',
          unit: item.unit ?? 'kg',
          amount: item.amount ?? '',
        })),
      )
    } catch (err) {
      setError(err.message)
    } finally {
      setAnalyzing(false)
    }
  }

  const updateItem = (index, field, value) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)))
  }

  const addItem = () => setItems((prev) => [...prev, emptyItem()])
  const removeItem = (index) => setItems((prev) => prev.filter((_, i) => i !== index))

  const handleSave = async () => {
    if (!supabase) {
      setError('Supabase가 설정되지 않아 저장할 수 없습니다.')
      return
    }
    if (!vendor.trim() || items.length === 0) {
      setError('거래처명과 최소 1개의 품목이 필요합니다.')
      return
    }

    setSaving(true)
    setError('')
    setSaveMessage('')
    setPriceChanges([])

    const trimmedVendor = vendor.trim()
    const validItems = items.filter((item) => item.name.trim())

    // 같은 거래처의 이전 입고 내역에서 품목별 최근 단가를 조회 (물품명 정확히 일치만 비교)
    const { data: history, error: historyErr } = await supabase
      .from('invoices')
      .select('item_name, unit_price, created_at')
      .eq('store_code', store.code)
      .eq('vendor', trimmedVendor)
      .order('created_at', { ascending: false })

    if (historyErr) {
      setSaving(false)
      setError(historyErr.message)
      return
    }

    const latestPriceByItem = new Map()
    for (const row of history ?? []) {
      if (!latestPriceByItem.has(row.item_name) && row.unit_price != null) {
        latestPriceByItem.set(row.item_name, Number(row.unit_price))
      }
    }

    const changes = []
    for (const item of validItems) {
      const name = item.name.trim()
      const newPrice = item.unitPrice === '' ? null : Number(item.unitPrice)
      const prevPrice = latestPriceByItem.get(name)
      if (newPrice != null && prevPrice != null && newPrice !== prevPrice) {
        changes.push({ itemName: name, previousPrice: prevPrice, newPrice })
      }
    }

    const rows = validItems.map((item) => ({
      store_code: store.code,
      vendor: trimmedVendor,
      item_name: item.name.trim(),
      quantity: item.quantity === '' ? null : Number(item.quantity),
      unit_price: item.unitPrice === '' ? null : Number(item.unitPrice),
      unit: item.unit || null,
      amount: item.amount === '' ? null : Number(item.amount),
      invoice_date: date || null,
    }))

    const { error: insertErr } = await supabase.from('invoices').insert(rows)
    if (insertErr) {
      setSaving(false)
      setError(insertErr.message)
      return
    }

    if (changes.length > 0) {
      const changeRows = changes.map((c) => ({
        store_code: store.code,
        vendor: trimmedVendor,
        item_name: c.itemName,
        previous_price: c.previousPrice,
        new_price: c.newPrice,
      }))
      const { error: changeErr } = await supabase.from('price_changes').insert(changeRows)
      if (changeErr) console.error(changeErr)
    }

    setSaving(false)
    setSaveMessage('저장했습니다.')
    setPriceChanges(changes)
    setHistoryKey((k) => k + 1)
    setPendingImage(null)
    setPreviewUrl(null)
    setVendor('')
    setDate('')
    setItems([])
  }

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <div className="screen-header-row">
          <button type="button" className="link-btn" onClick={() => navigate('/menu')}>
            ← 메인 메뉴
          </button>
          <button type="button" className="link-btn" onClick={() => navigate('/price-alerts')}>
            단가 변동 알림함 →
          </button>
        </div>
        <h1>입고 입력</h1>
        <p className="subtitle">{store.name} · 거래명세표 사진을 올리면 자동으로 읽어드려요</p>
      </div>

      <label className="upload-btn">
        {previewUrl ? '다른 사진 선택' : '거래명세표 사진 선택'}
        <input type="file" accept="image/*" capture="environment" onChange={handleFileChange} hidden />
      </label>

      {previewUrl && (
        <div className="photo-preview">
          <img src={previewUrl} alt="거래명세표 미리보기" />
        </div>
      )}

      {previewUrl && (
        <button type="button" className="btn-primary" onClick={handleAnalyze} disabled={analyzing}>
          {analyzing ? '분석 중...' : '분석하기'}
        </button>
      )}

      {error && <p className="error-text">{error}</p>}
      {saveMessage && <p className="success-text">{saveMessage}</p>}

      {priceChanges.length > 0 && (
        <div className="price-alert-box">
          <p className="price-alert-title">단가가 변경된 품목이 있어요</p>
          <ul className="price-alert-list">
            {priceChanges.map((c) => {
              const diff = c.newPrice - c.previousPrice
              const pct = c.previousPrice !== 0 ? (diff / c.previousPrice) * 100 : null
              const up = diff > 0
              return (
                <li key={c.itemName} className={up ? 'alert-up' : 'alert-down'}>
                  {c.itemName}: {c.previousPrice.toLocaleString()}원 → {c.newPrice.toLocaleString()}원
                  {pct !== null && ` (${up ? '▲' : '▼'}${Math.abs(pct).toFixed(1)}%)`}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div className="field">
        <label htmlFor="vendor">거래처명</label>
        <input
          id="vendor"
          className="input"
          value={vendor}
          onChange={(e) => setVendor(e.target.value)}
          placeholder="예: 국일농산"
        />
      </div>
      <div className="field">
        <label htmlFor="date">입고일</label>
        <input id="date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      {items.length > 0 && (
        <div className="item-table-wrap">
          <div className="item-table">
            <div className="item-row item-row-head">
              <span>물품명</span>
              <span>단가 기준</span>
              <span>수량</span>
              <span>단가</span>
              <span>금액</span>
              <span />
            </div>
            {items.map((item, index) => (
              <div className="item-row" key={index}>
                <input
                  className="input"
                  value={item.name}
                  onChange={(e) => updateItem(index, 'name', e.target.value)}
                  placeholder="물품명"
                />
                <select
                  className="select"
                  value={item.unit || 'kg'}
                  onChange={(e) => updateItem(index, 'unit', e.target.value)}
                >
                  {Object.entries(UNIT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <input
                  className="input"
                  inputMode="decimal"
                  value={item.quantity}
                  onChange={(e) => updateItem(index, 'quantity', e.target.value)}
                  placeholder="수량"
                />
                <input
                  className="input"
                  inputMode="decimal"
                  value={item.unitPrice}
                  onChange={(e) => updateItem(index, 'unitPrice', e.target.value)}
                  placeholder="단가"
                />
                <input
                  className="input"
                  inputMode="decimal"
                  value={item.amount}
                  onChange={(e) => updateItem(index, 'amount', e.target.value)}
                  placeholder="금액"
                />
                <button type="button" className="icon-btn" onClick={() => removeItem(index)} aria-label="행 삭제">
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="invoice-form">
        <button type="button" className="btn-secondary" onClick={addItem}>
          + 품목 추가
        </button>
        {(vendor.trim() || items.length > 0) && (
          <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '저장 중...' : '저장'}
          </button>
        )}
      </div>

      <InvoiceHistory storeCode={store.code} refreshKey={historyKey} />
    </div>
  )
}
