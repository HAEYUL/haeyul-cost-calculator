import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { loadStaffStatus } from '../../lib/staffStatus'

function shortDate(d) {
  return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
}

// 홈 화면 근무 기록 알림.
// - 매니저: 오늘 근무를 아직 저장 안 했으면 "오늘 근무 기록 전이에요" + 이번 달 미기록 날
// - 메인 관리자(선택한 매장): 이번 달 어제까지 기록 안 된 날
// 직원 명부가 없는 매장, 마감한 달, 기록이 다 된 경우에는 아무것도 그리지 않는다.
export default function StaffStatusCard({ storeCode, mode = 'manager' }) {
  const navigate = useNavigate()
  const [status, setStatus] = useState(null)

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    setStatus(null)
    loadStaffStatus(storeCode)
      .then((s) => !cancelled && setStatus(s))
      .catch(() => !cancelled && setStatus(null))
    return () => {
      cancelled = true
    }
  }, [storeCode])

  if (!status) return null
  const showToday = mode === 'manager' && !status.todayRecorded
  if (!showToday && status.missing.length === 0) return null

  const missingText =
    status.missing.length > 0
      ? `이번 달 기록 안 된 날 ${status.missing.length}일: ${status.missing.slice(-6).map(shortDate).join(', ')}${status.missing.length > 6 ? ' …' : ''}`
      : ''

  const card = (
    <div className="cost-summary dashboard-card" onClick={() => navigate('/staff-schedule')}>
      <p className="price-alert-title">{showToday ? '📋 오늘 근무 기록 전이에요' : `📋 근무 기록 안 된 날 ${status.missing.length}일`}</p>
      {showToday && <p className="hint">근무한 직원·파출을 체크하고 저장해 주세요 →</p>}
      {missingText && <p className={showToday ? 'hint' : 'cost-warning'}>{missingText}</p>}
    </div>
  )
  return mode === 'manager' ? <div className="dashboard manager-reorder">{card}</div> : card
}
