import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { latestInvoiceInfoByItem, computeMenuCost, computeAllSubRecipeUnitCosts } from '../lib/costCalc'
import { copyRecipe } from '../lib/copyRecipe'

function ratioClass(ratio) {
  if (ratio == null) return 'hint'
  if (ratio >= 40) return 'alert-up'
  if (ratio <= 25) return 'alert-down'
  return ''
}

export default function CostScreen() {
  const { store } = useStore()
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [dataKey, setDataKey] = useState(0)
  const [newMenuName, setNewMenuName] = useState('')
  const [addingMenu, setAddingMenu] = useState(false)

  const [copyTarget, setCopyTarget] = useState(null)
  const [copyNameInput, setCopyNameInput] = useState('')
  const [copying, setCopying] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!store) navigate('/', { replace: true })
  }, [store, navigate])

  useEffect(() => {
    if (!store || !supabase) return
    setLoading(true)
    setError('')
    Promise.all([
      supabase.from('recipe_meta').select('menu_name, recipe_type, yield_qty').eq('store_code', store.code),
      supabase.from('recipes').select('menu_name, ingredient_name, amount_g, is_sub_recipe').eq('store_code', store.code),
      supabase.from('ingredient_mapping').select('recipe_ingredient_name, invoice_item_name').eq('store_code', store.code),
      supabase.from('invoices').select('item_name, unit_price, unit, created_at').eq('store_code', store.code),
      supabase.from('menu_prices').select('menu_name, selling_price').eq('store_code', store.code),
    ]).then(([metaRes, recipesRes, mappingRes, invoicesRes, pricesRes]) => {
      const err = metaRes.error || recipesRes.error || mappingRes.error || invoicesRes.error || pricesRes.error
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }

      const mappingByIngredient = new Map(
        (mappingRes.data ?? []).map((m) => [m.recipe_ingredient_name, m.invoice_item_name]),
      )
      const infoByItem = latestInvoiceInfoByItem(invoicesRes.data ?? [])
      const sellingByMenu = new Map((pricesRes.data ?? []).map((p) => [p.menu_name, Number(p.selling_price)]))

      const rowsByMenu = new Map()
      for (const r of recipesRes.data ?? []) {
        if (!rowsByMenu.has(r.menu_name)) rowsByMenu.set(r.menu_name, [])
        rowsByMenu.get(r.menu_name).push(r)
      }

      const menuMeta = (metaRes.data ?? []).filter((m) => m.recipe_type === 'menu')
      const subMeta = (metaRes.data ?? []).filter((m) => m.recipe_type === 'sub')
      const subRecipeRowsByMenu = new Map(subMeta.map((m) => [m.menu_name, rowsByMenu.get(m.menu_name) ?? []]))
      const subRecipeMetaByMenu = new Map(subMeta.map((m) => [m.menu_name, m]))
      const subUnitCostByName = computeAllSubRecipeUnitCosts({
        subRecipeRowsByMenu,
        subRecipeMetaByMenu,
        mappingByIngredient,
        infoByItem,
      })

      const computed = menuMeta.map((meta) => {
        const recipeRows = rowsByMenu.get(meta.menu_name) ?? []
        const { totalCost, hasMissing } = computeMenuCost({
          recipeRows,
          mappingByIngredient,
          infoByItem,
          subUnitCostByName,
        })
        const sellingPrice = sellingByMenu.get(meta.menu_name) ?? null
        const ratio = sellingPrice ? (totalCost / sellingPrice) * 100 : null
        return { menuName: meta.menu_name, totalCost, hasMissing, sellingPrice, ratio }
      })

      computed.sort((a, b) => {
        if (a.ratio == null && b.ratio == null) return a.menuName.localeCompare(b.menuName)
        if (a.ratio == null) return 1
        if (b.ratio == null) return -1
        return b.ratio - a.ratio
      })

      setRows(computed)
      setLoading(false)
    })
  }, [store, dataKey])

  if (!store) return null

  const handleAddMenu = async () => {
    const trimmed = newMenuName.trim()
    if (!trimmed || !supabase) return
    setAddingMenu(true)
    setError('')
    const { error: err } = await supabase
      .from('recipe_meta')
      .upsert({ store_code: store.code, menu_name: trimmed, recipe_type: 'menu' }, { onConflict: 'store_code,menu_name' })
    setAddingMenu(false)
    if (err) {
      setError(err.message)
      return
    }
    navigate(`/cost/${encodeURIComponent(trimmed)}`)
  }

  const openCopy = (menuName) => {
    setCopyTarget(menuName)
    setCopyNameInput(`${menuName} 사본`)
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
    setDataKey((k) => k + 1)
  }

  const handleDeleteMenu = async (menuName) => {
    if (!supabase) return
    setDeleting(true)
    setError('')
    const { error: rowsErr } = await supabase.from('recipes').delete().eq('store_code', store.code).eq('menu_name', menuName)
    if (rowsErr) {
      setDeleting(false)
      setError(rowsErr.message)
      return
    }
    const { error: metaErr } = await supabase
      .from('recipe_meta')
      .delete()
      .eq('store_code', store.code)
      .eq('menu_name', menuName)
    if (!metaErr) await supabase.from('menu_prices').delete().eq('store_code', store.code).eq('menu_name', menuName)
    setDeleting(false)
    if (metaErr) {
      setError(metaErr.message)
      return
    }
    setDeleteTarget(null)
    setDataKey((k) => k + 1)
  }

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/menu')}>
          ← 메인 메뉴
        </button>
        <h1>메뉴별 원가확인</h1>
        <p className="subtitle">{store.name} · 원가율이 높은 메뉴부터 정렬했어요</p>
      </div>

      <div className="field">
        <label htmlFor="newMenuName">새 메뉴 추가</label>
        <input
          id="newMenuName"
          className="input"
          value={newMenuName}
          onChange={(e) => setNewMenuName(e.target.value)}
          placeholder="예: 진미한우전골"
        />
      </div>
      <button type="button" className="btn-secondary" onClick={handleAddMenu} disabled={!newMenuName.trim() || addingMenu}>
        {addingMenu ? '추가 중...' : '메뉴 추가'}
      </button>

      {!supabase && <p className="hint">Supabase가 설정되지 않았습니다.</p>}
      {loading && <p className="hint">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}
      {!loading && !error && supabase && rows.length === 0 && <p className="hint">저장된 레시피가 없습니다.</p>}

      <ul className="history-list">
        {rows.map((row) => (
          <li key={row.menuName} className="history-row">
            <button
              type="button"
              className="cost-row-btn"
              onClick={() => navigate(`/cost/${encodeURIComponent(row.menuName)}`)}
            >
              <div className="history-row-main">
                <span className="history-item">{row.menuName}</span>
                <span className={ratioClass(row.ratio)}>
                  {row.ratio != null ? `${row.ratio.toFixed(1)}%` : '판매가 미입력'}
                </span>
              </div>
              <div className="history-row-sub">
                <span>원가 {Math.round(row.totalCost).toLocaleString()}원</span>
                {row.sellingPrice != null && <span>판매가 {row.sellingPrice.toLocaleString()}원</span>}
                {row.hasMissing && <span className="cost-warning">일부 재료 매칭/단가 필요</span>}
              </div>
            </button>
            <div className="recipe-actions">
              <button type="button" className="link-btn" onClick={() => openCopy(row.menuName)}>
                복사
              </button>
              <button type="button" className="link-btn link-btn-danger" onClick={() => setDeleteTarget(row.menuName)}>
                삭제
              </button>
            </div>

            {copyTarget === row.menuName && (
              <div className="price-alert-box">
                <p className="price-alert-title">"{row.menuName}"을(를) 복사할 새 이름</p>
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

            {deleteTarget === row.menuName && (
              <div className="price-alert-box price-alert-box-danger">
                <p className="price-alert-title">"{row.menuName}" 메뉴를 삭제할까요?</p>
                <p className="hint">재료 구성과 판매가가 함께 삭제되고, 되돌릴 수 없어요.</p>
                <div className="invoice-form">
                  <button type="button" className="btn-secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                    취소
                  </button>
                  <button type="button" className="btn-primary" onClick={() => handleDeleteMenu(row.menuName)} disabled={deleting}>
                    {deleting ? '삭제 중...' : '삭제'}
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
