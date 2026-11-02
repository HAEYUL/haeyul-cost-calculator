import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { useGoBack } from '../hooks/usePageHistoryState'
import { fetchNotice } from '../lib/notices'
import NoticeCard from '../components/NoticeCard'

// 전달사항 전체 내용. 매니저는 확인·답장, 관리자는 삭제.
export default function NoticeDetailScreen() {
  const { stores, isAdmin } = useStore()
  const { noticeId } = useParams()
  const goBack = useGoBack('/notices')
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    fetchNotice(noticeId)
      .then((n) => !cancelled && setNotice(n))
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [noticeId, reloadKey])

  const remove = async () => {
    if (!window.confirm('이 전달사항을 지울까요?')) return
    const { error: err } = await supabase.from('store_notices').delete().eq('id', noticeId)
    if (err) return setError(err.message)
    goBack()
  }

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={goBack}>
          ← 전달사항
        </button>
        <h1>📢 전달사항</h1>
      </div>
      {error && <p className="error-text">{error}</p>}
      {!notice && !error && <p className="hint">불러오는 중...</p>}
      {notice && (
        <NoticeCard
          notice={notice}
          storeName={isAdmin ? stores.find((s) => s.code === notice.store_code)?.name : null}
          isAdmin={isAdmin}
          onChanged={() => setReloadKey((k) => k + 1)}
          onDelete={isAdmin ? remove : null}
        />
      )}
    </div>
  )
}
