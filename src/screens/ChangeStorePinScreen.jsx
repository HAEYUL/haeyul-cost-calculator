import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { apiFetch } from '../lib/apiFetch'
import StoreSwitcher from '../components/StoreSwitcher'

// 메인 관리자가 매장(매니저) 비밀번호 4자리를 바꾼다. 그 매장을 쓰던 매니저 기기는 모두 다시 로그인해야 한다.
export default function ChangeStorePinScreen() {
  const { store, stores, setStore } = useStore()
  const navigate = useNavigate()

  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saveMessage, setSaveMessage] = useState('')

  const digitsOnly = (value) => value.replace(/\D/g, '').slice(0, 4)

  const handleSave = async () => {
    setError('')
    setSaveMessage('')
    if (!/^\d{4}$/.test(newPin) || !/^\d{4}$/.test(confirmPin)) {
      setError('비밀번호는 4자리 숫자로 입력하세요.')
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
        body: JSON.stringify({ action: 'setStorePin', storeCode: store.code, newPin }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error || '비밀번호를 바꾸지 못했어요.')
        return
      }
      setNewPin('')
      setConfirmPin('')
      setSaveMessage(`${store.name} 매니저 비밀번호를 바꿨어요. 이 매장을 쓰던 기기는 새 비밀번호로 다시 들어가야 해요.`)
    } catch {
      setError('인터넷 연결을 확인하고 다시 시도해주세요.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/menu')}>
          ← 메인 메뉴
        </button>
        <h1>매장(매니저) 비밀번호 변경</h1>
        <p className="subtitle">매니저가 매장에 들어갈 때 쓰는 4자리 비밀번호를 바꿔요</p>
      </div>

      <div className="field">
        <label>매장</label>
        <StoreSwitcher stores={stores} store={store} onChange={setStore} className="select-block" />
      </div>
      {error && <p className="error-text">{error}</p>}
      {saveMessage && <p className="success-text">{saveMessage}</p>}
      <div className="field">
        <label htmlFor="newPin">새 비밀번호</label>
        <input id="newPin" className="input" type="password" inputMode="numeric" maxLength={4} value={newPin}
          onChange={(e) => setNewPin(digitsOnly(e.target.value))} placeholder="••••" />
      </div>
      <div className="field">
        <label htmlFor="confirmPin">새 비밀번호 확인</label>
        <input id="confirmPin" className="input" type="password" inputMode="numeric" maxLength={4} value={confirmPin}
          onChange={(e) => setConfirmPin(digitsOnly(e.target.value))} placeholder="••••" />
      </div>
      <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
        {saving ? '저장 중...' : '비밀번호 변경'}
      </button>
    </div>
  )
}
