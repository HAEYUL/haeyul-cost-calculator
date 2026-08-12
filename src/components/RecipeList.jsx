import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

export default function RecipeList({ storeCode, refreshKey, onEdit, onDelete }) {
  const [recipes, setRecipes] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [deletingMenu, setDeletingMenu] = useState(null)

  useEffect(() => {
    if (!supabase) return
    setLoading(true)
    setError('')
    supabase
      .from('recipes')
      .select('id, menu_name, ingredient_name, amount_g, created_at')
      .eq('store_code', storeCode)
      .order('created_at', { ascending: true })
      .then(({ data, error: err }) => {
        if (err) setError(err.message)
        else setRecipes(data ?? [])
        setLoading(false)
      })
  }, [storeCode, refreshKey])

  if (!supabase) {
    return <p className="hint">Supabase가 설정되지 않아 저장된 레시피를 볼 수 없습니다.</p>
  }

  const grouped = new Map()
  for (const row of recipes) {
    if (!grouped.has(row.menu_name)) grouped.set(row.menu_name, [])
    grouped.get(row.menu_name).push(row)
  }

  const handleDelete = async (menuName) => {
    if (!window.confirm(`"${menuName}" 레시피를 삭제할까요?`)) return
    setDeletingMenu(menuName)
    await onDelete(menuName)
    setDeletingMenu(null)
  }

  return (
    <div className="history">
      <h2>저장된 레시피</h2>
      {loading && <p className="hint">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}
      {!loading && !error && grouped.size === 0 && <p className="hint">저장된 레시피가 없습니다.</p>}

      <ul className="history-list">
        {[...grouped.entries()].map(([menuName, ingredients]) => (
          <li key={menuName} className="history-row">
            <div className="history-row-main">
              <Link className="history-item-link" to={`/recipes/${encodeURIComponent(menuName)}`}>
                {menuName}
              </Link>
              <span className="history-vendor">재료 {ingredients.length}개</span>
            </div>
            <div className="recipe-actions">
              <button type="button" className="link-btn" onClick={() => onEdit(menuName, ingredients)}>
                수정
              </button>
              <button
                type="button"
                className="link-btn link-btn-danger"
                onClick={() => handleDelete(menuName)}
                disabled={deletingMenu === menuName}
              >
                {deletingMenu === menuName ? '삭제 중...' : '삭제'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
