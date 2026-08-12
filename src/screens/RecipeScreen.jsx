import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { compressImage } from '../lib/compressImage'
import RecipeList from '../components/RecipeList'

function emptyIngredient() {
  return { name: '', amountG: '', originalText: '' }
}

export default function RecipeScreen() {
  const { store } = useStore()
  const navigate = useNavigate()

  const [menuName, setMenuName] = useState('')
  const [editingMenu, setEditingMenu] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [pendingImage, setPendingImage] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState('')
  const [items, setItems] = useState([])
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const [historyKey, setHistoryKey] = useState(0)

  useEffect(() => {
    if (!store) navigate('/', { replace: true })
  }, [store, navigate])

  if (!store) return null

  const resetForm = () => {
    setMenuName('')
    setEditingMenu(null)
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

  const handleEditRecipe = (name, rows) => {
    setError('')
    setSaveMessage('')
    setMenuName(name)
    setEditingMenu(name)
    setPendingImage(null)
    setPreviewUrl(null)
    setItems(
      rows.map((row) => ({
        name: row.ingredient_name,
        amountG: row.amount_g ?? '',
        originalText: '',
      })),
    )
  }

  const handleDeleteRecipe = async (name) => {
    if (!supabase) return
    const { error: err } = await supabase.from('recipes').delete().eq('store_code', store.code).eq('menu_name', name)
    if (err) {
      setError(err.message)
      return
    }
    if (editingMenu === name) resetForm()
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
      setError('메뉴 이름과 최소 1개의 재료가 필요합니다.')
      return
    }

    setSaving(true)
    setError('')
    setSaveMessage('')

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
        <p className="subtitle">{store.name} · 메뉴 이름과 레시피 사진으로 재료량을 정리해요</p>
      </div>

      <div className="field">
        <label htmlFor="menuName">메뉴 이름</label>
        <input
          id="menuName"
          className="input"
          value={menuName}
          onChange={(e) => setMenuName(e.target.value)}
          placeholder="예: 해율만두전골 1인분"
        />
      </div>

      {editingMenu && (
        <p className="hint">
          "{editingMenu}" 레시피 수정 중입니다. <button type="button" className="inline-link" onClick={resetForm}>새로 작성</button>
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

      {items.length > 0 && (
        <div className="item-table-wrap">
          <div className="item-table item-table-narrow">
            <div className="item-row item-row-3 item-row-head">
              <span>재료명</span>
              <span>사용량(g)</span>
              <span />
            </div>
            {items.map((item, index) => (
              <div className="item-row item-row-3" key={index}>
                <input
                  className="input"
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
            ))}
          </div>
        </div>
      )}

      <div className="invoice-form">
        <button type="button" className="btn-secondary" onClick={addItem}>
          + 재료 추가
        </button>
        {(menuName.trim() || items.length > 0) && (
          <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '저장 중...' : editingMenu ? '수정 저장' : '저장'}
          </button>
        )}
      </div>

      <RecipeList storeCode={store.code} refreshKey={historyKey} onEdit={handleEditRecipe} onDelete={handleDeleteRecipe} />
    </div>
  )
}
