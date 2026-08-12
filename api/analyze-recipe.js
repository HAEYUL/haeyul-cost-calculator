import { analyzeRecipeImage } from './_analyzeRecipe.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { imageBase64, mediaType } = req.body ?? {}
  if (!imageBase64 || !mediaType) {
    res.status(400).json({ error: 'imageBase64와 mediaType이 필요합니다' })
    return
  }

  try {
    const result = await analyzeRecipeImage({ base64: imageBase64, mediaType })
    res.status(200).json(result)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message || '분석 중 오류가 발생했습니다' })
  }
}
