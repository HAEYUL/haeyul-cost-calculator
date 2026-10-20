import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { STORES } from '../data/stores'
import { useStore } from '../context/StoreContext'
import { useInstallPrompt } from '../lib/useInstallPrompt'

const MAX_ATTEMPTS = 5
const LOCK_MINUTES = 5
const STORE_ORDER = STORES.map((s) => s.code)

function formatRemaining(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}분 ${String(s).padStart(2, '0')}초`
}

export default function StoreSelectScreen() {
  const [stores, setStores] = useState(STORES)
  const { setStore } = useStore()
  const navigate = useNavigate()

  const [pendingStore, setPendingStore] = useState(null)
  // 서버가 알려준 잠금 해제 시각(5회 틀리면 5분 잠금)
  const [lockedUntil, setLockedUntil] = useState(null)
  const [pinInput, setPinInput] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const { isStandalone, isIOS, canPromptInstall, promptInstall } = useInstallPrompt()
  const [showInstallGuide, setShowInstallGuide] = useState(false)

  const handleInstallClick = async () => {
    if (canPromptInstall) {
      await promptInstall()
      return
    }
    setShowInstallGuide((v) => !v)
  }

  useEffect(() => {
    if (!supabase) return
    supabase
      .from('stores')
      .select('code, name')
      .then(({ data, error: err }) => {
        if (!err && data?.length) {
          // DB에 저장된 순서(created_at 등)와 무관하게 항상 STORES에 정해둔 순서로 고정한다.
          const sorted = [...data].sort((a, b) => STORE_ORDER.indexOf(a.code) - STORE_ORDER.indexOf(b.code))
          setStores(sorted)
        }
      })
  }, [])

  const lockedUntilMs = lockedUntil ? new Date(lockedUntil).getTime() : null
  const isLocked = lockedUntilMs != null && lockedUntilMs > now

  useEffect(() => {
    if (!isLocked) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [isLocked])

  const openPinPrompt = (selected) => {
    setPendingStore(selected)
    setPinInput('')
    setError('')
    setLockedUntil(null)
    setNow(Date.now())
  }

  const closePinPrompt = () => {
    setPendingStore(null)
    setLockedUntil(null)
    setPinInput('')
    setError('')
  }

  // PIN은 서버에서 확인한다. 맞으면 그 매장 출입증(세션)을 받아 이 창에 보관하고 들어간다.
  const handleSubmitPin = async () => {
    if (!supabase || !pendingStore || isLocked) return
    if (!/^\d{4}$/.test(pinInput)) {
      setError('비밀번호 4자리를 입력하세요.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeCode: pendingStore.code, pin: pinInput }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setPinInput('')
        if (body.lockedUntil) {
          setLockedUntil(body.lockedUntil)
          setNow(Date.now())
        }
        setError(body.error || '로그인하지 못했어요. 잠시 후 다시 시도해주세요.')
        return
      }
      const { error: sessionErr } = await supabase.auth.setSession({
        access_token: body.session.access_token,
        refresh_token: body.session.refresh_token,
      })
      if (sessionErr) {
        setError(sessionErr.message)
        return
      }
      setStore(pendingStore)
      navigate('/menu')
    } catch {
      setError('인터넷 연결을 확인하고 다시 시도해주세요.')
    } finally {
      setSubmitting(false)
    }
  }

  if (pendingStore) {
    const remaining = isLocked ? formatRemaining(lockedUntilMs - now) : null
    return (
      <div className="screen">
        <button type="button" className="link-btn" onClick={closePinPrompt}>
          ← 매장 선택
        </button>
        <h1>{pendingStore.name}</h1>
        <p className="subtitle">비밀번호 4자리를 입력하세요</p>

        <>
            <div className="field">
              <input
                className="input"
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmitPin()}
                placeholder="••••"
                disabled={isLocked || submitting}
                autoFocus
              />
            </div>

            {isLocked && (
              <p className="error-text">
                🔒 비밀번호를 {MAX_ATTEMPTS}회 잘못 입력해서 {LOCK_MINUTES}분간 잠겼어요.
                <br />
                {remaining} 후 다시 시도할 수 있어요.
              </p>
            )}
            {!isLocked && error && <p className="error-text">{error}</p>}

            <button
              type="button"
              className="btn-primary"
              onClick={handleSubmitPin}
              disabled={isLocked || submitting || pinInput.length !== 4}
            >
              {submitting ? '확인 중...' : '확인'}
            </button>
        </>
      </div>
    )
  }

  return (
    <div className="screen">
      <h1>매장 선택</h1>
      <p className="subtitle">원가를 확인할 매장을 선택하세요</p>
      <div className="store-list">
        {stores.map((s) => (
          <button key={s.code} className="store-btn" onClick={() => openPinPrompt(s)}>
            {s.name}
          </button>
        ))}
      </div>

      {!isStandalone && (
        <>
          <button type="button" className="btn-secondary install-btn" onClick={handleInstallClick}>
            📱 홈 화면에 추가
          </button>

          {showInstallGuide && !canPromptInstall && (
            <div className="price-alert-box">
              <p className="price-alert-title">홈 화면에 추가하는 방법</p>
              {isIOS ? (
                <p className="hint">사파리 하단의 공유 버튼을 누르고 "홈 화면에 추가"를 선택하세요.</p>
              ) : (
                <p className="hint">브라우저 메뉴(점 3개)를 열고 "홈 화면에 추가" 또는 "앱 설치"를 선택하세요.</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
