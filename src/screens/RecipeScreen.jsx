import { Fragment, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { compressImage } from '../lib/compressImage'
import { latestInvoiceInfoByItem, computeSubRecipeCost } from '../lib/costCalc'
import { copyRecipe } from '../lib/copyRecipe'
import { useIngredientMatch } from '../hooks/useIngredientMatch'

function emptyIngredient() {
  return { name: '', amountG: '', originalText: '' }
}

export default function RecipeScreen() {
  const { store } = useStore()
  const navigate = useNavigate()

  const [menuName, setMenuName] = useState('')
  const [editingMenu, setEditingMenu] = useState(null)
  const [yieldQty, setYieldQty] = useState('')
  const [yieldUnit, setYieldUnit] = useState('')
  const [previewUrl, setPreviewUrl] = useState(null)
  const [pendingImage, setPendingImage] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState('')
  const [items, setItems] = useState([])
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const [historyKey, setHistoryKey] = useState(0)

  const [subRecipes, setSubRecipes] = useState([])
  const [listLoading, setListLoading] = useState(false)

  const [mappingByIngredient, setMappingByIngredient] = useState(new Map())
  const [invoiceItems, setInvoiceItems] = useState([])
  const [ingredientNameOptions, setIngredientNameOptions] = useState([])

  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteCount, setDeleteCount] = useState(null)
  const [deleteConfirmStage, setDeleteConfirmStage] = useState(1)
  const [deleting, setDeleting] = useState(false)

  const [copyTarget, setCopyTarget] = useState(null)
  const [copyNameInput, setCopyNameInput] = useState('')
  const [copying, setCopying] = useState(false)

  useEffect(() => {
    if (!store) navigate('/', { replace: true })
  }, [store, navigate])

  useEffect(() => {
    if (!store || !supabase) return
    setListLoading(true)
    Promise.all([
      supabase.from('recipe_meta').select('menu_name, yield_qty, yield_unit').eq('store_code', store.code).eq('recipe_type', 'sub'),
      supabase.from('recipes').select('menu_name, ingredient_name, amount_g, is_sub_recipe').eq('store_code', store.code),
      supabase.from('ingredient_mapping').select('recipe_ingredient_name, invoice_item_name').eq('store_code', store.code),
      supabase.from('invoices').select('item_name, unit_price, unit, created_at').eq('store_code', store.code),
    ]).then(([metaRes, recipesRes, mappingRes, invoicesRes]) => {
      const err = metaRes.error || recipesRes.error || mappingRes.error || invoicesRes.error
      if (err) {
        setError(err.message)
        setListLoading(false)
        return
      }
      const mappingByIngredient = new Map(
        (mappingRes.data ?? []).map((m) => [m.recipe_ingredient_name, m.invoice_item_name]),
      )
      const infoByItem = latestInvoiceInfoByItem(invoicesRes.data ?? [])
      const rowsByMenu = new Map()
      for (const r of recipesRes.data ?? []) {
        if (!rowsByMenu.has(r.menu_name)) rowsByMenu.set(r.menu_name, [])
        rowsByMenu.get(r.menu_name).push(r)
      }

      setMappingByIngredient(mappingByIngredient)
      setInvoiceItems([...new Set((invoicesRes.data ?? []).map((r) => r.item_name))].sort((a, b) => a.localeCompare(b)))
      setIngredientNameOptions(
        [...new Set((recipesRes.data ?? []).filter((r) => !r.is_sub_recipe).map((r) => r.ingredient_name))].sort(
          (a, b) => a.localeCompare(b),
        ),
      )
      const list = (metaRes.data ?? [])
        .map((meta) => {
          const rows = rowsByMenu.get(meta.menu_name) ?? []
          const { unitCost, hasMissing } = computeSubRecipeCost({
            recipeRows: rows,
            mappingByIngredient,
            infoByItem,
            yieldQty: meta.yield_qty,
          })
          return {
            menuName: meta.menu_name,
            yieldQty: meta.yield_qty,
            yieldUnit: meta.yield_unit,
            ingredientCount: rows.length,
            unitCost,
            hasMissing,
          }
        })
        .sort((a, b) => a.menuName.localeCompare(b.menuName))
      setSubRecipes(list)
      setListLoading(false)
    })
  }, [store, historyKey])

  const ingredientMatch = useIngredientMatch({
    storeCode: store?.code,
    invoiceItems,
    onMatchSaved: () => setHistoryKey((k) => k + 1),
  })

  if (!store) return null

  const resetForm = () => {
    setMenuName('')
    setEditingMenu(null)
    setYieldQty('')
    setYieldUnit('')
    setPendingImage(null)
    setPreviewUrl(null)
    setItems([])
  }

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    setSaveMessage('')
    try {
      const { base64, mediaType, previewUrl: preview } = await compressImage(file)
      setPendingImage({ imageBase64: base64, mediaType })
      setPreviewUrl(preview)
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
      const res = await fetch('/api/analyze-recipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pendingImage),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '분석에 실패했습니다')
      setItems(
        (data.ingredients ?? []).map((ing) => ({
          name: ing.name ?? '',
          amountG: ing.amountG ?? '',
          originalText: ing.originalText ?? '',
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

  const addItem = () => setItems((prev) => [...prev, emptyIngredient()])
  const removeItem = (index) => setItems((prev) => prev.filter((_, i) => i !== index))

  const handleEditRecipe = async (name) => {
    if (!supabase) return
    setError('')
    setSaveMessage('')
    const [{ data: metaData, error: metaErr }, { data: rows, error: rowsErr }] = await Promise.all([
      supabase
        .from('recipe_meta')
        .select('yield_qty, yield_unit')
        .eq('store_code', store.code)
        .eq('menu_name', name)
        .maybeSingle(),
      supabase
        .from('recipes')
        .select('ingredient_name, amount_g')
        .eq('store_code', store.code)
        .eq('menu_name', name)
        .eq('is_sub_recipe', false),
    ])
    if (metaErr || rowsErr) {
      setError((metaErr ?? rowsErr).message)
      return
    }
    setMenuName(name)
    setEditingMenu(name)
    setYieldQty(metaData?.yield_qty != null ? String(metaData.yield_qty) : '')
    setYieldUnit(metaData?.yield_unit ?? '')
    setPendingImage(null)
    setPreviewUrl(null)
    setItems((rows ?? []).map((row) => ({ name: row.ingredient_name, amountG: row.amount_g ?? '', originalText: '' })))
  }

  const openDeleteConfirm = async (name) => {
    setDeleteTarget(name)
    setDeleteConfirmStage(1)
    setDeleteCount(null)
    setError('')
    if (!supabase) return
    const { count } = await supabase
      .from('recipes')
      .select('id', { count: 'exact', head: true })
      .eq('store_code', store.code)
      .eq('is_sub_recipe', true)
      .eq('ingredient_name', name)
    setDeleteCount(count ?? 0)
  }

  const closeDeleteConfirm = () => {
    setDeleteTarget(null)
    setDeleteCount(null)
    setDeleteConfirmStage(1)
  }

  const handleConfirmDeleteClick = () => {
    if ((deleteCount ?? 0) > 0 && deleteConfirmStage === 1) {
      setDeleteConfirmStage(2)
      return
    }
    handleDeleteRecipe()
  }

  const handleDeleteRecipe = async () => {
    if (!deleteTarget || !supabase) return
    setDeleting(true)
    setError('')
    const { error: rowsErr } = await supabase
      .from('recipes')
      .delete()
      .eq('store_code', store.code)
      .eq('menu_name', deleteTarget)
    if (rowsErr) {
      setDeleting(false)
      setError(rowsErr.message)
      return
    }
    const { error: metaErr } = await supabase
      .from('recipe_meta')
      .delete()
      .eq('store_code', store.code)
      .eq('menu_name', deleteTarget)
    setDeleting(false)
    if (metaErr) {
      setError(metaErr.message)
      return
    }
    if (editingMenu === deleteTarget) resetForm()
    closeDeleteConfirm()
    setHistoryKey((k) => k + 1)
  }

  const openCopy = (name) => {
    setCopyTarget(name)
    setCopyNameInput(`${name} 사본`)
    setError('')
  }

  const closeCopy = () => {
    setCopyTarget(null)
    setCopyNameInput('')
  }

  const handleCopy = async () => {
    if (!copyTarget || !supabase) return
    setCopying(true)
    setError('')
    const { error: err } = await copyRecipe({
      supabase,
      storeCode: store.code,
      fromMenuName: copyTarget,
      toMenuName: copyNameInput,
    })
    setCopying(false)
    if (err) {
      setError(err.message)
      return
    }
    closeCopy()
    setHistoryKey((k) => k + 1)
  }

  const handleSave = async () => {
    if (!supabase) {
      setError('Supabase가 설정되지 않아 저장할 수 없습니다.')
      return
    }
    const trimmedMenu = menuName.trim()
    const validItems = items.filter((item) => item.name.trim())
    if (!trimmedMenu || validItems.length === 0) {
      setError('부재료 이름과 최소 1개의 재료가 필요합니다.')
      return
    }

    setSaving(true)
    setError('')
    setSaveMessage('')

    const { error: metaErr } = await supabase.from('recipe_meta').upsert(
      {
        store_code: store.code,
        menu_name: trimmedMenu,
        recipe_type: 'sub',
        yield_qty: yieldQty === '' ? null : Number(yieldQty),
        yield_unit: yieldUnit.trim() === '' ? null : yieldUnit.trim(),
      },
      { onConflict: 'store_code,menu_name' },
    )
    if (metaErr) {
      setSaving(false)
      setError(metaErr.message)
      return
    }

    if (editingMenu) {
      const { error: delErr } = await supabase
        .from('recipes')
        .delete()
        .eq('store_code', store.code)
        .eq('menu_name', editingMenu)
      if (delErr) {
        setSaving(false)
        setError(delErr.message)
        return
      }
    }

    const rows = validItems.map((item) => ({
      store_code: store.code,
      menu_name: trimmedMenu,
      ingredient_name: item.name.trim(),
      amount_g: item.amountG === '' ? null : Number(item.amountG),
      is_sub_recipe: false,
    }))

    const { error: insertErr } = await supabase.from('recipes').insert(rows)
    setSaving(false)
    if (insertErr) {
      setError(insertErr.message)
      return
    }

    setSaveMessage('저장했습니다.')
    setHistoryKey((k) => k + 1)
    resetForm()
  }

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/menu')}>
          ← 메인 메뉴
        </button>
        <h1>레시피 입력</h1>
        <p className="subtitle">{store.name} · 매장에서 직접 만드는 부재료(굴림만두·육수·반찬 등)를 등록해요</p>
      </div>

      <div className="field">
        <label htmlFor="menuName">부재료 이름</label>
        <input
          id="menuName"
          className="input"
          value={menuName}
          onChange={(e) => setMenuName(e.target.value)}
          placeholder="예: 굴림만두"
          disabled={Boolean(editingMenu)}
        />
      </div>

      {editingMenu && (
        <p className="hint">
          "{editingMenu}" 수정 중입니다 (이름은 여기서 바꿀 수 없어요 — 이름을 바꾸려면 "복사"로 새로 만드세요).{' '}
          <button type="button" className="inline-link" onClick={resetForm}>
            새로 작성
          </button>
        </p>
      )}

      <label className="upload-btn">
        {previewUrl ? '다른 사진 선택' : '레시피 사진 선택 (선택사항)'}
        <input type="file" accept="image/*" onChange={handleFileChange} hidden />
      </label>

      {previewUrl && (
        <div className="photo-preview">
          <img src={previewUrl} alt="레시피 미리보기" />
        </div>
      )}

      {previewUrl && (
        <button type="button" className="btn-primary" onClick={handleAnalyze} disabled={analyzing}>
          {analyzing ? '분석 중...' : '분석하기'}
        </button>
      )}

      {error && <p className="error-text">{error}</p>}
      {saveMessage && <p className="success-text">{saveMessage}</p>}

      <datalist id="recipeIngredientNameOptions">
        {ingredientNameOptions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      {items.length > 0 && (
        <div className="item-table-wrap">
          <div className="item-table item-table-narrow">
            <div className="item-row item-row-3 item-row-head">
              <span>재료명</span>
              <span>사용량(g)</span>
              <span />
            </div>
            {items.map((item, index) => {
              const trimmedName = item.name.trim()
              const matchedInvoiceItem = trimmedName ? mappingByIngredient.get(trimmedName) : null
              return (
                <Fragment key={index}>
                  <div className="item-row item-row-3">
                    <input
                      className="input"
                      list="recipeIngredientNameOptions"
                      value={item.name}
                      onChange={(e) => updateItem(index, 'name', e.target.value)}
                      placeholder="재료명"
                    />
                    <input
                      className="input"
                      inputMode="decimal"
                      value={item.amountG}
                      onChange={(e) => updateItem(index, 'amountG', e.target.value)}
                      placeholder={item.originalText ? `원본: ${item.originalText}` : 'g'}
                    />
                    <button type="button" className="icon-btn" onClick={() => removeItem(index)} aria-label="행 삭제">
                      ✕
                    </button>
                  </div>
                  {trimmedName && (
                    <p className={matchedInvoiceItem ? 'hint' : 'hint cost-warning'}>
                      {matchedInvoiceItem ? `→ ${matchedInvoiceItem}` : '⚠ 매칭 필요'}{' '}
                      <button
                        type="button"
                        className="inline-link"
                        onClick={() => ingredientMatch.openMatch(index, trimmedName)}
                      >
                        {matchedInvoiceItem ? '변경' : '매칭하기'}
                      </button>
                    </p>
                  )}
                  {ingredientMatch.matchingIndex === index && (
                    <div className="match-panel">
                      {ingredientMatch.error && <p className="error-text">{ingredientMatch.error}</p>}
                      {ingredientMatch.suggesting && <p className="hint">추천 후보를 찾는 중...</p>}
                      {!ingredientMatch.suggesting && ingredientMatch.suggestions.length > 0 && (
                        <div className="match-suggestions">
                          {ingredientMatch.suggestions.map((s) => (
                            <button
                              key={s}
                              type="button"
                              className="chip"
                              onClick={() => ingredientMatch.confirmMatch(s)}
                              disabled={ingredientMatch.saving}
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      )}
                      {invoiceItems.length > 0 && (
                        <div className="field">
                          <select
                            className="select"
                            value={ingredientMatch.manualChoice}
                            onChange={(e) => ingredientMatch.setManualChoice(e.target.value)}
                          >
                            <option value="">물품 선택...</option>
                            {invoiceItems.map((invItem) => (
                              <option key={invItem} value={invItem}>
                                {invItem}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => ingredientMatch.confirmMatch(ingredientMatch.manualChoice)}
                            disabled={!ingredientMatch.manualChoice || ingredientMatch.saving}
                          >
                            이 물품으로 연결
                          </button>
                        </div>
                      )}
                      {invoiceItems.length === 0 && <p className="hint">아직 등록된 입고 물품이 없습니다.</p>}
                      <button type="button" className="link-btn" onClick={ingredientMatch.cancelMatch}>
                        취소
                      </button>
                    </div>
                  )}
                </Fragment>
              )
            })}
          </div>
        </div>
      )}

      <div className="invoice-form">
        <button type="button" className="btn-secondary" onClick={addItem}>
          + 재료 추가
        </button>
      </div>

      {(menuName.trim() || items.length > 0) && (
        <>
          <div className="field">
            <label htmlFor="yieldQty">산출량 (이 레시피 한 번 만들면 나오는 양)</label>
            <input
              id="yieldQty"
              className="input"
              inputMode="decimal"
              value={yieldQty}
              onChange={(e) => setYieldQty(e.target.value)}
              placeholder="예: 25"
            />
          </div>
          <div className="field">
            <label htmlFor="yieldUnit">산출 단위</label>
            <input
              id="yieldUnit"
              className="input"
              value={yieldUnit}
              onChange={(e) => setYieldUnit(e.target.value)}
              placeholder="예: 개, 인분, ml"
            />
          </div>
          <p className="hint">
            {yieldQty !== '' && yieldUnit.trim() !== ''
              ? `이 레시피대로 만들면 ${yieldUnit.trim()} ${yieldQty}개(단위)가 나온다는 뜻이에요. 재료비 합계를 이 값으로 나눠서 1${yieldUnit.trim()}당 단가를 계산해요.`
              : '산출량과 단위를 입력하면 재료비 합계를 나눠서 1단위당 단가를 자동으로 계산해요.'}
          </p>

          <div className="invoice-form">
            <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? '저장 중...' : editingMenu ? '수정 저장' : '저장'}
            </button>
          </div>
        </>
      )}

      <h2 className="section-title">등록된 부재료</h2>
      {listLoading && <p className="hint">불러오는 중...</p>}
      {!listLoading && subRecipes.length === 0 && <p className="hint">등록된 부재료가 없습니다.</p>}

      <ul className="history-list">
        {subRecipes.map((r) => (
          <li key={r.menuName} className="history-row">
            <div className="history-row-main">
              <Link className="history-item-link" to={`/recipes/${encodeURIComponent(r.menuName)}`}>
                {r.menuName}
              </Link>
              <span>
                {r.unitCost != null
                  ? `1${r.yieldUnit || '단위'}당 ${Math.round(r.unitCost).toLocaleString()}원`
                  : '원가 계산 안 됨'}
              </span>
            </div>
            <div className="history-row-sub">
              <span>
                재료 {r.ingredientCount}개
                {r.yieldQty != null ? ` · 산출량 ${r.yieldQty}${r.yieldUnit ?? ''}` : ''}
              </span>
              {r.hasMissing && <span className="cost-warning">일부 재료 매칭/단가 필요</span>}
            </div>
            <div className="recipe-actions">
              <button type="button" className="link-btn" onClick={() => handleEditRecipe(r.menuName)}>
                수정
              </button>
              <button type="button" className="link-btn" onClick={() => openCopy(r.menuName)}>
                복사
              </button>
              <button type="button" className="link-btn link-btn-danger" onClick={() => openDeleteConfirm(r.menuName)}>
                삭제
              </button>
            </div>

            {copyTarget === r.menuName && (
              <div className="price-alert-box">
                <p className="price-alert-title">"{r.menuName}"을(를) 복사할 새 이름</p>
                <div className="field">
                  <input
                    className="input"
                    value={copyNameInput}
                    onChange={(e) => setCopyNameInput(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="invoice-form">
                  <button type="button" className="btn-secondary" onClick={closeCopy} disabled={copying}>
                    취소
                  </button>
                  <button type="button" className="btn-primary" onClick={handleCopy} disabled={copying || !copyNameInput.trim()}>
                    {copying ? '복사 중...' : '복사'}
                  </button>
                </div>
              </div>
            )}

            {deleteTarget === r.menuName && (
              <div className="price-alert-box price-alert-box-danger">
                {deleteCount == null ? (
                  <p className="hint">확인 중...</p>
                ) : deleteCount === 0 ? (
                  <>
                    <p className="price-alert-title">"{r.menuName}" 부재료를 삭제할까요?</p>
                    <p className="hint">이 부재료를 쓰는 메뉴가 없어요. 삭제하면 되돌릴 수 없어요.</p>
                  </>
                ) : deleteConfirmStage === 1 ? (
                  <>
                    <p className="price-alert-title">⚠️ 이 부재료를 쓰는 메뉴가 {deleteCount}곳 있어요</p>
                    <p className="hint">지금 지우면 그 메뉴들의 원가 계산에서 이 부재료가 조용히 빠져요. 정말 지울까요?</p>
                  </>
                ) : (
                  <>
                    <p className="price-alert-title">정말 삭제할까요?</p>
                    <p className="hint">다시 한번 확인할게요. "{r.menuName}"이(가) 지금 삭제돼요.</p>
                  </>
                )}
                <div className="invoice-form">
                  <button type="button" className="btn-secondary" onClick={closeDeleteConfirm} disabled={deleting}>
                    취소
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleConfirmDeleteClick}
                    disabled={deleting || deleteCount == null}
                  >
                    {deleting ? '삭제 중...' : (deleteCount ?? 0) > 0 && deleteConfirmStage === 1 ? '사용 중, 계속하기' : '삭제'}
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
