import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'

export default function FeedbackScreen() {
  const { store } = useStore()
  const navigate = useNavigate()

  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [dataKey, setDataKey] = useState(0)
  const [showResolved, setShowResolved] = useState(false)

  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!store) navigate('/', { replace: true })
  }, [store, navigate])

  useEffect(() => {
    if (!store || !supabase) return
    setLoading(true)
    setError('')
    supabase
      .from('feedback_notes')
      .select('id, content, resolved, created_at')
      .eq('store_code', store.code)
      .order('created_at', { ascending: false })
      .then(({ data, error: err }) => {
        if (err) {
          setError(err.message)
          setLoading(false)
          return
        }
        setNotes(data ?? [])
        setLoading(false)
      })
  }, [store, dataKey])

  if (!store) return null

  const visibleNotes = showResolved ? notes : notes.filter((n) => !n.resolved)
  const openCount = notes.filter((n) => !n.resolved).length

  const handleAdd = async () => {
    const trimmed = content.trim()
    if (!trimmed || !supabase) return
    setSaving(true)
    setError('')
    const { error: err } = await supabase.from('feedback_notes').insert({
      store_code: store.code,
      content: trimmed,
    })
    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }
    setContent('')
    setDataKey((k) => k + 1)
  }

  const toggleResolved = async (note) => {
    if (!supabase) return
    setError('')
    const { error: err } = await supabase
      .from('feedback_notes')
      .update({ resolved: !note.resolved })
      .eq('id', note.id)
    if (err) {
      setError(err.message)
      return
    }
    setDataKey((k) => k + 1)
  }

  const handleDelete = async () => {
    if (!deleteTarget || !supabase) return
    setDeleting(true)
    setError('')
    const { error: err } = await supabase.from('feedback_notes').delete().eq('id', deleteTarget.id)
    setDeleting(false)
    if (err) {
      setError(err.message)
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
        <h1>불편사항/건의사항</h1>
        <p className="subtitle">{store.name} · 생각날 때마다 적어두면, 나중에 Claude에게 봐달라고 하면 돼요</p>
      </div>

      {!supabase && <p className="hint">Supabase가 설정되지 않았습니다.</p>}
      {error && <p className="error-text">{error}</p>}

      <div className="field">
        <label htmlFor="feedbackContent">새로 적기</label>
        <textarea
          id="feedbackContent"
          className="input"
          rows={3}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="예: 재고 화면에서 검색이 느려요 / 이런 기능이 있으면 좋겠어요"
        />
      </div>
      <button type="button" className="btn-primary" onClick={handleAdd} disabled={saving || !content.trim()}>
        {saving ? '저장 중...' : '추가'}
      </button>

      <div className="history-header">
        <h2 className="section-title">
          {showResolved ? `전체 (${notes.length})` : `미해결 (${openCount})`}
        </h2>
        <button type="button" className="link-btn" onClick={() => setShowResolved((v) => !v)}>
          {showResolved ? '미해결만 보기' : '해결된 것도 보기'}
        </button>
      </div>

      {loading && <p className="hint">불러오는 중...</p>}
      {!loading && visibleNotes.length === 0 && (
        <p className="hint">{showResolved ? '아직 적어둔 게 없어요.' : '미해결 항목이 없어요.'}</p>
      )}

      <ul className="history-list">
        {visibleNotes.map((note) => (
          <li key={note.id} className="history-row">
            <div className="history-row-main">
              <span className={note.resolved ? 'history-item cost-warning' : 'history-item'}>{note.content}</span>
            </div>
            <div className="history-row-sub">
              <span>{new Date(note.created_at).toLocaleDateString('ko-KR')}</span>
              {note.resolved && <span>해결됨</span>}
            </div>
            <div className="recipe-actions">
              <button type="button" className="link-btn" onClick={() => toggleResolved(note)}>
                {note.resolved ? '다시 열기' : '해결 처리'}
              </button>
              <button type="button" className="link-btn link-btn-danger" onClick={() => setDeleteTarget(note)}>
                삭제
              </button>
            </div>

            {deleteTarget?.id === note.id && (
              <div className="price-alert-box price-alert-box-danger">
                <p className="price-alert-title">이 메모를 삭제할까요?</p>
                <p className="hint">되돌릴 수 없어요.</p>
                <div className="invoice-form">
                  <button type="button" className="btn-secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                    취소
                  </button>
                  <button type="button" className="btn-primary" onClick={handleDelete} disabled={deleting}>
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
