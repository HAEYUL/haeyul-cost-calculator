import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { useGoBack, useHistoryState } from '../hooks/usePageHistoryState'
import { dispatchRequest, fetchShifts, WORKER_COLUMNS, workerPayload } from '../lib/dispatchApi'
import PositionTag from '../components/PositionTag'
import {
  INSURANCE_DAY_LIMIT,
  monthRange,
  POSITIONS,
  positionsOf,
  rrnDigits,
  rrnError,
  shiftMonthKey,
  showMaskedRrn,
  summarizeByWorker,
  timeRangeLabel,
  won,
  wonPlain,
} from '../lib/dispatch'
import { currentMonth } from '../lib/vendorLedger'

const dayLabel = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`

// 파출 인력 한 분의 한 달 내역(종이 명세서처럼)과 명부 정보 수정
export default function DispatchWorkerScreen() {
  const { store, isAdmin } = useStore()
  const navigate = useNavigate()
  const goBack = useGoBack('/dispatch')
  const { workerId } = useParams()
  const [searchParams] = useSearchParams()
  const [month, setMonth] = useHistoryState('workerMonth', () => searchParams.get('month') || currentMonth())

  const [worker, setWorker] = useState(null)
  const [shifts, setShifts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    supabase
      .from('dispatch_workers')
      .select(WORKER_COLUMNS)
      .eq('id', workerId)
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err || !data) setError(err?.message || '인력을 찾을 수 없어요.')
        else setWorker(data)
      })
    return () => {
      cancelled = true
    }
  }, [workerId])

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    setLoading(true)
    const { start, end } = monthRange(month)
    fetchShifts({ workerId, start, end })
      .then((rows) => !cancelled && setShifts([...rows].sort((a, b) => a.work_date.localeCompare(b.work_date))))
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [workerId, month])

  const startEdit = () => {
    setForm({
      name: worker.name,
      isFixed: worker.is_fixed,
      defaultPosition: worker.default_position ?? '',
      bank: worker.bank ?? '',
      account: worker.account ?? '',
      memo: worker.memo ?? '',
      rrn: '',
    })
    setEditing(true)
    setMessage('')
    setError('')
  }

  const saveWorker = async () => {
    setError('')
    if (!form.name.trim()) return setError('이름을 입력하세요.')
    if (form.rrn) {
      const err = rrnError(form.rrn)
      if (err) return setError(err)
    }
    setSaving(true)
    const { ok, body } = await dispatchRequest('saveWorker', {
      storeCode: worker.store_code,
      ...workerPayload(worker, {
        name: form.name.trim(),
        isFixed: form.isFixed,
        defaultPosition: form.defaultPosition || null,
        bank: form.bank,
        account: form.account,
        memo: form.memo,
        ...(form.rrn ? { rrn: rrnDigits(form.rrn) } : {}),
      }),
    })
    setSaving(false)
    if (!ok) return setError(body.error || '저장하지 못했어요.')
    setWorker(body.worker)
    setEditing(false)
    setMessage('저장했어요.')
  }

  const deleteWorker = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setSaving(true)
    const { ok, body } = await dispatchRequest('deleteWorker', { storeCode: worker.store_code, id: worker.id })
    setSaving(false)
    if (!ok) {
      setConfirmDelete(false)
      return setError(body.error || '지우지 못했어요.')
    }
    goBack()
  }

  if (!worker) {
    return (
      <div className="screen screen-wide">
        <button type="button" className="link-btn" onClick={goBack}>
          ← 파출 관리
        </button>
        {error ? <p className="error-text">{error}</p> : <p className="hint">불러오는 중...</p>}
      </div>
    )
  }

  const summary = summarizeByWorker(shifts).get(worker.id)
  const [y, m] = month.split('-')
  const setField = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={goBack}>
          ← 파출 관리
        </button>
        <h1>
          {worker.name} {worker.is_fixed && <span className="tag">고정</span>}{' '}
          {worker.default_position && <PositionTag value={worker.default_position} />}
        </h1>
        <p className="subtitle">
          {showMaskedRrn(worker.rrn_masked)} · {[worker.bank, worker.account].filter(Boolean).join(' ') || '계좌 없음'}
          {isAdmin && worker.store_code !== store.code && ' · 다른 매장 인력'}
        </p>
      </div>

      <div className="month-nav">
        <button type="button" className="chip" onClick={() => setMonth(shiftMonthKey(month, -1))} aria-label="이전 달">
          ◀
        </button>
        <strong>
          {y}년 {Number(m)}월
        </strong>
        <button type="button" className="chip" onClick={() => setMonth(shiftMonthKey(month, 1))} aria-label="다음 달">
          ▶
        </button>
      </div>

      <button type="button" className="btn-primary" onClick={() => navigate(`/dispatch/new?worker=${worker.id}`)}>
        + 근무 등록
      </button>

      {loading && <p className="hint">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}
      {message && <p className="success-text">{message}</p>}

      {!loading && (
        <>
          {shifts.length === 0 ? (
            <p className="hint">이 달에 근무 기록이 없어요.</p>
          ) : (
            <div className="ledger-table-wrap">
              <table className="dispatch-table">
                <thead>
                  <tr>
                    <th>날짜</th>
                    <th>포지션</th>
                    <th>근무시간</th>
                    <th className="num">일당</th>
                    <th className="num">송금</th>
                  </tr>
                </thead>
                <tbody>
                  {shifts.map((s) => (
                    <tr key={s.id} className="clickable" onClick={() => navigate(`/dispatch/edit/${s.id}`)}>
                      <td>{dayLabel(s.work_date)}</td>
                      <td>
                        <PositionTag value={s.position} />
                      </td>
                      <td>{timeRangeLabel(s.start_time, s.end_time)}</td>
                      <td className="num">{wonPlain(s.wage)}</td>
                      <td className={`num ${s.paid_date ? 'paid-text' : 'pending-text'}`}>
                        {s.paid_date ? `✔ ${dayLabel(s.paid_date)}` : '대기'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {summary && (
            <div className="cost-summary">
              <div className="cost-summary-row">
                <span>합계</span>
                <strong>
                  {summary.days}일 · {won(summary.total)}
                </strong>
              </div>
              <div className="cost-summary-row">
                <span>포지션</span>
                <span>{positionsOf(shifts)}</span>
              </div>
              <div className="cost-summary-row">
                <span>송금 완료</span>
                <span className="paid-text">{won(summary.paid)}</span>
              </div>
              <div className="cost-summary-row">
                <span>송금 대기</span>
                <span className="pending-text">{won(summary.unpaid)}</span>
              </div>
              {summary.days >= INSURANCE_DAY_LIMIT && (
                <p className="hint cost-warning">⚠️ 이번 달 {INSURANCE_DAY_LIMIT}일 이상 근무 (국민연금·건강보험 확인 대상)</p>
              )}
            </div>
          )}
        </>
      )}

      {!editing ? (
        <button type="button" className="btn-secondary" onClick={startEdit}>
          ✏️ 인력 정보 고치기 (고정 파출·평소 포지션·계좌)
        </button>
      ) : (
        <div className="cost-summary invoice-form">
          <p className="price-alert-title">인력 정보</p>
          <div className="field">
            <label>이름</label>
            <input className="input" value={form.name} onChange={setField('name')} />
          </div>
          <label className="toggle-row">
            <input type="checkbox" checked={form.isFixed} onChange={setField('isFixed')} />
            <span>📌 고정 파출 (고정 파출 화면에 모아서 보여주고 [오늘 출근 +]로 빠르게 등록)</span>
          </label>
          <div className="field">
            <label>평소 포지션</label>
            <div className="position-row">
              {POSITIONS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className={`position-btn${form.defaultPosition === p.key ? ' position-btn-on' : ''}`}
                  onClick={() => setForm((prev) => ({ ...prev, defaultPosition: p.key }))}
                >
                  <span className="position-check">{form.defaultPosition === p.key ? '☑' : '☐'}</span> {p.icon} {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>계좌</label>
            <div className="rrn-row">
              <input className="input bank-input" value={form.bank} onChange={setField('bank')} placeholder="은행" />
              <input className="input" inputMode="numeric" value={form.account} onChange={setField('account')} placeholder="계좌번호" />
            </div>
          </div>
          <div className="field">
            <label>주민등록번호 다시 입력 (잘못 넣었을 때만)</label>
            <input
              className="input"
              type="password"
              inputMode="numeric"
              maxLength={14}
              value={form.rrn}
              onChange={(e) => setForm((prev) => ({ ...prev, rrn: e.target.value.replace(/[^\d-]/g, '') }))}
              placeholder="비워두면 그대로"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label>메모</label>
            <input className="input" value={form.memo} onChange={setField('memo')} />
          </div>
          <button type="button" className="btn-primary" onClick={saveWorker} disabled={saving}>
            {saving ? '저장 중...' : '저장'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => setEditing(false)} disabled={saving}>
            취소
          </button>
          <button type="button" className="link-btn link-btn-danger" onClick={deleteWorker} disabled={saving}>
            {confirmDelete ? '정말 지울까요? 한 번 더 누르세요 (근무 기록이 없을 때만 지워져요)' : '명부에서 지우기'}
          </button>
        </div>
      )}
    </div>
  )
}
