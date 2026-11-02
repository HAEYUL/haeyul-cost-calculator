import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { loadStoreSummary, wonFull } from '../lib/storeSummary'
import KpiBand from './KpiBand'

// 매니저 메인 화면: 내 매장 핵심 숫자 (네이비 띠)
export default function ManagerOverview({ storeCode }) {
  const navigate = useNavigate()
  const [r, setR] = useState(null)

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    loadStoreSummary(storeCode)
      .then((x) => !cancelled && setR(x))
      .catch(() => !cancelled && setR(null))
    return () => {
      cancelled = true
    }
  }, [storeCode])

  if (!r) return null
  return (
    <KpiBand
      onOpen={navigate}
      items={[
        { icon: 'receipt', label: '오늘 입고', value: wonFull(r.todayAmount), unit: '원', sub: `명세표 ${r.todayCount}건`, to: '/invoices' },
        { icon: 'hand', label: '거래처 미지급', value: wonFull(r.balance), unit: '원', sub: '장부 기준', tone: 'neg', to: '/vendors' },
        { icon: 'send', label: '파출 송금 대기', value: wonFull(r.unpaidAmount), unit: '원', sub: `${r.unpaidWorkers}명`, tone: 'gold', to: '/dispatch' },
        { icon: 'user', label: '이번 달 파출 근무', value: r.monthShiftDays, unit: '일', sub: r.longWorkers ? `8일 이상 ${r.longWorkers}명` : '인원별 근무일 합계', to: '/dispatch' },
      ]}
    />
  )
}
