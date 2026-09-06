import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'

function MatchPanel({ ingredientName, invoiceItems, suggestions, suggesting, manualChoice, setManualChoice, onConfirm, onCancel, saving }) {
  return (
    <div className="match-panel">
      {suggesting && <p className="hint">추천 후보를 찾는 중...</p>}
      {!suggesting && suggestions.length > 0 && (
        <div className="match-suggestions">
          {suggestions.map((s) => (
            <button key={s} type="button" className="chip" onClick={() => onConfirm(s)} disabled={saving}>
              {s}
            </button>
          ))}
        </div>
      )}
      {!suggesting && suggestions.length === 0 && invoiceItems.length > 0 && (
        <p className="hint">추천할 후보가 없습니다. 아래에서 직접 선택하세요.</p>
      )}
      {invoiceItems.length === 0 && <p className="hint">아직 등록된 입고 물품이 없습니다. 먼저 입고 입력을 해주세요.</p>}

      {invoiceItems.length > 0 && (
        <div className="field">
          <label htmlFor={`manual-${ingredientName}`}>직접 선택</label>
          <select
            id={`manual-${ingredientName}`}
            className="select"
            value={manualChoice}
            onChange={(e) => setManualChoice(e.target.value)}
          >
            <option value="">물품 선택...</option>
            {invoiceItems.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <button type="button" className="btn-secondary" onClick={() => onConfirm(manualChoice)} disabled={!manualChoice || saving}>
            이 물품으로 연결
          </button>
        </div>
      )}

      <button type="button" className="link-btn" onClick={onCancel}>
        취소
      </button>
    </div>
  )
}

export default function MatchingScreen() {
  const { store } = useStore()
  const navigate = useNavigate()

  const [recipeIngredients, setRecipeIngredients] = useState([])
  const [invoiceItems, setInvoiceItems] = useState([])
  const [mappings, setMappings] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [dataKey, setDataKey] = useState(0)

  const [selected, setSelected] = useState(null)
  const [suggestions, setSuggestions] = useState([])
  const [suggesting, setSuggesting] = useState(false)
  const [manualChoice, setManualChoice] = useState('')
  const [saving, setSaving] = useState(false)

  const [showAddForm, setShowAddForm] = useState(false)
  const [newIngredientName, setNewIngredientName] = useState('')

  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteCount, setDeleteCount] = useState(null)
  const [deleteConfirmStage, setDeleteConfirmStage] = useState(1)
  const [deleting, setDeleting] = useState(false)

  const [renameTarget, setRenameTarget] = useState(null)
  const [renameInput, setRenameInput] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameCollisionName, setRenameCollisionName] = useState(null)

  const [purgeTarget, setPurgeTarget] = useState(null)
  const [purgeCount, setPurgeCount] = useState(null)
  const [purgeConfirmStage, setPurgeConfirmStage] = useState(1)
  const [purging, setPurging] = useState(false)

  useEffect(() => {
    if (!store) navigate('/', { replace: true })
  }, [store, navigate])

  useEffect(() => {
    if (!store || !supabase) return
    setLoading(true)
    setError('')
    Promise.all([
      supabase.from('recipes').select('ingredient_name').eq('store_code', store.code),
      supabase.from('invoices').select('item_name').eq('store_code', store.code),
      supabase.from('ingredient_mapping').select('recipe_ingredient_name, invoice_item_name').eq('store_code', store.code),
    ]).then(([recipesRes, invoicesRes, mappingRes]) => {
      const err = recipesRes.error || invoicesRes.error || mappingRes.error
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }
      setRecipeIngredients([...new Set((recipesRes.data ?? []).map((r) => r.ingredient_name))])
      setInvoiceItems([...new Set((invoicesRes.data ?? []).map((r) => r.item_name))])
      setMappings(mappingRes.data ?? [])
      setLoading(false)
    })
  }, [store, dataKey])

  if (!store) return null

  const matchedNames = new Set(mappings.map((m) => m.recipe_ingredient_name))
  const unmatched = recipeIngredients.filter((name) => !matchedNames.has(name))

  const openMatch = async (ingredientName) => {
    setSelected(ingredientName)
    setSuggestions([])
    setManualChoice('')
    setError('')

    if (invoiceItems.length === 0) return

    setSuggesting(true)
    try {
      const res = await fetch('/api/match-ingredient', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredientName, candidateItems: invoiceItems }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '추천에 실패했습니다')
      setSuggestions(data.suggestions ?? [])
    } catch (err) {
      setError(err.message)
    } finally {
      setSuggesting(false)
    }
  }

  const confirmMatch = async (invoiceItemName) => {
    if (!supabase || !selected || !invoiceItemName) return
    setSaving(true)
    setError('')
    const { error: err } = await supabase
      .from('ingredient_mapping')
      .upsert(
        { store_code: store.code, recipe_ingredient_name: selected, invoice_item_name: invoiceItemName },
        { onConflict: 'store_code,recipe_ingredient_name' },
      )
    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }
    setSelected(null)
    setSuggestions([])
    setManualChoice('')
    setDataKey((k) => k + 1)
  }

  const openUnlinkConfirm = async (ingredientName) => {
    setDeleteTarget(ingredientName)
    setDeleteConfirmStage(1)
    setDeleteCount(null)
    setError('')
    if (!supabase) return
    const { count } = await supabase
      .from('recipes')
      .select('id', { count: 'exact', head: true })
      .eq('store_code', store.code)
      .eq('is_sub_recipe', false)
      .eq('ingredient_name', ingredientName)
    setDeleteCount(count ?? 0)
  }

  const closeUnlinkConfirm = () => {
    setDeleteTarget(null)
    setDeleteCount(null)
    setDeleteConfirmStage(1)
  }

  const handleConfirmUnlinkClick = () => {
    if ((deleteCount ?? 0) > 0 && deleteConfirmStage === 1) {
      setDeleteConfirmStage(2)
      return
    }
    unlink()
  }

  const unlink = async () => {
    if (!supabase || !deleteTarget) return
    setDeleting(true)
    setError('')
    const { error: err } = await supabase
      .from('ingredient_mapping')
      .delete()
      .eq('store_code', store.code)
      .eq('recipe_ingredient_name', deleteTarget)
    setDeleting(false)
    if (err) {
      setError(err.message)
      return
    }
    if (selected === deleteTarget) setSelected(null)
    closeUnlinkConfirm()
    setDataKey((k) => k + 1)
  }

  const openRename = (ingredientName) => {
    setRenameTarget(ingredientName)
    setRenameInput(ingredientName)
    setRenameCollisionName(null)
    setSelected(null)
    setError('')
  }

  const closeRename = () => {
    setRenameTarget(null)
    setRenameInput('')
    setRenameCollisionName(null)
  }

  // 실제로 이름을 바꾸는 부분. mergeInto가 true면(이미 같은 이름의 매칭이 있어서 합치는
  // 경우) 옛 이름의 매칭 행은 지우고 기존 매칭(새 이름 쪽)을 그대로 쓴다 — 그렇지 않으면 옛
  // 매칭 행의 이름만 새 이름으로 바꾼다.
  const applyRename = async (newName, { mergeInto } = {}) => {
    setRenaming(true)
    setError('')

    const { error: recErr } = await supabase
      .from('recipes')
      .update({ ingredient_name: newName })
      .eq('store_code', store.code)
      .eq('is_sub_recipe', false)
      .eq('ingredient_name', renameTarget)
    if (recErr) {
      setRenaming(false)
      setError(recErr.message)
      return
    }

    const { error: mapErr } = mergeInto
      ? await supabase
          .from('ingredient_mapping')
          .delete()
          .eq('store_code', store.code)
          .eq('recipe_ingredient_name', renameTarget)
      : await supabase
          .from('ingredient_mapping')
          .update({ recipe_ingredient_name: newName })
          .eq('store_code', store.code)
          .eq('recipe_ingredient_name', renameTarget)
    setRenaming(false)
    if (mapErr) {
      setError(mapErr.message)
      return
    }
    closeRename()
    setDataKey((k) => k + 1)
  }

  // 이 재료명을 쓰는 모든 레시피(여러 메뉴에 걸쳐 있을 수 있음)와 매칭 연결을 한 번에 새
  // 이름으로 바꾼다. 재고관리의 "이름 수정"과 같은 원리를 재료명 쪽에 적용한 것. 새 이름이
  // 이미 다른 재료의 매칭명으로 쓰이고 있으면(레시피 쪽엔 이름 중복 제한이 없어 먼저 바뀌어
  // 버린 뒤 매칭 쪽에서만 실패하는 걸 막기 위해) 아무것도 바꾸지 않고 먼저 합칠지 확인받는다.
  const handleRename = async () => {
    const newName = renameInput.trim()
    if (!renameTarget || !newName || !supabase) return
    if (newName === renameTarget) {
      closeRename()
      return
    }
    setRenaming(true)
    setError('')
    const { data: existing, error: checkErr } = await supabase
      .from('ingredient_mapping')
      .select('recipe_ingredient_name')
      .eq('store_code', store.code)
      .eq('recipe_ingredient_name', newName)
      .maybeSingle()
    setRenaming(false)
    if (checkErr) {
      setError(checkErr.message)
      return
    }
    if (existing) {
      setRenameCollisionName(newName)
      return
    }
    applyRename(newName)
  }

  const handleConfirmMerge = () => {
    if (!renameCollisionName) return
    applyRename(renameCollisionName, { mergeInto: true })
  }

  const openPurgeConfirm = async (ingredientName) => {
    setPurgeTarget(ingredientName)
    setPurgeConfirmStage(1)
    setPurgeCount(null)
    setError('')
    if (!supabase) return
    const { count } = await supabase
      .from('recipes')
      .select('id', { count: 'exact', head: true })
      .eq('store_code', store.code)
      .eq('is_sub_recipe', false)
      .eq('ingredient_name', ingredientName)
    setPurgeCount(count ?? 0)
  }

  const closePurgeConfirm = () => {
    setPurgeTarget(null)
    setPurgeCount(null)
    setPurgeConfirmStage(1)
  }

  const handleConfirmPurgeClick = () => {
    if ((purgeCount ?? 0) > 0 && purgeConfirmStage === 1) {
      setPurgeConfirmStage(2)
      return
    }
    purgeIngredient()
  }

  // "연결 해제"와 달리, 이 재료명을 쓰는 모든 레시피에서 그 재료 줄 자체를 지운다(매칭도 함께
  // 삭제). 더 이상 안 쓰는 재료를 완전히 정리할 때 쓴다 — 되돌릴 수 없다.
  const purgeIngredient = async () => {
    if (!supabase || !purgeTarget) return
    setPurging(true)
    setError('')

    const { error: recErr } = await supabase
      .from('recipes')
      .delete()
      .eq('store_code', store.code)
      .eq('is_sub_recipe', false)
      .eq('ingredient_name', purgeTarget)
    if (recErr) {
      setPurging(false)
      setError(recErr.message)
      return
    }

    const { error: mapErr } = await supabase
      .from('ingredient_mapping')
      .delete()
      .eq('store_code', store.code)
      .eq('recipe_ingredient_name', purgeTarget)
    setPurging(false)
    if (mapErr) {
      setError(mapErr.message)
      return
    }
    if (selected === purgeTarget) setSelected(null)
    closePurgeConfirm()
    setDataKey((k) => k + 1)
  }

  const confirmNewMatch = async (invoiceItemName) => {
    await confirmMatch(invoiceItemName)
    setShowAddForm(false)
    setNewIngredientName('')
  }

  const panelProps = {
    invoiceItems,
    suggestions,
    suggesting,
    manualChoice,
    setManualChoice,
    onConfirm: confirmMatch,
    onCancel: () => setSelected(null),
    saving,
  }

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/menu')}>
          ← 메인 메뉴
        </button>
        <h1>재료 매칭</h1>
        <p className="subtitle">{store.name} · 레시피 재료명과 입고 물품명을 연결해요</p>
      </div>

      {!supabase && <p className="hint">Supabase가 설정되지 않았습니다.</p>}
      {loading && <p className="hint">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}

      {!loading && supabase && (
        <>
          <div className="section-title-row">
            <h2 className="section-title">새 재료 매칭 추가</h2>
            <button
              type="button"
              className="icon-btn"
              aria-label="새 재료 매칭 추가"
              onClick={() => {
                setShowAddForm((v) => !v)
                setNewIngredientName('')
                setSelected(null)
              }}
            >
              {showAddForm ? '−' : '+'}
            </button>
          </div>
          {showAddForm && (
            <div className="field">
              <input
                className="input"
                value={newIngredientName}
                onChange={(e) => setNewIngredientName(e.target.value)}
                placeholder="아직 레시피에 없는 재료명도 미리 매칭해둘 수 있어요"
                autoFocus
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={() => openMatch(newIngredientName.trim())}
                disabled={!newIngredientName.trim()}
              >
                매칭할 물품 찾기
              </button>
              {selected === newIngredientName.trim() && newIngredientName.trim() && (
                <MatchPanel ingredientName={selected} {...panelProps} onConfirm={confirmNewMatch} />
              )}
            </div>
          )}

          <h2 className="section-title">매칭 대기 ({unmatched.length})</h2>
          {unmatched.length === 0 && <p className="hint">모든 재료가 연결되었습니다.</p>}
          <ul className="history-list">
            {unmatched.map((name) => (
              <li key={name} className="history-row">
                <button type="button" className="match-ingredient-btn" onClick={() => openMatch(name)}>
                  {name}
                </button>
                {selected === name && <MatchPanel ingredientName={name} {...panelProps} />}
              </li>
            ))}
          </ul>

          <h2 className="section-title">매칭 완료 ({mappings.length})</h2>
          {mappings.length === 0 && <p className="hint">아직 연결된 재료가 없습니다.</p>}
          <ul className="history-list">
            {mappings.map((m) => (
              <li key={m.recipe_ingredient_name} className="history-row">
                <div className="history-row-main">
                  <span className="history-item">
                    {m.recipe_ingredient_name} → {m.invoice_item_name}
                  </span>
                </div>
                <div className="recipe-actions">
                  <button type="button" className="link-btn" onClick={() => openMatch(m.recipe_ingredient_name)}>
                    변경
                  </button>
                  <button type="button" className="link-btn" onClick={() => openRename(m.recipe_ingredient_name)}>
                    이름 수정
                  </button>
                  <button
                    type="button"
                    className="link-btn link-btn-danger"
                    onClick={() => openUnlinkConfirm(m.recipe_ingredient_name)}
                  >
                    연결 해제
                  </button>
                  <button
                    type="button"
                    className="link-btn link-btn-danger"
                    onClick={() => openPurgeConfirm(m.recipe_ingredient_name)}
                  >
                    완전 삭제
                  </button>
                </div>
                {selected === m.recipe_ingredient_name && (
                  <MatchPanel ingredientName={m.recipe_ingredient_name} {...panelProps} />
                )}
                {renameTarget === m.recipe_ingredient_name && (
                  <div className="price-alert-box">
                    {renameCollisionName ? (
                      <>
                        <p className="price-alert-title">⚠️ 이미 "{renameCollisionName}"로 매칭된 재료가 있어요</p>
                        <p className="hint">
                          두 재료를 합칠까요? "{m.recipe_ingredient_name}"을(를) 쓰던 레시피는 이제 "
                          {renameCollisionName}"의 매칭(물품 연결)을 그대로 쓰게 돼요. 되돌릴 수 없어요.
                        </p>
                        <div className="invoice-form">
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => setRenameCollisionName(null)}
                            disabled={renaming}
                          >
                            취소
                          </button>
                          <button
                            type="button"
                            className="btn-primary"
                            onClick={handleConfirmMerge}
                            disabled={renaming}
                          >
                            {renaming ? '합치는 중...' : '합치기'}
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="price-alert-title">재료명 수정</p>
                        <p className="hint">
                          "{m.recipe_ingredient_name}"을(를) 쓰는 모든 레시피와 매칭 연결이 새 이름으로 한 번에
                          바뀌어요.
                        </p>
                        <div className="field">
                          <input
                            className="input"
                            value={renameInput}
                            onChange={(e) => setRenameInput(e.target.value)}
                            placeholder="새 재료명"
                            autoFocus
                          />
                        </div>
                        <div className="invoice-form">
                          <button type="button" className="btn-secondary" onClick={closeRename} disabled={renaming}>
                            취소
                          </button>
                          <button
                            type="button"
                            className="btn-primary"
                            onClick={handleRename}
                            disabled={renaming || !renameInput.trim()}
                          >
                            {renaming ? '수정 중...' : '수정'}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
                {purgeTarget === m.recipe_ingredient_name && (
                  <div className="price-alert-box price-alert-box-danger">
                    {purgeCount == null ? (
                      <p className="hint">확인 중...</p>
                    ) : purgeCount === 0 ? (
                      <p className="price-alert-title">"{m.recipe_ingredient_name}"을(를) 완전히 삭제할까요?</p>
                    ) : purgeConfirmStage === 1 ? (
                      <>
                        <p className="price-alert-title">⚠️ 이 재료를 쓰는 레시피가 {purgeCount}곳 있어요</p>
                        <p className="hint">
                          지금 삭제하면 그 레시피들에서 "{m.recipe_ingredient_name}" 줄 자체가 없어지고, 매칭 연결도
                          같이 사라져요. 정말 삭제할까요?
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="price-alert-title">정말 삭제할까요?</p>
                        <p className="hint">다시 한번 확인할게요. "{m.recipe_ingredient_name}"이(가) 지금 삭제돼요.</p>
                      </>
                    )}
                    <div className="invoice-form">
                      <button type="button" className="btn-secondary" onClick={closePurgeConfirm} disabled={purging}>
                        취소
                      </button>
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={handleConfirmPurgeClick}
                        disabled={purging || purgeCount == null}
                      >
                        {purging
                          ? '삭제 중...'
                          : (purgeCount ?? 0) > 0 && purgeConfirmStage === 1
                            ? '사용 중, 계속하기'
                            : '완전 삭제'}
                      </button>
                    </div>
                  </div>
                )}
                {deleteTarget === m.recipe_ingredient_name && (
                  <div className="price-alert-box price-alert-box-danger">
                    {deleteCount == null ? (
                      <p className="hint">확인 중...</p>
                    ) : deleteCount === 0 ? (
                      <p className="price-alert-title">"{m.recipe_ingredient_name}" 연결을 해제할까요?</p>
                    ) : deleteConfirmStage === 1 ? (
                      <>
                        <p className="price-alert-title">⚠️ 이 재료를 쓰는 레시피가 {deleteCount}곳 있어요</p>
                        <p className="hint">지금 해제하면 그 레시피들의 원가 계산에서 이 재료가 조용히 빠져요. 정말 해제할까요?</p>
                      </>
                    ) : (
                      <>
                        <p className="price-alert-title">정말 해제할까요?</p>
                        <p className="hint">다시 한번 확인할게요. "{m.recipe_ingredient_name}" 연결이 지금 해제돼요.</p>
                      </>
                    )}
                    <div className="invoice-form">
                      <button type="button" className="btn-secondary" onClick={closeUnlinkConfirm} disabled={deleting}>
                        취소
                      </button>
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={handleConfirmUnlinkClick}
                        disabled={deleting || deleteCount == null}
                      >
                        {deleting
                          ? '해제 중...'
                          : (deleteCount ?? 0) > 0 && deleteConfirmStage === 1
                            ? '사용 중, 계속하기'
                            : '연결 해제'}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
