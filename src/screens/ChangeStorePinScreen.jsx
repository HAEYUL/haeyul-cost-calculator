import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { apiFetch } from '../lib/apiFetch'

export default function ChangeStorePinScreen() {
  const { store } = useStore()
  const navigate = useNavigate()

  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saveMessage, setSaveMessage] = useState('')

  useEffect(() => {
    if (!store) navigate('/', { replace: true })
  }, [store, navigate])

  if (!store) return null

  const digitsOnly = (value) => value.replace(/\D/g, '').slice(0, 4)

  const handleSave = async () => {
    setError('')
    setSaveMessage('')

    if (!/^\d{4}$/.test(currentPin) || !/^\d{4}$/.test(newPin) || !/^\d{4}$/.test(confirmPin)) {
      setError('비밀번호는 모두 4자리 숫자로 입력하세요.')
      return
    }
    if (newPin !== confirmPin) {
      setError('새 비밀번호와 확인이 서로 달라요.')
      return
    }
    if (!supabase) return

    // 서버에서 현재 PIN을 확인하고 바꾼다. 이 매장의 다른 기기(예전 매니저 기기 포함)는 모두 로그아웃되고,
    // 이 기기는 새 출입증을 받아 계속 쓴다.
    setSaving(true)
    try {
      const res = await apiFetch('/api/change-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPin, newPin }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error || '비밀번호를 바꾸지 못했어요.')
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
    } catch {
      setError('인터넷 연결을 확인하고 다시 시도해주세요.')
      return
    } finally {
      setSaving(false)
    }

    setCurrentPin('')
    setNewPin('')
    setConfirmPin('')
    setSaveMessage('비밀번호를 변경했습니다. 이 매장을 쓰던 다른 기기는 새 비밀번호로 다시 들어가야 해요.')
  }

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/menu')}>
          ← 메인 메뉴
        </button>
        <h1>매장 비밀번호 변경</h1>
        <p className="subtitle">{store.name} · 매장 진입 시 쓰는 4자리 비밀번호를 바꿔요</p>
      </div>

      {!supabase && <p className="hint">Supabase가 설정되지 않았습니다.</p>}
      {error && <p className="error-text">{error}</p>}
      {saveMessage && <p className="success-text">{saveMessage}</p>}

      <div className="field">
        <label htmlFor="currentPin">현재 비밀번호</label>
        <input
          id="currentPin"
          className="input"
          type="password"
          inputMode="numeric"
          maxLength={4}
          value={currentPin}
          onChange={(e) => setCurrentPin(digitsOnly(e.target.value))}
          placeholder="••••"
        />
      </div>
      <div className="field">
        <label htmlFor="newPin">새 비밀번호</label>
        <input
          id="newPin"
          className="input"
          type="password"
          inputMode="numeric"
          maxLength={4}
          value={newPin}
          onChange={(e) => setNewPin(digitsOnly(e.target.value))}
          placeholder="••••"
        />
      </div>
      <div className="field">
        <label htmlFor="confirmPin">새 비밀번호 확인</label>
        <input
          id="confirmPin"
          className="input"
          type="password"
          inputMode="numeric"
          maxLength={4}
          value={confirmPin}
          onChange={(e) => setConfirmPin(digitsOnly(e.target.value))}
          placeholder="••••"
        />
      </div>

      <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
        {saving ? '저장 중...' : '비밀번호 변경'}
      </button>
    </div>
  )
}
