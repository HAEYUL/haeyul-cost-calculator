import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { todayStr } from '../lib/vendorLedger'
import { fetchNotices } from '../lib/notices'
import { loadStoreSummary, nextReportDeadline, wonFull } from '../lib/storeSummary'
import { STORE_INFO, storeColor } from '../data/stores'
import Icon from './Icon'
import KpiBand from './KpiBand'

const QUICK = [
  ['receipt', '입고 입력', '/invoices'],
  ['store', '거래처 관리', '/vendors'],
  ['send', '파출비 송금', '/dispatch-payments'],
  ['sum', '통합 결산', '/consolidated'],
  ['trend', '단가 추이', '/price-trend'],
  ['user', '파출 관리', '/dispatch'],
  ['mega', '전달사항', '/notices'],
  ['print', '세무 출력', '/dispatch-report'],
]

// 메인 관리자 메인 화면: 4개 매장 핵심 숫자(네이비 띠) · 매장 카드 · 바로가기 · 오늘 확인할 일
export default function AdminOverview({ stores, onOpenStore }) {
  const navigate = useNavigate()
  const [summaries, setSummaries] = useState(null)
  const [noticeInfo, setNoticeInfo] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    const today = todayStr()
    Promise.all(stores.map((s) => loadStoreSummary(s.code, today)))
      .then((rows) => !cancelled && setSummaries(new Map(stores.map((s, i) => [s.code, rows[i]]))))
      .catch((err) => !cancelled && setError(err.message))
    fetchNotices({ storeCodes: stores.map((st) => st.code), sinceDays: 30 })
      .then((rows) => {
        if (cancelled) return
        const weekAgo = Date.now() - 7 * 86400000
        setNoticeInfo({
          pending: rows.filter((n) => !n.confirmed_at).length,
          replies: rows.filter((n) => n.reply && new Date(n.replied_at).getTime() > weekAgo).length,
        })
      })
      .catch(() => !cancelled && setNoticeInfo(null))
    return () => {
      cancelled = true
    }
  }, [stores])

  if (error) return <p className="error-text">{error}</p>
  if (!summaries) return <p className="hint">4개 매장 현황을 불러오는 중...</p>

  const all = [...summaries.values()]
  const sum = (k) => all.reduce((acc, r) => acc + r[k], 0)
  const todayStores = all.filter((r) => r.todayCount > 0).length
  const unpaidStores = all.filter((r) => r.unpaidAmount > 0).length
  const longWorkers = sum('longWorkers')

  const kpis = [
    { icon: 'receipt', label: '오늘 입고 합계', value: wonFull(sum('todayAmount')), unit: '원', sub: `명세표 ${sum('todayCount')}건 · ${todayStores}개 매장`, to: '/invoices' },
    { icon: 'hand', label: '거래처 미지급 합계', value: wonFull(sum('balance')), unit: '원', sub: `${stores.length}개 매장 장부 기준`, tone: 'neg', to: '/vendors' },
    { icon: 'send', label: '파출 송금 대기', value: wonFull(sum('unpaidAmount')), unit: '원', sub: `${sum('unpaidWorkers')}명 · ${unpaidStores}개 매장`, tone: 'gold', to: '/dispatch-payments' },
    { icon: 'mega', label: '미확인 전달사항', value: noticeInfo ? noticeInfo.pending : '-', unit: '건', sub: noticeInfo ? `새 답장 ${noticeInfo.replies}건` : '', to: '/notices' },
  ]

  const todos = [
    { tag: '송금', kind: 'gold', text: '파출비 송금 대기', value: sum('unpaidAmount') ? `${sum('unpaidWorkers')}명 · ${wonFull(sum('unpaidAmount'))}원` : '없음', to: '/dispatch-payments' },
    { tag: '전달', kind: 'navy', text: '미확인 전달사항', value: noticeInfo ? `${noticeInfo.pending}건 · 새 답장 ${noticeInfo.replies}` : '-', to: '/notices' },
    { tag: '보험', kind: 'red', text: '이번 달 8일 이상 근무자', value: longWorkers ? `${longWorkers}명` : '없음', to: '/dispatch' },
    { tag: '신고', kind: 'green', text: '근로내용확인신고', value: nextReportDeadline(), to: '/dispatch-report' },
  ]

  return (
    <div className="overview">
      <KpiBand items={kpis} onOpen={navigate} />

      <div className="store-cards">
        {stores.map((s) => {
          const r = summaries.get(s.code)
          return (
            <button type="button" key={s.code} className="store-card" style={{ '--c': storeColor(s.code) }} onClick={() => onOpenStore(s)}>
              <div className="store-card-hd">
                <b>{s.name}</b>
                <small>{STORE_INFO[s.code] ?? ''}</small>
              </div>
              <div className="store-card-bd">
                <div className="kv">
                  <span>오늘 명세표</span>
                  <b className={r.todayCount ? '' : 'muted'}>{r.todayCount ? `${r.todayCount}건 · ${wonFull(r.todayAmount)}` : '0건'}</b>
                </div>
                <div className="kv">
                  <span>파출 송금 대기</span>
                  <b className={r.unpaidAmount ? 'tone-gold' : 'muted'}>{r.unpaidAmount ? `${r.unpaidWorkers}명 · ${wonFull(r.unpaidAmount)}` : '없음'}</b>
                </div>
                <div className="kv">
                  <span>거래처 미지급</span>
                  <b className={r.balance > 0 ? 'tone-neg' : ''}>{wonFull(r.balance)}</b>
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <div className="overview-lower">
        <div className="panel">
          <h3 className="panel-title">
            <Icon name="home" /> 바로가기
          </h3>
          <div className="quick-tiles">
            {QUICK.map(([icon, label, to]) => (
              <button type="button" key={to} className="quick-tile" onClick={() => navigate(to)}>
                <span className="quick-ib">
                  <Icon name={icon} size={20} />
                </span>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="panel">
          <h3 className="panel-title">
            <Icon name="bell" /> 오늘 확인할 일
          </h3>
          {todos.map((t) => (
            <button type="button" key={t.tag} className="todo-row" onClick={() => navigate(t.to)}>
              <span className={`todo-tag todo-${t.kind}`}>{t.tag}</span>
              <span className="todo-text">{t.text}</span>
              <em className={t.kind === 'gold' ? 'tone-gold' : t.kind === 'red' && longWorkers ? 'tone-neg' : ''}>{t.value}</em>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
