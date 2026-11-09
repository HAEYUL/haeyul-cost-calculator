import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { todayStr } from '../lib/vendorLedger'
import { fetchNotices } from '../lib/notices'
import { loadStoreSummary, wonFull } from '../lib/storeSummary'
import StoreBoard from './StoreBoard'
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

// 메인 관리자 메인 화면: 전체 매장 핵심 숫자(네이비 띠) · 오늘의 매장 현황(매장별 한 줄 + 신호등) · 바로가기
// onGo(store, path): 그 매장을 고른 뒤 화면으로 이동
export default function AdminOverview({ stores, onGo }) {
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

  const kpis = [
    { icon: 'receipt', label: '오늘 입고 합계', value: wonFull(sum('todayAmount')), unit: '원', sub: `명세표 ${sum('todayCount')}건 · ${todayStores}개 매장`, to: '/invoices' },
    { icon: 'hand', label: '거래처 미지급 합계', value: wonFull(sum('balance')), unit: '원', sub: `${stores.length}개 매장 장부 기준`, tone: 'neg', to: '/vendors' },
    { icon: 'send', label: '파출 송금 대기', value: wonFull(sum('unpaidAmount')), unit: '원', sub: `${sum('unpaidWorkers')}명 · ${unpaidStores}개 매장`, tone: 'gold', to: '/dispatch-payments' },
    { icon: 'mega', label: '미확인 전달사항', value: noticeInfo ? noticeInfo.pending : '-', unit: '건', sub: noticeInfo ? `새 답장 ${noticeInfo.replies}건` : '', to: '/notices' },
  ]

  return (
    <div className="overview">
      <KpiBand items={kpis} onOpen={navigate} />

      <StoreBoard stores={stores} summaries={summaries} onGo={onGo} />

      <div className="overview-lower overview-lower-single">
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
      </div>
    </div>
  )
}
