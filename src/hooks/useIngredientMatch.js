import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

// 레시피/부재료 재료 줄 하나를 그 자리에서 바로 입고 물품과 매칭할 수 있게 해주는 공용 로직.
// "재료 매칭" 화면의 추천/직접 선택 방식을 그대로 재사용해서, 다른 화면으로 이동하지 않고도
// 재료 등록과 매칭을 한 번에 끝낼 수 있게 한다. 한 번에 한 줄만 매칭 상태를 연다(matchingIndex).
export function useIngredientMatch({ storeCode, invoiceItems, onMatchSaved }) {
  const [matchingIndex, setMatchingIndex] = useState(null)
  const [matchingName, setMatchingName] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [suggesting, setSuggesting] = useState(false)
  const [manualChoice, setManualChoice] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const openMatch = async (index, ingredientName) => {
    const trimmed = ingredientName.trim()
    if (!trimmed) return
    setMatchingIndex(index)
    setMatchingName(trimmed)
    setSuggestions([])
    setManualChoice('')
    setError('')

    if (invoiceItems.length === 0) return
    setSuggesting(true)
    try {
      const res = await fetch('/api/match-ingredient', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredientName: trimmed, candidateItems: invoiceItems }),
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

  const cancelMatch = () => setMatchingIndex(null)

  const confirmMatch = async (invoiceItemName) => {
    if (!supabase || !matchingName || !invoiceItemName) return
    setSaving(true)
    setError('')
    const { error: err } = await supabase
      .from('ingredient_mapping')
      .upsert(
        { store_code: storeCode, recipe_ingredient_name: matchingName, invoice_item_name: invoiceItemName },
        { onConflict: 'store_code,recipe_ingredient_name' },
      )
    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }
    setMatchingIndex(null)
    onMatchSaved()
  }

  return {
    matchingIndex,
    suggestions,
    suggesting,
    manualChoice,
    setManualChoice,
    saving,
    error,
    openMatch,
    confirmMatch,
    cancelMatch,
  }
}
