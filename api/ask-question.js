import { askQuestion } from './_askQuestion.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { question } = req.body ?? {}
  if (!question || !question.trim()) {
    res.status(400).json({ error: 'question이 필요합니다' })
    return
  }

  try {
    const result = await askQuestion({ question: question.trim() })
    res.status(200).json(result)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message || '답변 중 오류가 발생했습니다' })
  }
}
