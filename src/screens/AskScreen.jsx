import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'

export default function AskScreen() {
  const { store } = useStore()
  const navigate = useNavigate()

  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!store) navigate('/', { replace: true })
  }, [store, navigate])

  if (!store) return null

  const handleAsk = async () => {
    const trimmed = question.trim()
    if (!trimmed) return
    setAsking(true)
    setError('')
    setAnswer('')
    try {
      const res = await fetch('/api/ask-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmed }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '답변에 실패했습니다')
      setAnswer(data.answer ?? '')
    } catch (err) {
      setError(err.message)
    } finally {
      setAsking(false)
    }
  }

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/menu')}>
          ← 메인 메뉴
        </button>
        <h1>사용법 물어보기</h1>
        <p className="subtitle">{store.name} · 이 앱 사용법이나 궁금한 점을 물어보세요</p>
      </div>

      <div className="field">
        <label htmlFor="question">질문</label>
        <textarea
          id="question"
          className="input"
          rows={3}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="예: 미지급금은 어떻게 계산되나요? / 박스 단위 물품을 레시피에서 개수로 쓰려면 어떻게 해야 하나요?"
        />
      </div>
      <button type="button" className="btn-primary" onClick={handleAsk} disabled={asking || !question.trim()}>
        {asking ? '답변을 만드는 중...' : '질문하기'}
      </button>

      {error && <p className="error-text">{error}</p>}

      {answer && (
        <div className="cost-summary">
          <p style={{ whiteSpace: 'pre-wrap' }}>{answer}</p>
        </div>
      )}
    </div>
  )
}
