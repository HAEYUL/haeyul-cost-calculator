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

function matchVendor(vendors, name) {
  if (!name) return null
  const norm = name.trim().toLowerCase()
  if (!norm) return null
  return vendors.find((v) => v.name.trim().toLowerCase() === norm) ?? null
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)])
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[a.length][b.length]
}

// 완전히 같은 이름은 아니지만 오타/표기 차이로 같은 거래처일 가능성이 있는 기존 거래처를 찾는다
// (예: "권스유통" vs "퀸스유통"). 저장 전에 사용자에게 확인을 받아 거래처가 쪼개지는 걸 막는다.
function findSimilarVendor(vendors, name) {
  if (!name) return null
  const norm = name.trim().toLowerCase()
  if (!norm) return null
  let best = null
  let bestSimilarity = 0
  for (const v of vendors) {
    const vNorm = v.name.trim().toLowerCase()
    if (vNorm === norm) continue
    const maxLen = Math.max(norm.length, vNorm.length)
    if (maxLen === 0) continue
    const similarity = 1 - levenshtein(norm, vNorm) / maxLen
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity
      best = v
    }
  }
  return bestSimilarity >= 0.6 ? best : null
}

function itemAmount(item) {
  if (item.amount !== '') return Number(item.amount)
  const q = item.quantity === '' ? null : Number(item.quantity)
  const p = item.unitPrice === '' ? null : Number(item.unitPrice)
  return q != null && p != null ? q * p : 0
}

export default function InvoiceScreen() {
  const { store } = useStore()
  const navigate = useNavigate()

  const [previewUrl, setPreviewUrl] = useState(null)
  const [pendingImage, setPendingImage] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzed, setAnalyzed] = useState(false)
  const [error, setError] = useState('')
  const [vendors, setVendors] = useState([])
  const [vendorsVersion, setVendorsVersion] = useState(0)
  const [vendorId, setVendorId] = useState('')
  const [newVendorName, setNewVendorName] = useState('')
  const [similarVendorPrompt, setSimilarVendorPrompt] = useState(null)
  const [date, setDate] = useState('')
  const [statementBalance, setStatementBalance] = useState('')
  const [items, setItems] = useState([])
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const [priceChanges, setPriceChanges] = useState([])
  const [historyKey, setHistoryKey] = useState(0)
  const [duplicateWarning, setDuplicateWarning] = useState(null)

  useEffect(() => {
    if (!store) navigate('/', { replace: true })
  }, [store, navigate])

  useEffect(() => {
    if (!store || !supabase) return
    supabase
      .from('vendors')
      .select('id, name')
      .eq('store_code', store.code)
      .order('name')
      .then(({ data, error: err }) => {
        if (!err) setVendors(data ?? [])
      })
  }, [store, vendorsVersion])

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
      setVendorId('')
      setNewVendorName('')
      setSimilarVendorPrompt(null)
      setDate('')
      setStatementBalance('')
      setItems([])
      setDuplicateWarning(null)
      setAnalyzed(false)
    } catch (err) {
      setError(err.message)
    }
  }

  const handleAnalyze = async () => {
    if (!pendingImage) return
    setAnalyzing(true)
    setError('')
    setAnalyzed(false)
    try {
      const res = await fetch('/api/analyze-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pendingImage),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '분석에 실패했습니다')
      const matched = matchVendor(vendors, data.vendor)
      if (matched) {
        setVendorId(matched.id)
        setNewVendorName('')
        setSimilarVendorPrompt(null)
      } else if (data.vendor) {
        const similar = findSimilarVendor(vendors, data.vendor)
        if (similar) {
          setVendorId('')
          setNewVendorName('')
          setSimilarVendorPrompt({ existingVendor: similar, newName: data.vendor })
        } else {
          setVendorId('new')
          setNewVendorName(data.vendor)
          setSimilarVendorPrompt(null)
        }
      } else {
        setVendorId('')
        setNewVendorName('')
        setSimilarVendorPrompt(null)
      }
      setDate(data.date ?? '')
      setStatementBalance(data.statementBalance != null ? String(data.statementBalance) : '')
      setItems(
        (data.items ?? []).map((item) => ({
          name: item.name ?? '',
          quantity: item.quantity ?? '',
          unitPrice: item.unitPrice ?? '',
          unit: item.unit ?? 'kg',
          amount: item.amount ?? '',
        })),
      )
      setAnalyzed(true)
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

  const handleSave = async (skipDuplicateCheck = false) => {
    if (!supabase) {
      setError('Supabase가 설정되지 않아 저장할 수 없습니다.')
      return
    }
    if (vendorId === 'new' && !newVendorName.trim()) {
      setError('새 거래처명을 입력하세요.')
      return
    }
    if (!vendorId || items.length === 0) {
      setError('거래처와 최소 1개의 품목이 필요합니다.')
      return
    }

    setSaving(true)
    setError('')
    setSaveMessage('')
    setPriceChanges([])
    setDuplicateWarning(null)

    let resolvedVendorId = vendorId
    let resolvedVendorName
    let didCreateVendor = false

    if (vendorId === 'new') {
      const trimmedName = newVendorName.trim()
      const { data: vendorRow, error: vendorErr } = await supabase
        .from('vendors')
        .upsert({ store_code: store.code, name: trimmedName }, { onConflict: 'store_code,name' })
        .select('id, name')
        .single()
      if (vendorErr) {
        setSaving(false)
        setError(vendorErr.message)
        return
      }
      resolvedVendorId = vendorRow.id
      resolvedVendorName = vendorRow.name
      didCreateVendor = true
    } else {
      resolvedVendorName = vendors.find((v) => v.id === vendorId)?.name ?? ''
    }

    const validItems = items.filter((item) => item.name.trim())

    // 같은 거래처 + 같은 날짜로 이미 저장된 전표가 있고 물품 구성까지 같으면 같은 사진을
    // 다시 올린 것으로 보고 저장 전에 경고한다 (날짜 미입력이면 비교할 수 없어 건너뜀).
    if (!skipDuplicateCheck && date) {
      const { data: existingBatches, error: dupErr } = await supabase
        .from('invoice_batches')
        .select('id, invoices(item_name)')
        .eq('store_code', store.code)
        .eq('vendor_id', resolvedVendorId)
        .eq('invoice_date', date)

      if (dupErr) {
        setSaving(false)
        setError(dupErr.message)
        return
      }

      const currentNames = new Set(validItems.map((item) => item.name.trim()))
      const duplicateBatch = (existingBatches ?? []).find((b) => {
        const existingNames = new Set((b.invoices ?? []).map((i) => i.item_name))
        return existingNames.size === currentNames.size && [...existingNames].every((n) => currentNames.has(n))
      })

      if (duplicateBatch) {
        setSaving(false)
        setDuplicateWarning({
          vendorName: resolvedVendorName,
          date,
          itemNames: [...currentNames],
        })
        if (didCreateVendor) setVendorsVersion((v) => v + 1)
        return
      }
    }

    // 같은 거래처의 이전 입고 내역에서 품목별 최근 단가를 조회 (물품명 정확히 일치만 비교)
    const { data: history, error: historyErr } = await supabase
      .from('invoices')
      .select('item_name, unit_price, created_at')
      .eq('store_code', store.code)
      .eq('vendor_id', resolvedVendorId)
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

    const totalAmount = validItems.reduce((sum, item) => sum + itemAmount(item), 0)

    const { data: batch, error: batchErr } = await supabase
      .from('invoice_batches')
      .insert({
        store_code: store.code,
        vendor_id: resolvedVendorId,
        invoice_date: date || null,
        total_amount: totalAmount,
        statement_balance: statementBalance === '' ? null : Number(statementBalance),
      })
      .select('id')
      .single()

    if (batchErr) {
      setSaving(false)
      setError(batchErr.message)
      return
    }

    const rows = validItems.map((item) => ({
      store_code: store.code,
      vendor: resolvedVendorName,
      vendor_id: resolvedVendorId,
      batch_id: batch.id,
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
        vendor: resolvedVendorName,
        vendor_id: resolvedVendorId,
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
    setAnalyzed(false)
    setVendorId('')
    setNewVendorName('')
    setSimilarVendorPrompt(null)
    setDate('')
    setStatementBalance('')
    setItems([])
    if (didCreateVendor) setVendorsVersion((v) => v + 1)
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
        <div className="screen-header-row">
          <span />
          <button type="button" className="link-btn" onClick={() => navigate('/vendors')}>
            거래처 관리 →
          </button>
        </div>
        <h1>입고 입력</h1>
        <p className="subtitle">{store.name} · 거래명세표 사진을 올리면 자동으로 읽어드려요</p>
      </div>

      <div className="upload-btn-row">
        <label className="upload-btn">
          {previewUrl ? '다른 사진 선택' : '사진 선택'}
          <input type="file" accept="image/*" onChange={handleFileChange} hidden />
        </label>
        <label className="upload-btn">
          카메라로 촬영
          <input type="file" accept="image/*" capture="environment" onChange={handleFileChange} hidden />
        </label>
      </div>

      {previewUrl && (
        <div className="photo-preview">
          <img src={previewUrl} alt="거래명세표 미리보기" />
        </div>
      )}

      {previewUrl && (
        <button type="button" className="btn-primary" onClick={handleAnalyze} disabled={analyzing || analyzed}>
          {analyzing ? '분석 중...' : analyzed ? '분석완료' : '분석하기'}
        </button>
      )}

      {error && <p className="error-text">{error}</p>}
      {saveMessage && <p className="success-text">{saveMessage}</p>}

      {duplicateWarning && (
        <div className="price-alert-box">
          <p className="price-alert-title">이미 입고된 내역이 있어요</p>
          <p className="hint">
            {duplicateWarning.vendorName} · {duplicateWarning.date} 에 같은 물품({duplicateWarning.itemNames.join(', ')})으로
            저장된 입고 내역이 있습니다. 같은 사진을 다시 올린 게 아닌지 확인해주세요.
          </p>
          <div className="invoice-form">
            <button type="button" className="btn-secondary" onClick={() => setDuplicateWarning(null)}>
              취소
            </button>
            <button type="button" className="btn-primary" onClick={() => handleSave(true)} disabled={saving}>
              {saving ? '저장 중...' : '그래도 저장'}
            </button>
          </div>
        </div>
      )}

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

      {similarVendorPrompt && (
        <div className="price-alert-box">
          <p className="price-alert-title">비슷한 거래처가 있어요</p>
          <p className="hint">
            "{similarVendorPrompt.newName}"과(와) 기존 거래처 "{similarVendorPrompt.existingVendor.name}"이(가) 같은 곳인가요?
          </p>
          <div className="invoice-form">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setVendorId('new')
                setNewVendorName(similarVendorPrompt.newName)
                setSimilarVendorPrompt(null)
              }}
            >
              아니요, 새 거래처예요
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setVendorId(similarVendorPrompt.existingVendor.id)
                setNewVendorName('')
                setSimilarVendorPrompt(null)
              }}
            >
              네, 같은 거래처예요
            </button>
          </div>
        </div>
      )}

      <div className="field">
        <label htmlFor="vendor">거래처</label>
        <select
          id="vendor"
          className="select select-block"
          value={vendorId}
          onChange={(e) => setVendorId(e.target.value)}
        >
          <option value="">거래처 선택...</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
          <option value="new">+ 새 거래처 추가</option>
        </select>
      </div>

      {vendorId === 'new' && (
        <div className="field">
          <label htmlFor="newVendor">새 거래처명</label>
          <input
            id="newVendor"
            className="input"
            value={newVendorName}
            onChange={(e) => setNewVendorName(e.target.value)}
            placeholder="예: 국일농산"
          />
        </div>
      )}
      <div className="field">
        <label htmlFor="date">입고일</label>
        <input id="date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="statementBalance">명세표 잔액(현잔액/총잔금, 있으면)</label>
        <input
          id="statementBalance"
          className="input"
          inputMode="decimal"
          value={statementBalance}
          onChange={(e) => setStatementBalance(e.target.value)}
          placeholder="예: 3054500"
        />
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
        {(vendorId || items.length > 0) && (
          <button type="button" className="btn-primary" onClick={() => handleSave()} disabled={saving}>
            {saving ? '저장 중...' : '저장'}
          </button>
        )}
      </div>

      <InvoiceHistory storeCode={store.code} refreshKey={historyKey} />
    </div>
  )
}
