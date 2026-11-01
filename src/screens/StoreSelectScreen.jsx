import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useStore } from '../context/StoreContext'
import { useInstallPrompt } from '../lib/useInstallPrompt'

const MAX_ATTEMPTS = 5
const LOCK_MINUTES = 5

function formatRemaining(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}분 ${String(s).padStart(2, '0')}초`
}

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, body }
}

// 첫 화면. 매장 버튼 = 매니저(매장 비밀번호 4자리, 지금과 같음), 맨 아래 [메인 관리자] = 4개 매장 전부.
export default function StoreSelectScreen() {
  const { stores, signIn } = useStore()
  const navigate = useNavigate()

  // null(목록) | { kind: 'store', store } | { kind: 'admin' }
  const [prompt, setPrompt] = useState(null)
  const [lockedUntil, setLockedUntil] = useState(null)
  const [pinInput, setPinInput] = useState('')
  const [confirmInput, setConfirmInput] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  // 관리자 비밀번호가 설정돼 있는지 (null = 확인 중)
  const [adminHasPin, setAdminHasPin] = useState(null)

  const { isStandalone, isIOS, canPromptInstall, promptInstall } = useInstallPrompt()
  const [showInstallGuide, setShowInstallGuide] = useState(false)

  const handleInstallClick = async () => {
    if (canPromptInstall) {
      await promptInstall()
      return
    }
    setShowInstallGuide((v) => !v)
  }

  const lockedUntilMs = lockedUntil ? new Date(lockedUntil).getTime() : null
  const isLocked = lockedUntilMs != null && lockedUntilMs > now

  useEffect(() => {
    if (!isLocked) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [isLocked])

  const openPrompt = (next) => {
    setPrompt(next)
    setPinInput('')
    setConfirmInput('')
    setError('')
    setLockedUntil(null)
    setNow(Date.now())
    if (next.kind === 'admin') {
      setAdminHasPin(null)
      postJson('/api/admin', { action: 'status' })
        .then(({ ok, body }) => {
          if (!ok) {
            setError(body.error || '관리자 정보를 불러오지 못했어요.')
            return
          }
          setAdminHasPin(body.hasPin)
          if (body.lockedUntil) setLockedUntil(body.lockedUntil)
        })
        .catch(() => setError('인터넷 연결을 확인하고 다시 시도해주세요.'))
    }
  }

  const closePrompt = () => {
    setPrompt(null)
    setLockedUntil(null)
    setPinInput('')
    setConfirmInput('')
    setError('')
  }

  // 서버가 준 출입증을 이 창에 보관하고 들어간다.
  const enterWithSession = async (session, role, store) => {
    const { error: sessionErr } = await supabase.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    })
    if (sessionErr) {
      setError(sessionErr.message)
      return
    }
    signIn(role, store)
    navigate('/menu')
  }

  const handleFailure = (body) => {
    setPinInput('')
    if (body.lockedUntil) {
      setLockedUntil(body.lockedUntil)
      setNow(Date.now())
    }
    setError(body.error || '로그인하지 못했어요. 잠시 후 다시 시도해주세요.')
  }

  // 매니저: 매장 PIN은 서버에서 확인한다.
  const submitStorePin = async () => {
    if (!supabase || prompt?.kind !== 'store' || isLocked) return
    if (!/^\d{4}$/.test(pinInput)) {
      setError('비밀번호 4자리를 입력하세요.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const { ok, body } = await postJson('/api/login', { storeCode: prompt.store.code, pin: pinInput })
      if (!ok) {
        handleFailure(body)
        return
      }
      await enterWithSession(body.session, 'manager', prompt.store)
    } catch {
      setError('인터넷 연결을 확인하고 다시 시도해주세요.')
    } finally {
      setSubmitting(false)
    }
  }

  // 메인 관리자: 처음이면 비밀번호를 정하고, 아니면 확인한다.
  const submitAdmin = async () => {
    if (!supabase || prompt?.kind !== 'admin' || isLocked || adminHasPin == null) return
    if (!/^\d{6,12}$/.test(pinInput)) {
      setError('관리자 비밀번호는 숫자 6~12자리예요.')
      return
    }
    if (!adminHasPin && pinInput !== confirmInput) {
      setError('비밀번호와 확인이 서로 달라요.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const payload = adminHasPin ? { action: 'login', pin: pinInput } : { action: 'setup', newPin: pinInput }
      const { ok, body } = await postJson('/api/admin', payload)
      if (!ok) {
        if (body.notSet) setAdminHasPin(false)
        handleFailure(body)
        return
      }
      await enterWithSession(body.session, 'admin', stores[0])
    } catch {
      setError('인터넷 연결을 확인하고 다시 시도해주세요.')
    } finally {
      setSubmitting(false)
    }
  }

  const lockedNotice = isLocked && (
    <p className="error-text">
      🔒 비밀번호를 {MAX_ATTEMPTS}회 잘못 입력해서 {LOCK_MINUTES}분간 잠겼어요.
      <br />
      {formatRemaining(lockedUntilMs - now)} 후 다시 시도할 수 있어요.
    </p>
  )

  if (prompt?.kind === 'store') {
    return (
      <div className="screen">
        <button type="button" className="link-btn" onClick={closePrompt}>
          ← 매장 선택
        </button>
        <h1>{prompt.store.name}</h1>
        <p className="subtitle">비밀번호 4자리를 입력하세요</p>
        <div className="field">
          <input
            className="input"
            type="password"
            inputMode="numeric"
            maxLength={4}
            value={pinInput}
            onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
            onKeyDown={(e) => e.key === 'Enter' && submitStorePin()}
            placeholder="••••"
            disabled={isLocked || submitting}
            autoFocus
          />
        </div>
        {lockedNotice}
        {!isLocked && error && <p className="error-text">{error}</p>}
        <button
          type="button"
          className="btn-primary"
          onClick={submitStorePin}
          disabled={isLocked || submitting || pinInput.length !== 4}
        >
          {submitting ? '확인 중...' : '확인'}
        </button>
      </div>
    )
  }

  if (prompt?.kind === 'admin') {
    const settingUp = adminHasPin === false
    return (
      <div className="screen">
        <button type="button" className="link-btn" onClick={closePrompt}>
          ← 매장 선택
        </button>
        <h1>🔑 메인 관리자</h1>
        {adminHasPin == null && !error && <p className="subtitle">확인 중...</p>}
        {adminHasPin != null && (
          <>
            <p className="subtitle">
              {settingUp ? '처음 들어오셨어요. 관리자 비밀번호(숫자 6~12자리)를 정해주세요.' : '관리자 비밀번호를 입력하세요'}
            </p>
            <div className="field">
              {settingUp && <label>새 비밀번호</label>}
              <input
                className="input"
                type="password"
                inputMode="numeric"
                maxLength={12}
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 12))}
                onKeyDown={(e) => e.key === 'Enter' && !settingUp && submitAdmin()}
                placeholder="숫자 6~12자리"
                disabled={isLocked || submitting}
                autoFocus
              />
            </div>
            {settingUp && (
              <div className="field">
                <label>한 번 더 입력</label>
                <input
                  className="input"
                  type="password"
                  inputMode="numeric"
                  maxLength={12}
                  value={confirmInput}
                  onChange={(e) => setConfirmInput(e.target.value.replace(/\D/g, '').slice(0, 12))}
                  onKeyDown={(e) => e.key === 'Enter' && submitAdmin()}
                  placeholder="숫자 6~12자리"
                  disabled={submitting}
                />
              </div>
            )}
            {lockedNotice}
            {!isLocked && error && <p className="error-text">{error}</p>}
            <button
              type="button"
              className="btn-primary"
              onClick={submitAdmin}
              disabled={isLocked || submitting || pinInput.length < 6}
            >
              {submitting ? '확인 중...' : settingUp ? '비밀번호 정하고 들어가기' : '들어가기'}
            </button>
            <p className="hint" style={{ marginTop: 16 }}>
              메인 관리자는 {stores.map((s) => s.name).join(' · ')}를 다시 로그인하지 않고 오가며 볼 수 있어요.
            </p>
          </>
        )}
        {adminHasPin == null && error && <p className="error-text">{error}</p>}
      </div>
    )
  }

  return (
    <div className="screen">
      <h1>매장 선택</h1>
      <p className="subtitle">매장을 선택하세요</p>
      <div className="store-list">
        {stores.map((s) => (
          <button key={s.code} className="store-btn" onClick={() => openPrompt({ kind: 'store', store: s })}>
            {s.name}
          </button>
        ))}
      </div>

      <button type="button" className="store-btn admin-login-btn" onClick={() => openPrompt({ kind: 'admin' })}>
        🔑 메인 관리자 로그인
      </button>

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
