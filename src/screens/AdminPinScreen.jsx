import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { apiFetch } from '../lib/apiFetch'

const digitsOnly = (value) => value.replace(/\D/g, '').slice(0, 12)

// 메인 관리자 비밀번호 변경. 바꾸면 다른 기기의 관리자 로그인은 모두 끊기고, 이 기기는 계속 쓴다.
export default function AdminPinScreen() {
  const navigate = useNavigate()
  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saveMessage, setSaveMessage] = useState('')

  const handleSave = async () => {
    setError('')
    setSaveMessage('')
    if (![currentPin, newPin, confirmPin].every((v) => /^\d{6,12}$/.test(v))) {
      setError('비밀번호는 모두 숫자 6~12자리로 입력하세요.')
      return
    }
    if (newPin !== confirmPin) {
      setError('새 비밀번호와 확인이 서로 달라요.')
      return
    }
    setSaving(true)
    try {
      const res = await apiFetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'change', currentPin, newPin }),
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
      setCurrentPin('')
      setNewPin('')
      setConfirmPin('')
      setSaveMessage('관리자 비밀번호를 바꿨어요. 다른 기기에서는 새 비밀번호로 다시 들어가야 해요.')
    } catch {
      setError('인터넷 연결을 확인하고 다시 시도해주세요.')
    } finally {
      setSaving(false)
    }
  }

  const pinField = (id, label, value, setValue) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="input" type="password" inputMode="numeric" maxLength={12} value={value}
        onChange={(e) => setValue(digitsOnly(e.target.value))} placeholder="숫자 6~12자리" />
    </div>
  )

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/menu')}>
          ← 메인 메뉴
        </button>
        <h1>🔑 관리자 비밀번호 변경</h1>
        <p className="subtitle">메인 관리자로 들어올 때 쓰는 비밀번호(숫자 6~12자리)를 바꿔요</p>
      </div>
      {error && <p className="error-text">{error}</p>}
      {saveMessage && <p className="success-text">{saveMessage}</p>}
      {pinField('adminCurrentPin', '현재 비밀번호', currentPin, setCurrentPin)}
      {pinField('adminNewPin', '새 비밀번호', newPin, setNewPin)}
      {pinField('adminConfirmPin', '새 비밀번호 확인', confirmPin, setConfirmPin)}
      <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
        {saving ? '저장 중...' : '비밀번호 변경'}
      </button>
      <p className="hint" style={{ marginTop: 16 }}>
        5번 틀리면 5분 동안 잠겨요. 비밀번호를 잊으면 Supabase에서 admin_settings 표의 pin_hash를 비우면 처음처럼 다시 정할 수 있어요.
      </p>
    </div>
  )
}
