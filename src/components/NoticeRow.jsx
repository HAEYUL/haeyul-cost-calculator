import { useNavigate } from 'react-router-dom'
import { noticeTime, noticeTitle } from '../lib/notices'

// 전달사항 목록 한 줄: 제목(첫 줄)만 보이고, 누르면 전체 내용 화면으로
export default function NoticeRow({ notice, storeName }) {
  const navigate = useNavigate()
  const confirmed = Boolean(notice.confirmed_at)
  return (
    <button type="button" className={`notice-row${confirmed ? '' : ' notice-row-new'}`} onClick={() => navigate(`/notices/${notice.id}`)}>
      <span className="notice-row-dot" aria-hidden="true" />
      <span className="notice-row-title">
        {storeName && <span className="tag">{storeName}</span>} {noticeTitle(notice.message)}
      </span>
      <span className="notice-row-meta">
        {notice.reply && '💬 '}
        {confirmed ? '확인' : '미확인'} · {noticeTime(notice.created_at).split(' ')[0]}
      </span>
    </button>
  )
}
