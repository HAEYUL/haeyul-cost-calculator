import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'

const ALERT_TOGGLES = [
  {
    key: 'reorder_alert_enabled',
    label: '재주문 시점 알림',
    desc: '품목별 평소 주문 주기를 넘기면 알려드려요.',
  },
  {
    key: 'margin_alert_enabled',
    label: '원가율(마진) 경고',
    desc: '단가 변동으로 메뉴 원가율이 기준치를 넘으면 알려드려요.',
  },
  {
    key: 'low_stock_alert_enabled',
    label: '재고 부족 알림',
    desc: '품목 현재고가 마이너스가 되면 알려드려요.',
  },
]

export default function NotificationSettingsScreen() {
  const { store } = useStore()
  const navigate = useNavigate()

  const [settings, setSettings] = useState({
    reorder_alert_enabled: true,
    margin_alert_enabled: true,
    low_stock_alert_enabled: true,
    phone_number: '',
  })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saveMessage, setSaveMessage] = useState('')

  useEffect(() => {
    if (!store) navigate('/', { replace: true })
  }, [store, navigate])

  useEffect(() => {
    if (!store || !supabase) return
    setLoading(true)
    setError('')
    supabase
      .from('notification_settings')
      .select('reorder_alert_enabled, margin_alert_enabled, low_stock_alert_enabled, phone_number')
      .eq('store_code', store.code)
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (err) {
          setError(err.message)
          setLoading(false)
          return
        }
        if (data) {
          setSettings({
            reorder_alert_enabled: data.reorder_alert_enabled,
            margin_alert_enabled: data.margin_alert_enabled,
            low_stock_alert_enabled: data.low_stock_alert_enabled,
            phone_number: data.phone_number ?? '',
          })
        }
        setLoading(false)
      })
  }, [store])

  if (!store) return null

  const toggle = (key) => setSettings((prev) => ({ ...prev, [key]: !prev[key] }))

  const handleSave = async () => {
    if (!supabase) return
    setSaving(true)
    setError('')
    setSaveMessage('')
    const { error: err } = await supabase.from('notification_settings').upsert(
      {
        store_code: store.code,
        reorder_alert_enabled: settings.reorder_alert_enabled,
        margin_alert_enabled: settings.margin_alert_enabled,
        low_stock_alert_enabled: settings.low_stock_alert_enabled,
        phone_number: settings.phone_number.trim() || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'store_code' },
    )
    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }
    setSaveMessage('저장했습니다.')
  }

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/menu')}>
          ← 메인 메뉴
        </button>
        <h1>알림 설정</h1>
        <p className="subtitle">{store.name} · 받고 싶은 알림과 연락처를 설정해요</p>
      </div>

      <div className="price-alert-box">
        <p className="price-alert-title">📱 문자·카카오톡 발송은 준비 중이에요</p>
        <p className="hint">
          지금은 어떤 알림을 원하시는지, 어느 번호로 받고 싶으신지만 저장해 둬요. 문자 또는 카카오톡 발송 서비스를
          정하면 그다음부터 이 설정대로 실제 알림을 보내드릴게요.
        </p>
      </div>

      {!supabase && <p className="hint">Supabase가 설정되지 않았습니다.</p>}
      {loading && <p className="hint">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}
      {saveMessage && <p className="success-text">{saveMessage}</p>}

      {!loading && supabase && (
        <>
          <h2 className="section-title">받고 싶은 알림</h2>
          {ALERT_TOGGLES.map((t) => (
            <label key={t.key} className="toggle-row">
              <input type="checkbox" checked={settings[t.key]} onChange={() => toggle(t.key)} />
              <span>
                <span className="toggle-row-label">{t.label}</span>
                <span className="toggle-row-desc">{t.desc}</span>
              </span>
            </label>
          ))}

          <h2 className="section-title">알림 받을 연락처</h2>
          <div className="field">
            <label htmlFor="phoneNumber">휴대폰 번호</label>
            <input
              id="phoneNumber"
              className="input"
              type="tel"
              value={settings.phone_number}
              onChange={(e) => setSettings((prev) => ({ ...prev, phone_number: e.target.value }))}
              placeholder="예: 010-1234-5678"
            />
          </div>

          <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '저장 중...' : '저장'}
          </button>
        </>
      )}
    </div>
  )
}
