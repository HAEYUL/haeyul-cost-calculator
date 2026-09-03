import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { STORES } from '../data/stores'
import { useStore } from '../context/StoreContext'
import { hashPin } from '../lib/pinHash'

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
  const [storeAuth, setStoreAuth] = useState(null)
  const [pinInput, setPinInput] = useState('')
  const [error, setError] = useState('')
  const [loadingAuth, setLoadingAuth] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [now, setNow] = useState(() => Date.now())

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

  const lockedUntilMs = storeAuth?.locked_until ? new Date(storeAuth.locked_until).getTime() : null
  const isLocked = lockedUntilMs != null && lockedUntilMs > now

  useEffect(() => {
    if (!isLocked) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [isLocked])

  const openPinPrompt = async (selected) => {
    setPendingStore(selected)
    setPinInput('')
    setError('')
    setStoreAuth(null)
    if (!supabase) return
    setLoadingAuth(true)
    const { data, error: err } = await supabase
      .from('stores')
      .select('pin_hash, failed_attempts, locked_until')
      .eq('code', selected.code)
      .single()
    setLoadingAuth(false)
    if (err) {
      setError(err.message)
      return
    }
    setStoreAuth(data)
    setNow(Date.now())
  }

  const closePinPrompt = () => {
    setPendingStore(null)
    setStoreAuth(null)
    setPinInput('')
    setError('')
  }

  const handleSubmitPin = async () => {
    if (!supabase || !pendingStore || !storeAuth || isLocked) return
    if (!/^\d{4}$/.test(pinInput)) {
      setError('비밀번호 4자리를 입력하세요.')
      return
    }
    if (!storeAuth.pin_hash) {
      setError('비밀번호가 아직 설정되지 않았어요. Supabase SQL을 실행해주세요.')
      return
    }

    setSubmitting(true)
    setError('')
    const hash = await hashPin(pinInput, pendingStore.code)

    if (hash === storeAuth.pin_hash) {
      await supabase.from('stores').update({ failed_attempts: 0, locked_until: null }).eq('code', pendingStore.code)
      setSubmitting(false)
      setStore(pendingStore)
      navigate('/menu')
      return
    }

    const nextAttempts = storeAuth.failed_attempts + 1
    const shouldLock = nextAttempts >= MAX_ATTEMPTS
    const nextLockedUntil = shouldLock ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString() : null

    await supabase
      .from('stores')
      .update({ failed_attempts: shouldLock ? 0 : nextAttempts, locked_until: nextLockedUntil })
      .eq('code', pendingStore.code)

    setSubmitting(false)
    setPinInput('')
    setStoreAuth({ ...storeAuth, failed_attempts: shouldLock ? 0 : nextAttempts, locked_until: nextLockedUntil })
    setNow(Date.now())
    if (!shouldLock) {
      setError(`비밀번호가 틀렸습니다 (${nextAttempts}/${MAX_ATTEMPTS})`)
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

        {loadingAuth && <p className="hint">불러오는 중...</p>}

        {!loadingAuth && (
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
        )}
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
    </div>
  )
}
