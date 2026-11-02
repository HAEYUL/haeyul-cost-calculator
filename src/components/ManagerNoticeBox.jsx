import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { fetchNotices } from '../lib/notices'
import NoticeCard from './NoticeCard'

// 매니저 메인 화면 맨 위: 아직 확인하지 않은 전달사항
export default function ManagerNoticeBox({ storeCode }) {
  const navigate = useNavigate()
  const [notices, setNotices] = useState([])
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    fetchNotices({ storeCodes: [storeCode], unconfirmedOnly: true })
      .then((rows) => !cancelled && setNotices(rows))
      .catch(() => !cancelled && setNotices([]))
    return () => {
      cancelled = true
    }
  }, [storeCode, reloadKey])

  return (
    <div className="manager-notices">
      {notices.length > 0 && <p className="menu-group-title">📢 확인할 전달사항 {notices.length}건</p>}
      {notices.map((n) => (
        <NoticeCard key={n.id} notice={n} isAdmin={false} onChanged={() => setReloadKey((k) => k + 1)} />
      ))}
      <button type="button" className="link-btn notice-all-link" onClick={() => navigate('/notices')}>
        📢 전달사항 전체 보기 →
      </button>
    </div>
  )
}
