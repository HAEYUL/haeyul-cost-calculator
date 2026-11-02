import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { useHistoryState } from '../hooks/usePageHistoryState'
import { fetchNotices } from '../lib/notices'
import NoticeRow from '../components/NoticeRow'

// 전달사항: 메인 관리자는 매장을 골라 보내고(여러 매장 한 번에) 확인·답장을 본다. 매니저는 자기 매장 것을 보고 확인·답장한다.
export default function NoticesScreen() {
  const { store, stores, isAdmin } = useStore()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // 매니저: 새 전달사항(확인 전) / 지난 전달사항(확인한 것). 관리자: 전체·미확인·답장·매장별
  const [filter, setFilter] = useHistoryState('noticeFilter', () => (searchParams.get('tab') === 'past' ? 'past' : isAdmin ? 'all' : 'new'))
  const [notices, setNotices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const [targets, setTargets] = useState(() => new Set([store.code]))
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  const storeCodes = useMemo(() => (isAdmin ? stores.map((s) => s.code) : [store.code]), [isAdmin, stores, store])
  const storeName = (code) => stores.find((s) => s.code === code)?.name ?? code

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    fetchNotices({ storeCodes })
      .then((rows) => {
        if (cancelled) return
        setNotices(rows)
        setError('')
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [storeCodes, reloadKey])

  const reload = () => setReloadKey((k) => k + 1)

  const toggleTarget = (code) =>
    setTargets((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  const allSelected = targets.size === stores.length

  const send = async () => {
    setError('')
    setMessage('')
    const body = text.trim()
    if (!body) return setError('전달할 내용을 입력하세요.')
    if (targets.size === 0) return setError('보낼 매장을 고르세요.')
    setSending(true)
    const { error: err } = await supabase.from('store_notices').insert([...targets].map((code) => ({ store_code: code, message: body })))
    setSending(false)
    if (err) return setError(err.message)
    setText('')
    setMessage(`${[...targets].map(storeName).join(', ')}에 보냈어요.`)
    reload()
  }

  const visible = notices.filter((n) => {
    if (isAdmin && filter.startsWith('store:')) return n.store_code === filter.slice(6)
    if (filter === 'pending' || filter === 'new') return !n.confirmed_at
    if (filter === 'past') return Boolean(n.confirmed_at)
    if (filter === 'replied') return Boolean(n.reply)
    return true
  })
  const pendingCount = notices.filter((n) => !n.confirmed_at).length
  const repliedCount = notices.filter((n) => n.reply).length

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/menu')}>
          ← 메인 메뉴
        </button>
        <h1>📢 전달사항</h1>
        <p className="subtitle">
          {isAdmin ? '매장 매니저에게 전할 내용을 보내고, 확인·답장을 확인해요' : `${store.name} · 메인 관리자가 보낸 내용이에요. 읽고 [확인했어요]를 눌러주세요`}
        </p>
      </div>

      {isAdmin && (
        <div className="cost-summary invoice-form">
          <p className="price-alert-title">✉️ 새 전달사항</p>
          <div className="preset-row">
            <button
              type="button"
              className={allSelected ? 'chip chip-active' : 'chip'}
              onClick={() => setTargets(allSelected ? new Set() : new Set(stores.map((s) => s.code)))}
            >
              전체 매장
            </button>
            {stores.map((s) => (
              <button key={s.code} type="button" className={targets.has(s.code) ? 'chip chip-active' : 'chip'} onClick={() => toggleTarget(s.code)}>
                {s.name}
              </button>
            ))}
          </div>
          <textarea
            className="input notice-textarea"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 1000))}
            placeholder="예: 11/1 ○○축산 명세표 금액이 장부와 달라요. 확인 부탁해요."
          />
          <button type="button" className="btn-primary" onClick={send} disabled={sending}>
            {sending ? '보내는 중...' : `보내기 (${targets.size}개 매장)`}
          </button>
        </div>
      )}

      {error && <p className="error-text">{error}</p>}
      {message && <p className="success-text">{message}</p>}

      <div className="preset-row" style={{ marginTop: 14 }}>
        {(isAdmin
          ? [
              ['all', `전체 ${notices.length}`],
              ['pending', `미확인 ${pendingCount}`],
              ['replied', `답장 ${repliedCount}`],
            ]
          : [
              ['new', `새 전달사항 ${pendingCount}`],
              ['past', `지난 전달사항 ${notices.length - pendingCount}`],
            ]
        ).map(([key, label]) => (
          <button key={key} type="button" className={filter === key ? 'chip chip-active' : 'chip'} onClick={() => setFilter(key)}>
            {label}
          </button>
        ))}
        {isAdmin &&
          stores.map((s) => (
            <button
              key={s.code}
              type="button"
              className={filter === `store:${s.code}` ? 'chip chip-active' : 'chip'}
              onClick={() => setFilter(`store:${s.code}`)}
            >
              {s.name}
            </button>
          ))}
      </div>

      {loading && <p className="hint">불러오는 중...</p>}
      {!loading && !error && visible.length === 0 && <p className="hint">전달사항이 없어요.</p>}
      <div className="notice-list">
        {visible.map((n) => (
          <NoticeRow key={n.id} notice={n} storeName={isAdmin ? storeName(n.store_code) : null} />
        ))}
      </div>
      <p className="hint">제목을 누르면 전체 내용이 보여요. 최근 90일 전달사항이 보여요.</p>
    </div>
  )
}
