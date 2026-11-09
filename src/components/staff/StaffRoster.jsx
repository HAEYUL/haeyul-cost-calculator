import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { WEEKDAY_LABELS } from '../../lib/staffDaily'

function WeekdayPicker({ value, onChange, disabled }) {
  return (
    <div className="staff-weekdays" role="group" aria-label="평소 쉬는 요일">
      {WEEKDAY_LABELS.map((label, wd) => {
        const on = value.includes(wd)
        return (
          <button
            key={wd}
            type="button"
            className={`chip staff-weekday${on ? ' chip-active' : ''}`}
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onChange(on ? value.filter((d) => d !== wd) : [...value, wd].sort())}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

// 직원 관리: 처음 한 번 직원을 등록해 두면 [오늘 근무 체크]에 매일 전체 직원이 나온다.
// 평소 쉬는 요일을 정해 두면 그 요일이 아닌 날은 "종일"로 미리 골라진다.
// 퇴사 처리하면 목록에서 빠지고 지난 근무 기록은 그대로 남는다(지우지 않는다).
export default function StaffRoster({ store }) {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busyId, setBusyId] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const [newName, setNewName] = useState('')
  const [newOff, setNewOff] = useState([])
  const [showRetired, setShowRetired] = useState(false)

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    setLoading(true)
    supabase
      .from('staff_members')
      .select('id, name, off_weekdays, active, sort_order')
      .eq('store_code', store.code)
      .order('sort_order')
      .order('name')
      .then(({ data, error: err }) => {
        if (cancelled) return
        setLoading(false)
        if (err) {
          setError(
            /staff_members|schema cache|does not exist/i.test(err.message ?? '')
              ? '직원 명부 표가 아직 없어요. Supabase에서 supabase/staff-daily.sql을 실행해 주세요.'
              : err.message,
          )
          return
        }
        setError('')
        setMembers(data ?? [])
      })
    return () => {
      cancelled = true
    }
  }, [store.code, reloadKey])

  const active = members.filter((m) => m.active)
  const retired = members.filter((m) => !m.active)

  const handleAdd = async (e) => {
    e.preventDefault()
    const name = newName.trim()
    if (!name || !supabase) return
    if (members.some((m) => m.name === name)) {
      setError(`"${name}" 직원은 이미 있어요. 퇴사 처리된 직원이면 아래 퇴사 목록에서 복직시켜 주세요.`)
      return
    }
    setError('')
    setBusyId('new')
    const maxOrder = members.reduce((mx, m) => Math.max(mx, m.sort_order ?? 0), 0)
    const { error: err } = await supabase
      .from('staff_members')
      .insert({ store_code: store.code, name, off_weekdays: newOff, active: true, sort_order: maxOrder + 1 })
    setBusyId('')
    if (err) {
      setError(err.message)
      return
    }
    setNewName('')
    setNewOff([])
    setMessage(`${name} 직원을 등록했어요.`)
    setReloadKey((k) => k + 1)
  }

  const update = async (member, patch, doneMessage) => {
    if (!supabase) return
    setBusyId(member.id)
    setError('')
    const { error: err } = await supabase.from('staff_members').update(patch).eq('id', member.id)
    setBusyId('')
    if (err) {
      setError(err.message)
      return
    }
    setMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, ...patch } : m)))
    if (doneMessage) setMessage(doneMessage)
  }

  // 순서 바꾸기: 이웃한 직원과 sort_order를 맞바꾼다(같은 값이면 위치 번호로 다시 매긴다).
  const move = async (index, dir) => {
    const target = index + dir
    if (target < 0 || target >= active.length || !supabase) return
    const reordered = [...active]
    ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
    const patches = reordered.map((m, i) => ({ id: m.id, sort_order: i + 1 }))
    setMembers((prev) => prev.map((m) => ({ ...m, sort_order: patches.find((p) => p.id === m.id)?.sort_order ?? m.sort_order })).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)))
    for (const p of patches) {
      // eslint-disable-next-line no-await-in-loop
      const { error: err } = await supabase.from('staff_members').update({ sort_order: p.sort_order }).eq('id', p.id)
      if (err) {
        setError(err.message)
        return
      }
    }
  }

  return (
    <div className="staff-roster">
      <form className="panel" onSubmit={handleAdd}>
        <p className="price-alert-title">직원 등록</p>
        <div className="field">
          <label htmlFor="staffNewName">이름</label>
          <input
            id="staffNewName"
            className="input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="예: 김철수"
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label>평소 쉬는 요일 (선택)</label>
          <WeekdayPicker value={newOff} onChange={setNewOff} />
          <p className="hint">고른 요일이 아닌 날은 [오늘 근무 체크]에서 "종일"로 미리 골라져요.</p>
        </div>
        <button type="submit" className="btn-primary" disabled={!newName.trim() || busyId === 'new'}>
          {busyId === 'new' ? '등록 중...' : '직원 등록'}
        </button>
      </form>

      {error && <p className="error-text">{error}</p>}
      {message && <p className="hint">{message}</p>}
      {loading && <p className="hint">불러오는 중...</p>}

      <h2 className="section-title">재직 직원 {active.length}명</h2>
      {!loading && active.length === 0 && <p className="hint">아직 등록된 직원이 없어요.</p>}
      <ul className="history-list">
        {active.map((m, i) => (
          <li key={m.id} className="history-row">
            <div className="history-row-main">
              <span className="history-item">{m.name}</span>
              <span className="history-row-main-end">
                <button type="button" className="mini-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`${m.name} 위로`}>
                  ▲
                </button>
                <button
                  type="button"
                  className="mini-btn"
                  onClick={() => move(i, 1)}
                  disabled={i === active.length - 1}
                  aria-label={`${m.name} 아래로`}
                >
                  ▼
                </button>
              </span>
            </div>
            <WeekdayPicker
              value={m.off_weekdays ?? []}
              disabled={busyId === m.id}
              onChange={(next) => update(m, { off_weekdays: next })}
            />
            <button
              type="button"
              className="link-btn"
              disabled={busyId === m.id}
              onClick={() => {
                if (window.confirm(`${m.name} 직원을 퇴사 처리할까요?\n오늘 근무 체크 목록에서 빠지고, 지난 근무 기록은 그대로 남아요.`)) {
                  update(m, { active: false }, `${m.name} 직원을 퇴사 처리했어요.`)
                }
              }}
            >
              퇴사 처리
            </button>
          </li>
        ))}
      </ul>

      {retired.length > 0 && (
        <>
          <button type="button" className="link-btn" onClick={() => setShowRetired((v) => !v)}>
            {showRetired ? '퇴사 직원 숨기기' : `퇴사 직원 ${retired.length}명 보기`}
          </button>
          {showRetired && (
            <ul className="history-list">
              {retired.map((m) => (
                <li key={m.id} className="history-row">
                  <div className="history-row-main">
                    <span className="history-item">{m.name}</span>
                    <button
                      type="button"
                      className="mini-btn"
                      disabled={busyId === m.id}
                      onClick={() => update(m, { active: true }, `${m.name} 직원을 다시 재직으로 바꿨어요.`)}
                    >
                      복직
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
