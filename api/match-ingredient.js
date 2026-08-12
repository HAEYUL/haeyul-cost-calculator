import { suggestIngredientMatches } from './_suggestIngredientMatch.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { ingredientName, candidateItems } = req.body ?? {}
  if (!ingredientName || !Array.isArray(candidateItems)) {
    res.status(400).json({ error: 'ingredientName과 candidateItems가 필요합니다' })
    return
  }

  try {
    const result = await suggestIngredientMatches({ ingredientName, candidateItems })
    res.status(200).json(result)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message || '추천 중 오류가 발생했습니다' })
  }
}
