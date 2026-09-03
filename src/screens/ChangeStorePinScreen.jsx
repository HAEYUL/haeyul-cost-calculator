import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { hashPin } from '../lib/pinHash'

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

    setSaving(true)
    const { data, error: fetchErr } = await supabase
      .from('stores')
      .select('pin_hash')
      .eq('code', store.code)
      .single()
    if (fetchErr) {
      setSaving(false)
      setError(fetchErr.message)
      return
    }

    const currentHash = await hashPin(currentPin, store.code)
    if (currentHash !== data.pin_hash) {
      setSaving(false)
      setError('현재 비밀번호가 틀렸습니다.')
      return
    }

    const newHash = await hashPin(newPin, store.code)
    const { error: updateErr } = await supabase
      .from('stores')
      .update({ pin_hash: newHash, failed_attempts: 0, locked_until: null })
      .eq('code', store.code)

    setSaving(false)
    if (updateErr) {
      setError(updateErr.message)
      return
    }

    setCurrentPin('')
    setNewPin('')
    setConfirmPin('')
    setSaveMessage('비밀번호를 변경했습니다.')
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
