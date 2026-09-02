import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'

const WEEKDAY_LABELS = ['월', '화', '수', '목', '금', '토', '일']

function pad2(n) {
  return String(n).padStart(2, '0')
}

// 명세표에 적힌 입고일(invoice_date)을 우선 기준으로 삼고, 없는 옛 데이터만 저장 시각
// (created_at)의 날짜로 대신한다.
function rowDate(row) {
  return row.invoice_date ? new Date(`${row.invoice_date}T00:00:00`) : new Date(row.created_at)
}

// 이번 달을 포함해 최근 12개월의 "YYYY-MM" 목록 (오래된 달 → 최근 달 순)
function last12Months() {
  const now = new Date()
  const months = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`)
  }
  return months
}

export default function ConsumptionPatternScreen() {
  const { store } = useStore()
  const navigate = useNavigate()

  const [monthlyRows, setMonthlyRows] = useState([])
  const [weekdayRows, setWeekdayRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!store) navigate('/', { replace: true })
  }, [store, navigate])

  useEffect(() => {
    if (!store || !supabase) return
    setLoading(true)
    setError('')
    supabase
      .from('invoice_batches')
      .select('total_amount, invoice_date, created_at')
      .eq('store_code', store.code)
      .then(({ data, error: err }) => {
        if (err) {
          setError(err.message)
          setLoading(false)
          return
        }

        const months = last12Months()
        const monthTotals = new Map(months.map((m) => [m, 0]))
        const weekdayTotals = Array.from({ length: 7 }, () => ({ amount: 0, count: 0 }))

        for (const b of data ?? []) {
          const d = rowDate(b)
          const monthKey = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
          if (monthTotals.has(monthKey)) {
            monthTotals.set(monthKey, monthTotals.get(monthKey) + Number(b.total_amount))
          }
          // JS getDay(): 0=일 ~ 6=토 → 월요일이 0번이 되도록 보정
          const weekdayIndex = (d.getDay() + 6) % 7
          weekdayTotals[weekdayIndex].amount += Number(b.total_amount)
          weekdayTotals[weekdayIndex].count += 1
        }

        const maxMonthAmount = Math.max(1, ...monthTotals.values())
        setMonthlyRows(
          [...months]
            .reverse()
            .map((m) => ({ month: m, amount: monthTotals.get(m), pct: (monthTotals.get(m) / maxMonthAmount) * 100 })),
        )

        const maxWeekdayAmount = Math.max(1, ...weekdayTotals.map((w) => w.amount))
        setWeekdayRows(
          weekdayTotals.map((w, i) => ({
            label: WEEKDAY_LABELS[i],
            amount: w.amount,
            count: w.count,
            pct: (w.amount / maxWeekdayAmount) * 100,
          })),
        )

        setLoading(false)
      })
  }, [store])

  if (!store) return null

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/menu')}>
          ← 메인 메뉴
        </button>
        <h1>소비 패턴 분석</h1>
        <p className="subtitle">{store.name} · 입고(구매) 기록으로 보는 지출 흐름</p>
      </div>

      {!supabase && <p className="hint">Supabase가 설정되지 않았습니다.</p>}
      {loading && <p className="hint">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}

      {!loading && !error && supabase && (
        <>
          <h2 className="section-title">월별 입고 총액 추이 (최근 12개월)</h2>
          <ul className="history-list">
            {monthlyRows.map((r) => (
              <li key={r.month} className="history-row">
                <div className="history-row-main">
                  <span className="history-item">{r.month}</span>
                  <span>{Math.round(r.amount).toLocaleString()}원</span>
                </div>
                <div className="spend-bar-track">
                  <div className="spend-bar-fill" style={{ width: `${r.pct}%` }} />
                </div>
              </li>
            ))}
          </ul>

          <h2 className="section-title">요일별 입고 분포 (전체 기간)</h2>
          <p className="hint">어느 요일에 입고가 몰리는지 보여줘요. 실제 재료 사용 시점과는 다를 수 있어요.</p>
          <ul className="history-list">
            {weekdayRows.map((r) => (
              <li key={r.label} className="history-row">
                <div className="history-row-main">
                  <span className="history-item">{r.label}요일</span>
                  <span>
                    {Math.round(r.amount).toLocaleString()}원 · {r.count}건
                  </span>
                </div>
                <div className="spend-bar-track">
                  <div className="spend-bar-fill" style={{ width: `${r.pct}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
