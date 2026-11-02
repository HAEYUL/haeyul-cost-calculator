import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { SOURCE_KINDS, sourceIcon } from '../lib/dispatch'

// 파출 경로 고르기: 등록된 경로(4개 매장 공통) 중에서 고르거나, 그 자리에서 새 경로를 추가한다.
// 숨긴 경로는 목록에서 빼되, 지금 고른 값이면 그대로 보여준다(예전 기록 수정용).
export default function SourcePicker({ sources, value, onChange, onAdded, disabled }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState('agency')
  const [phone, setPhone] = useState('')
  const [memo, setMemo] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const visible = sources.filter((s) => !s.hidden || s.id === value)
  const selected = sources.find((s) => s.id === value)

  const add = async () => {
    setError('')
    const trimmed = name.trim()
    if (!trimmed) return setError('경로 이름을 입력하세요. 예: 수지인력')
    const existing = sources.find((s) => s.name === trimmed)
    if (existing) {
      onChange(existing.id)
      setAdding(false)
      return
    }
    setSaving(true)
    const { data, error: err } = await supabase
      .from('dispatch_sources')
      .insert({ name: trimmed, kind, phone: phone.trim() || null, memo: memo.trim() || null })
      .select('id, name, kind, phone, memo, hidden')
      .single()
    setSaving(false)
    if (err) return setError(/duplicate|unique/i.test(err.message) ? '같은 이름의 경로가 이미 있어요.' : err.message)
    onAdded?.(data)
    onChange(data.id)
    setAdding(false)
    setName('')
    setPhone('')
    setMemo('')
  }

  return (
    <div className="source-picker">
      <div className="preset-row">
        {visible.map((s) => (
          <button
            key={s.id}
            type="button"
            className={value === s.id ? 'chip chip-active' : 'chip'}
            onClick={() => onChange(s.id)}
            disabled={disabled}
          >
            {sourceIcon(s.kind)} {s.name}
          </button>
        ))}
        {!disabled && (
          <button type="button" className="chip chip-add" onClick={() => setAdding((v) => !v)}>
            {adding ? '닫기' : '+ 새 경로'}
          </button>
        )}
      </div>
      {selected && (selected.phone || selected.memo) && (
        <p className="hint source-info">
          {selected.phone && (
            <>
              📞 <a href={`tel:${selected.phone}`}>{selected.phone}</a>
            </>
          )}
          {selected.phone && selected.memo && ' · '}
          {selected.memo}
        </p>
      )}
      {adding && (
        <div className="cost-summary source-add">
          <div className="field">
            <label>종류</label>
            <div className="preset-row">
              {SOURCE_KINDS.map((k) => (
                <button key={k.key} type="button" className={kind === k.key ? 'chip chip-active' : 'chip'} onClick={() => setKind(k.key)}>
                  {k.icon} {k.label}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>이름</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value.slice(0, 40))} placeholder="예: 수지인력, ○○파출" />
          </div>
          <div className="rrn-row">
            <input
              className="input"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/[^\d-]/g, ''))}
              placeholder="연락처 (선택)"
            />
            <input className="input" value={memo} onChange={(e) => setMemo(e.target.value.slice(0, 100))} placeholder="메모 (선택)" />
          </div>
          {error && <p className="error-text">{error}</p>}
          <button type="button" className="btn-primary" onClick={add} disabled={saving}>
            {saving ? '저장 중...' : '경로 추가하고 고르기'}
          </button>
        </div>
      )}
    </div>
  )
}
