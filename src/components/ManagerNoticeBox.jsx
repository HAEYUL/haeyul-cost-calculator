import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { fetchNotices } from '../lib/notices'
import NoticeRow from './NoticeRow'

// 매니저 메인 화면: 전달사항 박스 (확인 안 한 것의 제목만, 누르면 전체 내용)
export default function ManagerNoticeBox({ storeCode }) {
  const navigate = useNavigate()
  const [notices, setNotices] = useState(null)

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    fetchNotices({ storeCodes: [storeCode], unconfirmedOnly: true })
      .then((rows) => !cancelled && setNotices(rows))
      .catch(() => !cancelled && setNotices([]))
    return () => {
      cancelled = true
    }
  }, [storeCode])

  return (
    <div className={`notice-box${notices?.length ? ' notice-box-new' : ''}`}>
      <div className="notice-box-head">
        <strong>📢 전달사항{notices?.length ? ` ${notices.length}건` : ''}</strong>
        <button type="button" className="link-btn inline-link" onClick={() => navigate('/notices?tab=past')}>
          지난 전달사항 →
        </button>
      </div>
      {notices == null && <p className="hint">불러오는 중...</p>}
      {notices?.length === 0 && <p className="hint notice-empty">새 전달사항이 없어요.</p>}
      {notices?.slice(0, 3).map((n) => (
        <NoticeRow key={n.id} notice={n} />
      ))}
      {notices?.length > 3 && (
        <button type="button" className="link-btn inline-link" onClick={() => navigate('/notices')}>
          외 {notices.length - 3}건 더 보기 →
        </button>
      )}
    </div>
  )
}
