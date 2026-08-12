import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { parseScale } from '../lib/parseScale'

export default function RecipeDetailScreen() {
  const { store } = useStore()
  const navigate = useNavigate()
  const { menuName: encodedMenuName } = useParams()
  const menuName = decodeURIComponent(encodedMenuName ?? '')

  const [ingredients, setIngredients] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [scaleText, setScaleText] = useState('1')

  useEffect(() => {
    if (!store) navigate('/', { replace: true })
  }, [store, navigate])

  useEffect(() => {
    if (!store || !supabase) return
    setLoading(true)
    setError('')
    supabase
      .from('recipes')
      .select('id, ingredient_name, amount_g')
      .eq('store_code', store.code)
      .eq('menu_name', menuName)
      .order('created_at', { ascending: true })
      .then(({ data, error: err }) => {
        if (err) setError(err.message)
        else setIngredients(data ?? [])
        setLoading(false)
      })
  }, [store, menuName])

  if (!store) return null

  const parsedScale = parseScale(scaleText)
  const scaleValid = parsedScale != null
  const effectiveScale = scaleValid ? parsedScale : 1

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/recipes')}>
          ← 레시피 목록
        </button>
        <h1>{menuName}</h1>
        <p className="subtitle">배율을 입력하면 재료량이 바로 바뀝니다</p>
      </div>

      <div className="field">
        <label htmlFor="scale">환산 배율 (예: 0.5, 1/3, 2)</label>
        <input
          id="scale"
          className="input"
          value={scaleText}
          onChange={(e) => setScaleText(e.target.value)}
          placeholder="1"
        />
        {!scaleValid && <p className="error-text">숫자 또는 분수(예: 1/3)를 0보다 크게 입력하세요.</p>}
      </div>

      {!supabase && <p className="hint">Supabase가 설정되지 않았습니다.</p>}
      {loading && <p className="hint">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}
      {!loading && !error && supabase && ingredients.length === 0 && (
        <p className="hint">이 메뉴의 재료 정보가 없습니다.</p>
      )}

      <ul className="history-list">
        {ingredients.map((ing) => {
          const scaled = ing.amount_g != null ? Number(ing.amount_g) * effectiveScale : null
          return (
            <li key={ing.id} className="history-row">
              <div className="history-row-main">
                <span className="history-item">{ing.ingredient_name}</span>
                <span className="history-vendor">{scaled != null ? `${scaled.toFixed(1)}g` : '—'}</span>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
