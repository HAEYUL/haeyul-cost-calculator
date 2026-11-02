import { useEffect, useState } from 'react'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { useGoBack } from '../hooks/usePageHistoryState'
import { fetchSources } from '../lib/dispatchApi'
import { SOURCE_KINDS, sourceIcon } from '../lib/dispatch'
import SourcePicker from '../components/SourcePicker'

// 파출 경로 관리 (4개 매장 공통): 파출사무소·당근 등. 관리자는 고치고 숨길 수 있고, 매니저는 보고 전화하고 추가할 수 있다.
export default function DispatchSourcesScreen() {
  const { isAdmin } = useStore()
  const goBack = useGoBack('/dispatch')
  const [sources, setSources] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [editing, setEditing] = useState(null)
  const [showHidden, setShowHidden] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    fetchSources()
      .then((rows) => !cancelled && setSources(rows))
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const save = async () => {
    setError('')
    const name = editing.name.trim()
    if (!name) return setError('이름을 입력하세요.')
    const { error: err } = await supabase
      .from('dispatch_sources')
      .update({ name, kind: editing.kind, phone: editing.phone?.trim() || null, memo: editing.memo?.trim() || null, hidden: editing.hidden })
      .eq('id', editing.id)
    if (err) return setError(/duplicate|unique/i.test(err.message) ? '같은 이름의 경로가 이미 있어요.' : err.message)
    setEditing(null)
    setMessage('저장했어요.')
    setReloadKey((k) => k + 1)
  }

  const groups = SOURCE_KINDS.map((k) => ({
    ...k,
    items: sources.filter((s) => s.kind === k.key && (showHidden || !s.hidden)),
  })).filter((g) => g.items.length > 0)

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={goBack}>
          ← 파출 관리
        </button>
        <h1>🏢 파출 경로</h1>
        <p className="subtitle">파출사무소·당근 등 · 4개 매장이 함께 쓰는 목록이에요</p>
      </div>

      <div className="field source-add-field">
        <label>새 경로 추가</label>
        <SourcePicker
          sources={[]}
          value=""
          onChange={() => {}}
          onAdded={(src) => {
            setMessage(`'${src.name}' 경로를 추가했어요.`)
            setReloadKey((k) => k + 1)
          }}
        />
      </div>

      {loading && <p className="hint">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}
      {message && <p className="success-text">{message}</p>}

      {groups.map((g) => (
        <div key={g.key} className="source-group">
          <p className="menu-group-title">
            {g.icon} {g.label}
          </p>
          <div className="dispatch-cards">
            {g.items.map((s) =>
              editing?.id === s.id ? (
                <div key={s.id} className="cost-summary invoice-form">
                  <div className="field">
                    <label>종류</label>
                    <div className="preset-row">
                      {SOURCE_KINDS.map((k) => (
                        <button
                          key={k.key}
                          type="button"
                          className={editing.kind === k.key ? 'chip chip-active' : 'chip'}
                          onClick={() => setEditing((e) => ({ ...e, kind: k.key }))}
                        >
                          {k.icon} {k.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="field">
                    <label>이름</label>
                    <input className="input" value={editing.name} onChange={(e) => setEditing((x) => ({ ...x, name: e.target.value.slice(0, 40) }))} />
                  </div>
                  <div className="field">
                    <label>연락처</label>
                    <input
                      className="input"
                      inputMode="tel"
                      value={editing.phone ?? ''}
                      onChange={(e) => setEditing((x) => ({ ...x, phone: e.target.value.replace(/[^\d-]/g, '') }))}
                    />
                  </div>
                  <div className="field">
                    <label>메모</label>
                    <input className="input" value={editing.memo ?? ''} onChange={(e) => setEditing((x) => ({ ...x, memo: e.target.value.slice(0, 100) }))} />
                  </div>
                  <label className="toggle-row">
                    <input type="checkbox" checked={editing.hidden} onChange={(e) => setEditing((x) => ({ ...x, hidden: e.target.checked }))} />
                    <span>숨기기 (근무 등록 목록에서 빼요. 예전 기록은 그대로 남아요)</span>
                  </label>
                  <button type="button" className="btn-primary" onClick={save}>
                    저장
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>
                    취소
                  </button>
                </div>
              ) : (
                <div key={s.id} className={`cost-summary dispatch-card${s.hidden ? ' source-hidden' : ''}`}>
                  <div className="cost-summary-row">
                    <strong>
                      {sourceIcon(s.kind)} {s.name} {s.hidden && <span className="tag">숨김</span>}
                    </strong>
                    {isAdmin && (
                      <button type="button" className="chip edit-chip" onClick={() => setEditing({ ...s })}>
                        수정
                      </button>
                    )}
                  </div>
                  {(s.phone || s.memo) && (
                    <p className="hint">
                      {s.phone && (
                        <>
                          📞 <a href={`tel:${s.phone}`}>{s.phone}</a>
                        </>
                      )}
                      {s.phone && s.memo && ' · '}
                      {s.memo}
                    </p>
                  )}
                </div>
              ),
            )}
          </div>
        </div>
      ))}
      {isAdmin && sources.some((s) => s.hidden) && (
        <button type="button" className="link-btn" onClick={() => setShowHidden((v) => !v)}>
          {showHidden ? '숨긴 경로 감추기' : '숨긴 경로도 보기'}
        </button>
      )}
    </div>
  )
}
