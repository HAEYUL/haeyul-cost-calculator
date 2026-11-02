import { useState } from 'react'
import { confirmNotice, noticeTime } from '../lib/notices'

// 전달사항 한 건. 매니저는 [확인했어요](+답장), 관리자는 [삭제].
export default function NoticeCard({ notice, storeName, isAdmin, onChanged, onDelete }) {
  const [reply, setReply] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const confirmed = Boolean(notice.confirmed_at)

  const handleConfirm = async () => {
    setSaving(true)
    setError('')
    const { error: err } = await confirmNotice(notice.id, reply)
    setSaving(false)
    if (err) return setError(err.message)
    setReply('')
    onChanged?.()
  }

  return (
    <div className={`cost-summary notice-card${confirmed ? ' notice-done' : ''}`}>
      <div className="cost-summary-row">
        <span className="notice-meta">
          {storeName && <span className="tag">{storeName}</span>} 📢 {noticeTime(notice.created_at)}
        </span>
        <span className={confirmed ? 'paid-text' : 'pending-text'}>
          {confirmed ? `확인 ${noticeTime(notice.confirmed_at)}` : '미확인'}
        </span>
      </div>
      <p className="notice-message">{notice.message}</p>
      {notice.reply && (
        <p className="notice-reply">
          💬 {isAdmin ? '매니저 답장' : '내 답장'}: {notice.reply}
        </p>
      )}
      {!isAdmin && !confirmed && (
        <div className="notice-actions">
          <input
            className="input"
            value={reply}
            onChange={(e) => setReply(e.target.value.slice(0, 500))}
            placeholder="답장 (선택) 예: 확인해서 고쳤습니다"
          />
          <button type="button" className="btn-primary" onClick={handleConfirm} disabled={saving}>
            {saving ? '저장 중...' : '✔ 확인했어요'}
          </button>
        </div>
      )}
      {isAdmin && onDelete && (
        <div className="notice-actions-right">
          <button type="button" className="link-btn link-btn-danger inline-link" onClick={() => onDelete(notice)}>
            삭제
          </button>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  )
}
