import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'

function pad2(n) {
  return String(n).padStart(2, '0')
}

function lastMonthKey() {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}

function thisYearRange() {
  const y = new Date().getFullYear()
  return { from: `${y}-01`, to: `${y}-12` }
}

const PRESETS = [
  { key: 'lastMonth', label: '지난 달' },
  { key: 'thisYear', label: '올해' },
  { key: 'custom', label: '기간 선택' },
]

const FIELDS = [
  ['revenue', '총 매출액'],
  ['ingredient_cost', '총 식재료비'],
  ['labor_cost', '인건비'],
  ['general_cost', '일반경비'],
  ['total_expense', '지출총합계'],
  ['operating_profit', '영업손익'],
  ['pretax_profit', '소득세차감전이익'],
]

function fmt(n) {
  return `${Math.round(Number(n ?? 0)).toLocaleString('ko-KR')}원`
}

function monthKeyOf(row) {
  return `${row.year}-${pad2(row.month)}`
}

function SettlementRows({ row }) {
  return (
    <>
      {FIELDS.map(([key, label]) => (
        <div className="cost-summary-row" key={key}>
          <span>{label}</span>
          <strong className={(key === 'operating_profit' || key === 'pretax_profit') && row[key] < 0 ? 'alert-up' : ''}>
            {fmt(row[key])}
          </strong>
        </div>
      ))}
    </>
  )
}

export default function SettlementScreen() {
  const { store } = useStore()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [settlements, setSettlements] = useState([])

  const [preset, setPreset] = useState('lastMonth')
  const [fromMonth, setFromMonth] = useState(lastMonthKey())
  const [toMonth, setToMonth] = useState(lastMonthKey())

  useEffect(() => {
    if (!store) navigate('/', { replace: true })
  }, [store, navigate])

  useEffect(() => {
    if (!store || !supabase) return
    setLoading(true)
    setError('')
    supabase
      .from('store_settlements')
      .select('year, month, revenue, ingredient_cost, labor_cost, general_cost, total_expense, operating_profit, pretax_profit')
      .eq('store_code', store.code)
      .then(({ data, error: err }) => {
        if (err) {
          setError(err.message)
          setLoading(false)
          return
        }
        setSettlements(data ?? [])
        setLoading(false)
      })
  }, [store])

  const applyPreset = (key) => {
    setPreset(key)
    if (key === 'lastMonth') {
      const m = lastMonthKey()
      setFromMonth(m)
      setToMonth(m)
    } else if (key === 'thisYear') {
      const { from, to } = thisYearRange()
      setFromMonth(from)
      setToMonth(to)
    }
  }

  const filteredRows = useMemo(() => {
    return settlements
      .filter((r) => monthKeyOf(r) >= fromMonth && monthKeyOf(r) <= toMonth)
      .sort((a, b) => (monthKeyOf(a) < monthKeyOf(b) ? 1 : -1))
  }, [settlements, fromMonth, toMonth])

  const totals = useMemo(() => {
    if (filteredRows.length === 0) return null
    const sum = (key) => filteredRows.reduce((acc, r) => acc + Number(r[key] ?? 0), 0)
    return Object.fromEntries(FIELDS.map(([key]) => [key, sum(key)]))
  }, [filteredRows])

  if (!store) return null

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/menu')}>
          ← 메인 메뉴
        </button>
        <h1>매장운영결산</h1>
        <p className="subtitle">{store.name} · 월별 매출·비용·손익을 확인해요</p>
      </div>

      {!supabase && <p className="hint">Supabase가 설정되지 않았습니다.</p>}
      {loading && <p className="hint">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}

      {!loading && supabase && (
        <>
          <div className="preset-row">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                className={preset === p.key ? 'chip chip-active' : 'chip'}
                onClick={() => applyPreset(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="date-range">
            <input
              type="month"
              className="input"
              value={fromMonth}
              onChange={(e) => {
                setFromMonth(e.target.value)
                setPreset('custom')
              }}
              aria-label="시작월"
            />
            <span className="date-range-sep">~</span>
            <input
              type="month"
              className="input"
              value={toMonth}
              onChange={(e) => {
                setToMonth(e.target.value)
                setPreset('custom')
              }}
              aria-label="종료월"
            />
          </div>

          {filteredRows.length === 0 && <p className="hint">이 기간에 저장된 결산이 없습니다.</p>}

          {filteredRows.map((row) => (
            <div className="cost-summary" key={monthKeyOf(row)}>
              <h2 className="settlement-month-title">
                {row.year}년 {row.month}월
              </h2>
              <SettlementRows row={row} />
            </div>
          ))}

          {totals && (
            <div className="cost-summary settlement-total">
              <h2 className="settlement-month-title">선택 기간 합계 ({filteredRows.length}개월)</h2>
              <SettlementRows row={totals} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
