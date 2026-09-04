import { Fragment, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { compressImage } from '../lib/compressImage'
import InvoiceHistory from '../components/InvoiceHistory'
import { latestInvoiceInfoByItem, computeMenuCost } from '../lib/costCalc'

const UNIT_LABELS = { g: 'g', kg: 'kg', ea: '개', other: '기타' }
const MARGIN_WARNING_RATIO = 40

function emptyItem() {
  return { name: '', quantity: '', unitPrice: '', unit: 'kg', amount: '' }
}

function base64ToBlob(base64, mediaType) {
  const byteChars = atob(base64)
  const bytes = new Uint8Array(byteChars.length)
  for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i)
  return new Blob([bytes], { type: mediaType })
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

// 완전히 같은 이름은 아니지만 오타/표기 차이로 같은 물품일 가능성이 있는 기존 물품명을 찾는다.
// 거래처(0.6)보다 훨씬 엄격한 기준(0.9)을 쓰는 이유는, 물품명은 "돼지고기 앞다리" vs
// "돼지고기 뒷다리"처럼 비슷해 보여도 실제로는 다른 품목인 경우가 많기 때문이다.
function findSimilarItemName(existingNames, name) {
  const norm = name.trim()
  if (!norm) return null
  let best = null
  let bestSimilarity = 0
  for (const existing of existingNames) {
    const eNorm = existing.trim()
    if (eNorm === norm) continue
    const maxLen = Math.max(norm.length, eNorm.length)
    if (maxLen === 0) continue
    const similarity = 1 - levenshtein(norm, eNorm) / maxLen
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity
      best = eNorm
    }
  }
  return bestSimilarity >= 0.9 ? best : null
}

function itemAmount(item) {
  if (item.amount !== '') return Number(item.amount)
  const q = item.quantity === '' ? null : Number(item.quantity)
  const p = item.unitPrice === '' ? null : Number(item.unitPrice)
  return q != null && p != null ? q * p : 0
}

// 반올림 오차 등을 감안한 허용 오차(원)
const AMOUNT_TOLERANCE = 1

// 수량×단가와 입력된 금액이 다른 품목을 찾는다 (세 값이 모두 있을 때만 검사)
function findItemMismatches(items) {
  return items
    .filter((item) => item.name.trim() && item.quantity !== '' && item.unitPrice !== '' && item.amount !== '')
    .map((item) => {
      const expected = Number(item.quantity) * Number(item.unitPrice)
      const actual = Number(item.amount)
      return Math.abs(expected - actual) > AMOUNT_TOLERANCE ? { name: item.name.trim(), expected, actual } : null
    })
    .filter(Boolean)
}

export default function InvoiceScreen() {
  const { store } = useStore()
  const navigate = useNavigate()
  const { batchId } = useParams()
  const editMode = Boolean(batchId)

  const [loadingEdit, setLoadingEdit] = useState(editMode)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [pendingImage, setPendingImage] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzed, setAnalyzed] = useState(false)
  const [error, setError] = useState('')
  const [vendors, setVendors] = useState([])
  const [vendorsVersion, setVendorsVersion] = useState(0)
  const [itemNameRecords, setItemNameRecords] = useState([])
  const [dismissedSimilarItems, setDismissedSimilarItems] = useState(new Set())
  const [focusedNameIndex, setFocusedNameIndex] = useState(null)
  const [vendorId, setVendorId] = useState('')
  const [newVendorName, setNewVendorName] = useState('')
  const [similarVendorPrompt, setSimilarVendorPrompt] = useState(null)
  const [date, setDate] = useState('')
  const [statementBalance, setStatementBalance] = useState('')
  const [invoiceTotal, setInvoiceTotal] = useState('')
  const [items, setItems] = useState([])
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const [priceChanges, setPriceChanges] = useState([])
  const [marginAlerts, setMarginAlerts] = useState([])
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

  useEffect(() => {
    if (!store || !supabase) return
    supabase
      .from('invoices')
      .select('item_name, vendor_id')
      .eq('store_code', store.code)
      .then(({ data, error: err }) => {
        if (!err) setItemNameRecords(data ?? [])
      })
  }, [store, historyKey])

  // 수정 모드: 기존 명세표와 품목을 불러와 입력 폼에 채워 넣는다.
  useEffect(() => {
    if (!editMode || !store) return
    if (!supabase) {
      setLoadingEdit(false)
      return
    }
    setLoadingEdit(true)
    setError('')
    supabase
      .from('invoice_batches')
      .select('id, vendor_id, invoice_date, statement_balance, total_amount, invoices(item_name, quantity, unit_price, unit, amount)')
      .eq('id', batchId)
      .single()
      .then(({ data, error: err }) => {
        setLoadingEdit(false)
        if (err) {
          setError(err.message)
          return
        }
        setVendorId(data.vendor_id)
        setDate(data.invoice_date ?? '')
        setStatementBalance(data.statement_balance != null ? String(data.statement_balance) : '')
        setInvoiceTotal(data.total_amount != null ? String(data.total_amount) : '')
        setItems(
          (data.invoices ?? []).map((item) => ({
            name: item.item_name ?? '',
            quantity: item.quantity ?? '',
            unitPrice: item.unit_price ?? '',
            unit: item.unit ?? 'kg',
            amount: item.amount ?? '',
          })),
        )
      })
  }, [editMode, batchId, store])

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
      setInvoiceTotal('')
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
      setInvoiceTotal(data.totalAmount != null ? String(data.totalAmount) : '')
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
    setMarginAlerts([])
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

    // 수정 모드: 새 명세표를 만드는 대신 기존 전표(batch)와 그 품목들을 덮어쓴다.
    // 중복 검사·단가 변동 알림은 새로 입고된 게 아니라 오입력을 고치는 것이므로 건너뛴다.
    if (editMode) {
      const editTotalAmount = validItems.reduce((sum, item) => sum + itemAmount(item), 0)

      const { error: updateErr } = await supabase
        .from('invoice_batches')
        .update({
          vendor_id: resolvedVendorId,
          invoice_date: date || null,
          total_amount: editTotalAmount,
          statement_balance: statementBalance === '' ? null : Number(statementBalance),
        })
        .eq('id', batchId)

      if (updateErr) {
        setSaving(false)
        setError(updateErr.message)
        return
      }

      const { error: deleteOldErr } = await supabase.from('invoices').delete().eq('batch_id', batchId)
      if (deleteOldErr) {
        setSaving(false)
        setError(deleteOldErr.message)
        return
      }

      const editRows = validItems.map((item) => ({
        store_code: store.code,
        vendor: resolvedVendorName,
        vendor_id: resolvedVendorId,
        batch_id: batchId,
        item_name: item.name.trim(),
        quantity: item.quantity === '' ? null : Number(item.quantity),
        unit_price: item.unitPrice === '' ? null : Number(item.unitPrice),
        unit: item.unit || null,
        amount: item.amount === '' ? null : Number(item.amount),
        invoice_date: date || null,
      }))

      const { error: insertEditErr } = await supabase.from('invoices').insert(editRows)
      setSaving(false)
      if (insertEditErr) {
        setError(insertEditErr.message)
        return
      }

      if (didCreateVendor) setVendorsVersion((v) => v + 1)
      navigate(`/vendors/${resolvedVendorId}`)
      return
    }

    // 같은 거래처 + 같은 날짜로 이미 저장된 전표가 있으면 같은 사진을 다시 올린 게
    // 아닌지 저장 전에 경고한다 (날짜 미입력이면 비교할 수 없어 건너뜀).
    // 우선순위: 명세표 전잔액이 둘 다 있고 값이 같으면(가장 확실한 신호) 바로 중복으로 본다.
    // 전잔액이 없는 경우엔 물품명이 하나라도 겹치면 중복 가능성으로 본다 — AI가 재분석 때
    // 품목을 살짝 다르게 읽어도(순서·표기 차이) 잡아내기 위해 완전 일치 대신 겹침으로 비교한다.
    if (!skipDuplicateCheck && date) {
      const { data: existingBatches, error: dupErr } = await supabase
        .from('invoice_batches')
        .select('id, statement_balance, invoices(item_name)')
        .eq('store_code', store.code)
        .eq('vendor_id', resolvedVendorId)
        .eq('invoice_date', date)

      if (dupErr) {
        setSaving(false)
        setError(dupErr.message)
        return
      }

      const currentBalance = statementBalance === '' ? null : Number(statementBalance)
      const currentNames = new Set(validItems.map((item) => item.name.trim()))
      let matchReason = null
      let overlappingNames = []
      const duplicateBatch = (existingBatches ?? []).find((b) => {
        if (currentBalance != null && b.statement_balance != null && Number(b.statement_balance) === currentBalance) {
          matchReason = 'balance'
          return true
        }
        const existingNames = new Set((b.invoices ?? []).map((i) => i.item_name))
        const overlap = [...currentNames].filter((n) => existingNames.has(n))
        if (overlap.length === 0) return false
        matchReason = 'items'
        overlappingNames = overlap
        return true
      })

      if (duplicateBatch) {
        setSaving(false)
        setDuplicateWarning({
          vendorName: resolvedVendorName,
          date,
          matchReason,
          balance: currentBalance,
          itemNames: overlappingNames,
        })
        if (didCreateVendor) setVendorsVersion((v) => v + 1)
        return
      }
    }

    // 같은 거래처의 이전 입고 내역에서 품목별 최근 단가를 조회 (물품명 정확히 일치만 비교).
    // "가장 최근"은 저장한 순서가 아니라 명세표상 입고일 기준이다 — 예전 명세표를 나중에
    // 몰아서 입력해도(입력 순서가 뒤섞여도) 항상 실제 입고 순서대로 직전 단가를 비교하기 위함.
    const { data: history, error: historyErr } = await supabase
      .from('invoices')
      .select('item_name, unit_price, invoice_date, created_at')
      .eq('store_code', store.code)
      .eq('vendor_id', resolvedVendorId)
      .order('invoice_date', { ascending: false, nullsFirst: false })
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
        invoice_date: date || null,
      }))
      const { error: changeErr } = await supabase.from('price_changes').insert(changeRows)
      if (changeErr) console.error(changeErr)
    }

    // 명세표 원본 사진을 Storage에 보관한다 (최선 노력 — 실패해도 이미 저장된 입고 데이터는
    // 그대로 유지하고, 저장 자체를 막지 않는다).
    if (pendingImage) {
      try {
        const blob = base64ToBlob(pendingImage.imageBase64, pendingImage.mediaType)
        const path = `${store.code}/${batch.id}.jpg`
        const { error: uploadErr } = await supabase.storage.from('invoice-photos').upload(path, blob, {
          contentType: pendingImage.mediaType,
          upsert: true,
        })
        if (uploadErr) {
          console.error(uploadErr)
        } else {
          const { error: photoPathErr } = await supabase.from('invoice_batches').update({ photo_path: path }).eq('id', batch.id)
          if (photoPathErr) console.error(photoPathErr)
        }
      } catch (uploadErr) {
        console.error(uploadErr)
      }
    }

    // 단가가 오른 품목이 레시피에 쓰이고 있으면, 그 메뉴의 원가율이 얼마나 됐는지 바로 확인해서
    // 마진이 낮아진(원가율이 높아진) 메뉴를 저장 직후에 알려준다.
    let marginWarnings = []
    if (changes.length > 0) {
      const [recipesRes, mappingRes, pricesRes, allInvoicesRes] = await Promise.all([
        supabase.from('recipes').select('menu_name, ingredient_name, amount_g').eq('store_code', store.code),
        supabase
          .from('ingredient_mapping')
          .select('recipe_ingredient_name, invoice_item_name')
          .eq('store_code', store.code),
        supabase.from('menu_prices').select('menu_name, selling_price').eq('store_code', store.code),
        supabase.from('invoices').select('item_name, unit_price, unit, created_at').eq('store_code', store.code),
      ])

      if (!recipesRes.error && !mappingRes.error && !pricesRes.error && !allInvoicesRes.error) {
        const changedItemNames = new Set(changes.map((c) => c.itemName))
        const mappingRows = mappingRes.data ?? []
        const affectedIngredients = new Set(
          mappingRows.filter((m) => changedItemNames.has(m.invoice_item_name)).map((m) => m.recipe_ingredient_name),
        )
        const recipeRows = recipesRes.data ?? []
        const affectedMenus = new Set(
          recipeRows.filter((r) => affectedIngredients.has(r.ingredient_name)).map((r) => r.menu_name),
        )

        const mappingByIngredient = new Map(mappingRows.map((m) => [m.recipe_ingredient_name, m.invoice_item_name]))
        const infoByItem = latestInvoiceInfoByItem(allInvoicesRes.data ?? [])
        const sellingByMenu = new Map((pricesRes.data ?? []).map((p) => [p.menu_name, Number(p.selling_price)]))

        marginWarnings = [...affectedMenus]
          .map((menuName) => {
            const menuRecipeRows = recipeRows.filter((r) => r.menu_name === menuName)
            const { totalCost } = computeMenuCost({ recipeRows: menuRecipeRows, mappingByIngredient, infoByItem })
            const sellingPrice = sellingByMenu.get(menuName) ?? null
            const ratio = sellingPrice ? (totalCost / sellingPrice) * 100 : null
            return { menuName, ratio }
          })
          .filter((m) => m.ratio != null && m.ratio >= MARGIN_WARNING_RATIO)
          .sort((a, b) => b.ratio - a.ratio)
      }
    }

    setSaving(false)
    setSaveMessage('저장했습니다.')
    setPriceChanges(changes)
    setMarginAlerts(marginWarnings)
    setHistoryKey((k) => k + 1)
    setPendingImage(null)
    setPreviewUrl(null)
    setAnalyzed(false)
    setVendorId('')
    setNewVendorName('')
    setSimilarVendorPrompt(null)
    setDate('')
    setStatementBalance('')
    setInvoiceTotal('')
    setItems([])
    if (didCreateVendor) setVendorsVersion((v) => v + 1)
  }

  const itemNames = [...new Set(itemNameRecords.map((r) => r.item_name))]

  // 물품명 자동완성 후보: 이 거래처가 예전에 납품한 물품명을 우선 보여주고, 거래처를
  // 아직 안 골랐거나 새 거래처를 추가하는 중이면 매장 전체 물품명에서 찾는다.
  const autocompleteCandidates = (typed) => {
    const norm = typed.trim()
    if (!norm) return []
    const pool =
      vendorId && vendorId !== 'new'
        ? itemNameRecords.filter((r) => r.vendor_id === vendorId)
        : itemNameRecords
    const names = [...new Set(pool.map((r) => r.item_name))]
    return names.filter((n) => n !== norm && n.includes(norm)).slice(0, 8)
  }

  const itemMismatches = findItemMismatches(items)
  const validItemsForSum = items.filter((item) => item.name.trim())
  const itemsSum = validItemsForSum.reduce((sum, item) => sum + itemAmount(item), 0)
  const totalMismatch =
    invoiceTotal !== '' && Math.abs(itemsSum - Number(invoiceTotal)) > AMOUNT_TOLERANCE
      ? { itemsSum, invoiceTotal: Number(invoiceTotal) }
      : null
  const hasAmountMismatch = itemMismatches.length > 0 || totalMismatch != null

  // 이미 있는 물품명과 90% 이상 비슷하지만 완전히 같지는 않은 항목을 찾는다. 새 물품으로
  // 바로 저장하지 않고 먼저 확인받아서, 오타로 같은 품목이 여러 개로 쪼개지는 걸 막는다.
  const similarItemMatches = items
    .map((item, index) => {
      const typed = item.name.trim()
      if (!typed || itemNames.includes(typed)) return null
      const suggestion = findSimilarItemName(itemNames, typed)
      if (!suggestion) return null
      const key = `${typed}→${suggestion}`
      if (dismissedSimilarItems.has(key)) return null
      return { index, typed, suggestion, key }
    })
    .filter(Boolean)

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
        <h1>{editMode ? '입고 수정' : '입고 입력'}</h1>
        <p className="subtitle">
          {editMode
            ? `${store.name} · 저장된 명세표의 품목을 고쳐서 다시 저장해요`
            : `${store.name} · 거래명세표 사진을 올리면 자동으로 읽어드려요`}
        </p>
      </div>

      {loadingEdit && <p className="hint">불러오는 중...</p>}

      {!editMode && (
        <>
          <div className="upload-btn-row">
            <label className="upload-btn">
              {previewUrl ? '다른 파일 선택' : '파일 선택'}
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
        </>
      )}

      {error && <p className="error-text">{error}</p>}
      {saveMessage && <p className="success-text">{saveMessage}</p>}

      {duplicateWarning && (
        <div className="price-alert-box">
          <p className="price-alert-title">이미 입고된 내역이 있어요</p>
          <p className="hint">
            {duplicateWarning.vendorName} · {duplicateWarning.date}에 이미 저장된 입고 내역이 있습니다.{' '}
            {duplicateWarning.matchReason === 'balance'
              ? `명세표 전잔액(${Math.round(duplicateWarning.balance).toLocaleString()}원)이 같아요.`
              : `물품(${duplicateWarning.itemNames.join(', ')})이 겹쳐요.`}{' '}
            같은 사진을 다시 올린 게 아닌지 확인해주세요.
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

      {marginAlerts.length > 0 && (
        <div className="price-alert-box price-alert-box-danger">
          <p className="price-alert-title">⚠️ 이 단가 변동으로 원가율이 높아진 메뉴가 있어요</p>
          <ul className="price-alert-list">
            {marginAlerts.map((m) => (
              <li key={m.menuName}>
                <button
                  type="button"
                  className="inline-link"
                  onClick={() => navigate(`/cost/${encodeURIComponent(m.menuName)}`)}
                >
                  {m.menuName}: 원가율 {m.ratio.toFixed(1)}%
                </button>
              </li>
            ))}
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
        <label htmlFor="statementBalance">명세표 전잔액</label>
        <input
          id="statementBalance"
          className="input"
          inputMode="decimal"
          value={statementBalance}
          onChange={(e) => setStatementBalance(e.target.value)}
          placeholder="예: 3054500"
        />
        <p className="hint">명세표에 적힌 잔액을 그대로 입력하세요. 당일 입고액을 더한 실제 잔액은 앱이 자동으로 계산해요.</p>
      </div>
      <div className="field">
        <label htmlFor="invoiceTotal">당일 입고액</label>
        <input
          id="invoiceTotal"
          className="input"
          inputMode="decimal"
          value={invoiceTotal}
          onChange={(e) => setInvoiceTotal(e.target.value)}
          placeholder="예: 300000"
        />
      </div>

      {hasAmountMismatch && (
        <div className="price-alert-box price-alert-box-danger">
          <p className="price-alert-title">⚠️ 금액이 맞지 않아요</p>
          <ul className="price-alert-list">
            {itemMismatches.map((m) => (
              <li key={m.name} className="alert-up">
                {m.name}: 수량×단가 {Math.round(m.expected).toLocaleString()}원 ≠ 입력된 금액{' '}
                {Math.round(m.actual).toLocaleString()}원
              </li>
            ))}
            {totalMismatch && (
              <li className="alert-up">
                품목 합계 {Math.round(totalMismatch.itemsSum).toLocaleString()}원 ≠ 당일 입고액{' '}
                {Math.round(totalMismatch.invoiceTotal).toLocaleString()}원
              </li>
            )}
          </ul>
          <p className="hint">품목의 수량·단가·금액이나 당일 입고액을 확인해서 맞춰주세요. 맞아야 저장할 수 있어요.</p>
        </div>
      )}

      {similarItemMatches.map((m) => (
        <div key={m.key} className="price-alert-box">
          <p className="price-alert-title">비슷한 물품이 있어요</p>
          <p className="hint">
            "{m.typed}"과(와) 기존 물품 "{m.suggestion}"이(가) 같은 물품인가요?
          </p>
          <div className="invoice-form">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setDismissedSimilarItems((prev) => new Set(prev).add(m.key))}
            >
              아니요, 다른 물품이에요
            </button>
            <button type="button" className="btn-primary" onClick={() => updateItem(m.index, 'name', m.suggestion)}>
              네, 같은 물품이에요
            </button>
          </div>
        </div>
      ))}

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
              <Fragment key={index}>
                <div className="item-row">
                <input
                  className="input"
                  value={item.name}
                  onChange={(e) => updateItem(index, 'name', e.target.value)}
                  onFocus={() => setFocusedNameIndex(index)}
                  onBlur={() => setFocusedNameIndex((cur) => (cur === index ? null : cur))}
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
                {focusedNameIndex === index &&
                  autocompleteCandidates(item.name).length > 0 && (
                    <div className="preset-row item-name-suggestions">
                      {autocompleteCandidates(item.name).map((name) => (
                        <button
                          type="button"
                          key={name}
                          className="chip"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => updateItem(index, 'name', name)}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  )}
              </Fragment>
            ))}
          </div>
        </div>
      )}

      <div className="invoice-form">
        <button type="button" className="btn-secondary" onClick={addItem}>
          + 품목 추가
        </button>
        {(vendorId || items.length > 0) && (
          <button
            type="button"
            className="btn-primary"
            onClick={() => handleSave()}
            disabled={saving || hasAmountMismatch || similarItemMatches.length > 0}
          >
            {saving
              ? '저장 중...'
              : hasAmountMismatch
                ? '금액을 맞춰주세요'
                : similarItemMatches.length > 0
                  ? '물품명을 확인해주세요'
                  : editMode
                    ? '수정 저장'
                    : '저장'}
          </button>
        )}
        {editMode && (
          <button type="button" className="btn-secondary" onClick={() => navigate(-1)} disabled={saving}>
            취소
          </button>
        )}
      </div>

      {!editMode && <InvoiceHistory storeCode={store.code} refreshKey={historyKey} />}
    </div>
  )
}
