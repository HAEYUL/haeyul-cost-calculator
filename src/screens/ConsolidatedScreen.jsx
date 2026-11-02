import { Fragment, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { supabase } from '../lib/supabaseClient'
import { useHistoryState } from '../hooks/usePageHistoryState'
import {
  aggregate,
  combineByStoreDate,
  formatPercent,
  missingSettlementMonths,
  monthKeyOf,
  periodLabel,
  SALES_FIELDS,
  SETTLEMENT_FIELDS,
  settlementPercent,
  shortPeriodLabel,
} from '../lib/salesSummary'
import { downloadCsv, rowsToCsv } from '../lib/csvExport'
import { channelsFor, hasChannels, MAIN_CHANNEL } from '../data/salesChannels'
import { currentMonth, todayStr } from '../lib/vendorLedger'
import { monthRange, shiftMonthKey } from '../lib/dispatch'

const num = (n) => Math.round(Number(n) || 0).toLocaleString('ko-KR')
const lastMonth = () => shiftMonthKey(currentMonth(), -1)
const thisYear = () => currentMonth().slice(0, 4)

// 기간 빠른 선택
function presetRange(key) {
  const y = Number(thisYear())
  if (key === 'lastMonth') return { from: lastMonth(), to: lastMonth() }
  if (key === 'thisYear') return { from: `${y}-01`, to: currentMonth() }
  if (key === 'lastYear') return { from: `${y - 1}-01`, to: `${y - 1}-12` }
  return null
}

// 통합 매출·결산 (메인 관리자 전용): 4개 매장의 매장운영결산을 기간·월별/년별로 합산하고, 일매출을 직접 입력·합산한다.
export default function ConsolidatedScreen() {
  const [tab, setTab] = useHistoryState('consTab', 'settlement')
  const navigate = useNavigate()
  return (
    <div className="screen screen-wide consolidated-screen">
      <div className="screen-header">
        <button type="button" className="link-btn" onClick={() => navigate('/menu')}>
          ← 메인 메뉴
        </button>
        <h1>📊 통합 매출·결산</h1>
        <p className="subtitle">4개 매장을 합쳐서 봐요 · 메인 관리자만 볼 수 있어요</p>
      </div>
      <div className="preset-row">
        <button type="button" className={tab === 'settlement' ? 'chip chip-active' : 'chip'} onClick={() => setTab('settlement')}>
          통합 결산
        </button>
        <button type="button" className={tab === 'daily' ? 'chip chip-active' : 'chip'} onClick={() => setTab('daily')}>
          일매출
        </button>
      </div>
      {tab === 'settlement' ? <SettlementTab /> : <DailySalesTab />}
    </div>
  )
}

// ---------- 기간·묶음 선택 ----------
function RangePicker({ from, to, setRange, group, setGroup }) {
  return (
    <div className="cost-summary range-picker">
      <div className="preset-row">
        {[
          ['lastMonth', '지난 달'],
          ['thisYear', '올해'],
          ['lastYear', '작년'],
        ].map(([key, label]) => {
          const r = presetRange(key)
          const on = r.from === from && r.to === to
          return (
            <button key={key} type="button" className={on ? 'chip chip-active' : 'chip'} onClick={() => setRange(r)}>
              {label}
            </button>
          )
        })}
      </div>
      <div className="rrn-row">
        <input
          type="month"
          className="input"
          value={from}
          max={to}
          onChange={(e) => e.target.value && setRange({ from: e.target.value, to })}
          aria-label="시작 월"
        />
        <span>~</span>
        <input
          type="month"
          className="input"
          value={to}
          min={from}
          onChange={(e) => e.target.value && setRange({ from, to: e.target.value })}
          aria-label="끝 월"
        />
      </div>
      <div className="preset-row group-row">
        <span className="hint">합산 단위</span>
        <button type="button" className={group === 'month' ? 'chip chip-active' : 'chip'} onClick={() => setGroup('month')}>
          월별
        </button>
        <button type="button" className={group === 'year' ? 'chip chip-active' : 'chip'} onClick={() => setGroup('year')}>
          년별
        </button>
      </div>
    </div>
  )
}

// 매장 × 기간 표 (선택한 항목 하나)
// childRows: Map(매장 코드 → [{ key, name, r }]) — 매장 줄 아래에 구분(POS)별 줄을 덧붙인다.
function PeriodMatrix({ result, stores, field, fieldLabel, onOpenStore, childRows }) {
  const { periods, byStore, grand } = result
  return (
    <div className="ledger-table-wrap">
      <table className="dispatch-table cons-table">
        <thead>
          <tr>
            <th>{fieldLabel}</th>
            {periods.map((p) => (
              <th key={p} className="num">
                {shortPeriodLabel(p)}
              </th>
            ))}
            <th className="num">합계</th>
          </tr>
        </thead>
        <tbody>
          {stores.map((s) => {
            const r = byStore.get(s.code)
            const children = childRows?.get(s.code) ?? []
            return (
              <Fragment key={s.code}>
              <tr>
                <td>
                  {onOpenStore ? (
                    <button type="button" className="link-btn inline-link" onClick={() => onOpenStore(s)}>
                      {s.name}
                    </button>
                  ) : (
                    s.name
                  )}
                </td>
                {periods.map((p) => (
                  <td key={p} className={`num${r.byPeriod.get(p)[field] < 0 ? ' minus' : ''}`}>
                    {num(r.byPeriod.get(p)[field])}
                  </td>
                ))}
                <td className={`num strong${r.totals[field] < 0 ? ' minus' : ''}`}>{num(r.totals[field])}</td>
              </tr>
              {children.map((c) => (
                <tr key={c.key} className="sub-row">
                  <td>└ {c.name}</td>
                  {periods.map((p) => (
                    <td key={p} className="num">
                      {num(c.r.byPeriod.get(p)[field])}
                    </td>
                  ))}
                  <td className="num">{num(c.r.totals[field])}</td>
                </tr>
              ))}
              </Fragment>
            )
          })}
          <tr className="total-row">
            <td>합계</td>
            {periods.map((p) => (
              <td key={p} className={`num${grand.byPeriod.get(p)[field] < 0 ? ' minus' : ''}`}>
                {num(grand.byPeriod.get(p)[field])}
              </td>
            ))}
            <td className={`num strong${grand.totals[field] < 0 ? ' minus' : ''}`}>{num(grand.totals[field])}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// ---------- 통합 결산 ----------
function SettlementTab() {
  const { stores, setStore } = useStore()
  const navigate = useNavigate()
  const [range, setRange] = useHistoryState('consRange', () => ({ from: `${thisYear()}-01`, to: lastMonth() < `${thisYear()}-01` ? currentMonth() : lastMonth() }))
  const [group, setGroup] = useHistoryState('consGroup', 'month')
  const [field, setField] = useHistoryState('consField', 'revenue')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    supabase
      .from('store_settlements')
      .select('store_code, year, month, revenue, ingredient_cost, labor_cost, general_cost, total_expense, operating_profit, pretax_profit')
      .in(
        'store_code',
        stores.map((s) => s.code),
      )
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) setError(err.message)
        else setRows((data ?? []).map((r) => ({ ...r, key: monthKeyOf(r.year, r.month) })))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [stores])

  const storeCodes = useMemo(() => stores.map((s) => s.code), [stores])
  const result = useMemo(
    () => aggregate(rows, { from: range.from, to: range.to, group, fields: SETTLEMENT_FIELDS, storeCodes }),
    [rows, range.from, range.to, group, storeCodes],
  )
  const missing = useMemo(
    () => missingSettlementMonths(rows, { from: range.from, to: range.to, storeCodes }),
    [rows, range.from, range.to, storeCodes],
  )
  const storeName = (code) => stores.find((s) => s.code === code)?.name ?? code
  const fieldLabel = SETTLEMENT_FIELDS.find(([k]) => k === field)?.[1] ?? ''
  const rangeLabel = range.from === range.to ? periodLabel(range.from) : `${periodLabel(range.from)} ~ ${periodLabel(range.to)}`

  const openStore = (s) => {
    setStore(s)
    navigate('/settlement')
  }

  const exportCsv = () => {
    const summary = rowsToCsv(
      [...stores.map((s) => ({ name: s.name, ...result.byStore.get(s.code).totals })), { name: '합계', ...result.grand.totals }],
      [
        { label: '매장', value: 'name' },
        ...SETTLEMENT_FIELDS.flatMap(([k, label]) => [
          { label, value: k },
          {
            label: k === 'revenue' ? '매출 비중(%)' : `${label}(%)`,
            value: (r) => {
              const p = settlementPercent(k, r, result.grand.totals.revenue)
              return p == null ? '' : p.toFixed(1)
            },
          },
        ]),
      ],
    )
    const matrix = rowsToCsv(
      [
        ...stores.map((s) => ({ name: s.name, r: result.byStore.get(s.code) })),
        { name: '합계', r: result.grand },
      ],
      [
        { label: fieldLabel, value: 'name' },
        ...result.periods.map((p) => ({ label: periodLabel(p), value: (x) => x.r.byPeriod.get(p)[field] })),
        { label: '합계', value: (x) => x.r.totals[field] },
      ],
    )
    downloadCsv(`통합결산_${range.from}_${range.to}.csv`, `${rangeLabel} 매장별 합계\n${summary}\n\n${group === 'year' ? '년별' : '월별'} ${fieldLabel}\n${matrix}`)
  }

  return (
    <>
      <RangePicker from={range.from} to={range.to} setRange={setRange} group={group} setGroup={setGroup} />

      {loading && <p className="hint">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}

      {!loading && !error && (
        <>
          <p className="menu-group-title cons-section-title">🏪 매장별 합계 · {rangeLabel}</p>
          <div className="ledger-table-wrap">
            <table className="dispatch-table cons-table">
              <thead>
                <tr>
                  <th>매장</th>
                  {SETTLEMENT_FIELDS.map(([k, label]) => (
                    <th key={k} className="num">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stores.map((s) => {
                  const t = result.byStore.get(s.code).totals
                  return (
                    <tr key={s.code}>
                      <td>
                        <button type="button" className="link-btn inline-link" onClick={() => openStore(s)}>
                          {s.name}
                        </button>
                      </td>
                      {SETTLEMENT_FIELDS.map(([k]) => (
                        <td key={k} className={`num${t[k] < 0 ? ' minus' : ''}`}>
                          {num(t[k])}
                          <span className="pct">{formatPercent(settlementPercent(k, t, result.grand.totals.revenue))}</span>
                        </td>
                      ))}
                    </tr>
                  )
                })}
                <tr className="total-row">
                  <td>합계</td>
                  {SETTLEMENT_FIELDS.map(([k]) => (
                    <td key={k} className={`num strong${result.grand.totals[k] < 0 ? ' minus' : ''}`}>
                      {num(result.grand.totals[k])}
                      <span className="pct">
                        {formatPercent(settlementPercent(k, result.grand.totals, result.grand.totals.revenue))}
                      </span>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="hint">
            % — 총매출: 4개 매장 합계에서 차지하는 비중 · 비용·손익: 그 매장 총매출 대비 (합계 줄은 전체 매출 대비)
          </p>
          <p className="hint">단위: 원 · 매장 이름을 누르면 그 매장의 매장운영결산(입력·사진 올리기) 화면으로 가요.</p>

          <p className="menu-group-title cons-section-title">📅 {group === 'year' ? '년별' : '월별'} 합산</p>
          <div className="preset-row">
            {SETTLEMENT_FIELDS.map(([k, label]) => (
              <button key={k} type="button" className={field === k ? 'chip chip-active' : 'chip'} onClick={() => setField(k)}>
                {label}
              </button>
            ))}
          </div>
          <PeriodMatrix result={result} stores={stores} field={field} fieldLabel={fieldLabel} onOpenStore={openStore} />

          {missing.length > 0 && (
            <div className="price-alert-box">
              <p className="price-alert-title">⚠️ 결산이 입력되지 않은 달 ({missing.length}개)</p>
              <p className="hint">
                {stores
                  .map((s) => {
                    const ms = missing.filter((m) => m.storeCode === s.code).map((m) => (range.from.slice(0, 4) === range.to.slice(0, 4) ? shortPeriodLabel(m.month) : periodLabel(m.month)))
                    return ms.length ? `${storeName(s.code)}: ${ms.join(', ')}` : null
                  })
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <p className="hint">입력하지 않은 달은 0원으로 합산돼요.</p>
            </div>
          )}

          <button type="button" className="btn-secondary" onClick={exportCsv}>
            📥 엑셀(CSV) 내려받기
          </button>
        </>
      )}
    </>
  )
}

// ---------- 일매출 ----------
// 매장에 POS가 여러 대면(해율만두전골: 1층 매장 / 2,3층 매장) 구분별로 입력하고, 매장 매출은 합산해서 보여준다.
const EMPTY_PART = { total: '', card: '', cash: '', other: '', guests: '' }
const digits = (v) => String(v ?? '').replace(/\D/g, '')
const fmtInput = (v) => (v === '' ? '' : Number(v).toLocaleString('ko-KR'))
const partFromRow = (r) =>
  r
    ? {
        total: String(r.total_amount ?? ''),
        card: r.card_amount == null ? '' : String(r.card_amount),
        cash: r.cash_amount == null ? '' : String(r.cash_amount),
        other: r.other_amount == null ? '' : String(r.other_amount),
        guests: r.guest_count == null ? '' : String(r.guest_count),
      }
    : { ...EMPTY_PART }
const partSum = (p) => ['card', 'cash', 'other'].reduce((sum, k) => sum + Number(p[k] || 0), 0)
const partTotal = (p) => (p.total === '' ? partSum(p) : Number(p.total))
const partEmpty = (p) => Object.values(p).every((v) => v === '')
const perGuest = (amount, guests) => (guests ? num(amount / guests) : '-')

function DailySalesTab() {
  const { stores } = useStore()
  const [mode, setMode] = useHistoryState('salesMode', 'day')
  const [month, setMonth] = useHistoryState('salesMonth', () => currentMonth())
  const [range, setRange] = useHistoryState('salesRange', () => ({ from: `${thisYear()}-01`, to: currentMonth() }))
  const [field, setField] = useHistoryState('salesField', 'total_amount')
  const [showChannels, setShowChannels] = useHistoryState('salesShowChannels', false)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const [formOpen, setFormOpen] = useState(false)
  const [formDate, setFormDate] = useState(todayStr())
  const [formStore, setFormStore] = useState(stores[0]?.code)
  const [parts, setParts] = useState({})
  const [memo, setMemo] = useState('')
  const [saving, setSaving] = useState(false)

  const storeCodes = useMemo(() => stores.map((s) => s.code), [stores])
  const group = mode === 'year' ? 'year' : 'month'
  const from = mode === 'day' ? month : range.from
  const to = mode === 'day' ? month : range.to

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    setLoading(true)
    const start = monthRange(from).start
    const end = monthRange(to).end
    supabase
      .from('sales_daily')
      .select('store_code, sale_date, channel, total_amount, card_amount, cash_amount, other_amount, guest_count, memo, source')
      .in('store_code', storeCodes)
      .gte('sale_date', start)
      .lt('sale_date', end)
      .limit(10000)
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) {
          if (/channel/.test(err.message)) setError('일매출 구분 칸이 아직 없어요. Supabase에서 supabase/sales-channels.sql을 실행해주세요.')
          else setError(/sales_daily/.test(err.message) ? '일매출 표가 아직 없어요. Supabase에서 supabase/sales.sql을 실행해주세요.' : err.message)
        } else {
          setError('')
          setRows((data ?? []).map((r) => ({ ...r, channel: r.channel ?? MAIN_CHANNEL, key: r.sale_date })))
        }
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [storeCodes, from, to, reloadKey])

  const result = useMemo(() => aggregate(rows, { from, to, group, fields: SALES_FIELDS, storeCodes }), [rows, from, to, group, storeCodes])
  const combined = useMemo(() => combineByStoreDate(rows), [rows])
  // 구분이 있는 매장의 구분별 합계 (월별/년별 표의 └ 줄, 객단가)
  const channelResult = useMemo(() => {
    const multi = stores.filter((s) => hasChannels(s.code))
    if (multi.length === 0) return null
    const codes = multi.flatMap((s) => channelsFor(s.code).map((c) => `${s.code}:${c.code}`))
    const mapped = rows.filter((r) => hasChannels(r.store_code)).map((r) => ({ ...r, store_code: `${r.store_code}:${r.channel}` }))
    return aggregate(mapped, { from, to, group, fields: SALES_FIELDS, storeCodes: codes })
  }, [rows, stores, from, to, group])
  const childRows = useMemo(() => {
    if (!channelResult) return null
    const m = new Map()
    for (const s of stores) {
      if (!hasChannels(s.code)) continue
      m.set(
        s.code,
        channelsFor(s.code).map((c) => ({ key: `${s.code}:${c.code}`, name: c.label, r: channelResult.byStore.get(`${s.code}:${c.code}`) })),
      )
    }
    return m
  }, [channelResult, stores])
  const fieldLabel = SALES_FIELDS.find(([k]) => k === field)?.[1] ?? ''

  // 입력 칸: 고른 매장·날짜의 구분별 값을 불러온다
  const loadForm = (storeCode, date) => {
    const c = combined.get(`${storeCode}|${date}`)
    const next = {}
    for (const ch of channelsFor(storeCode)) next[ch.code] = partFromRow(c?.channels.get(ch.code))
    setFormStore(storeCode)
    setFormDate(date)
    setParts(next)
    setMemo([...(c?.channels.values() ?? [])].map((r) => r.memo).find(Boolean) ?? '')
    setFormOpen(true)
    setMessage('')
  }

  const formChannels = channelsFor(formStore)
  const existing = combined.get(`${formStore}|${formDate}`)
  const formTotal = formChannels.reduce((sum, ch) => sum + partTotal(parts[ch.code] ?? EMPTY_PART), 0)
  const setPart = (code, key, value) => setParts((prev) => ({ ...prev, [code]: { ...(prev[code] ?? EMPTY_PART), [key]: value } }))

  const save = async () => {
    setError('')
    setMessage('')
    if (!formDate || !formStore) return setError('날짜와 매장을 고르세요.')
    const filled = formChannels.filter((ch) => !partEmpty(parts[ch.code] ?? EMPTY_PART))
    if (filled.length === 0) return setError('매출을 입력하세요.')
    const toNum = (v) => (v === '' ? null : Number(v))
    const upserts = filled.map((ch) => {
      const p = parts[ch.code]
      return {
        store_code: formStore,
        sale_date: formDate,
        channel: ch.code,
        total_amount: partTotal(p),
        card_amount: toNum(p.card),
        cash_amount: toNum(p.cash),
        other_amount: toNum(p.other),
        guest_count: toNum(p.guests),
        memo: memo.trim() || null,
        source: 'manual',
        updated_at: new Date().toISOString(),
      }
    })
    // 비운 구분은 저장된 기록이 있으면 지운다
    const cleared = formChannels.filter((ch) => partEmpty(parts[ch.code] ?? EMPTY_PART) && existing?.channels.has(ch.code)).map((ch) => ch.code)
    setSaving(true)
    const { error: err } = await supabase.from('sales_daily').upsert(upserts, { onConflict: 'store_code,sale_date,channel' })
    if (!err && cleared.length) {
      const { error: delErr } = await supabase.from('sales_daily').delete().eq('store_code', formStore).eq('sale_date', formDate).in('channel', cleared)
      if (delErr) setError(delErr.message)
    }
    setSaving(false)
    if (err) return setError(err.message)
    const name = stores.find((s) => s.code === formStore)?.name
    setMessage(`${name} ${formDate} 매출 ${num(formTotal)}원을 저장했어요.`)
    setReloadKey((k) => k + 1)
  }

  const remove = async () => {
    if (!existing || !window.confirm('이 날 매출 기록을 모두 지울까요?')) return
    setSaving(true)
    const { error: err } = await supabase.from('sales_daily').delete().eq('store_code', formStore).eq('sale_date', formDate)
    setSaving(false)
    if (err) return setError(err.message)
    setParts(Object.fromEntries(formChannels.map((ch) => [ch.code, { ...EMPTY_PART }])))
    setMessage('지웠어요.')
    setReloadKey((k) => k + 1)
  }

  const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()
  const dates = Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
  const dayTotal = (date) => stores.reduce((sum, s) => sum + Number(combined.get(`${s.code}|${date}`)?.total_amount || 0), 0)
  const enteredDays = new Set(rows.map((r) => r.sale_date)).size
  const weekday = (date) => '일월화수목금토'[new Date(date).getDay()]
  // 일별 표의 칸: 매장 합계, [층별로 보기]면 구분 칸도
  const dayColumns = stores.flatMap((s) => {
    const base = [{ key: s.code, label: s.name, store: s.code, channel: null }]
    if (!showChannels || !hasChannels(s.code)) return base
    return [...channelsFor(s.code).map((c) => ({ key: `${s.code}:${c.code}`, label: `${s.name} ${c.label}`, store: s.code, channel: c.code, sub: true })), ...base.map((b) => ({ ...b, label: `${s.name} 합계` }))]
  })
  const cellAmount = (col, date) => {
    const c = combined.get(`${col.store}|${date}`)
    if (!c) return null
    return col.channel ? (c.channels.get(col.channel)?.total_amount ?? null) : c.total_amount
  }

  const exportCsv = () => {
    if (mode === 'day') {
      const cols = stores.flatMap((s) =>
        hasChannels(s.code)
          ? [...channelsFor(s.code).map((c) => ({ store: s.code, channel: c.code, label: `${s.name} ${c.label}` })), { store: s.code, channel: null, label: `${s.name} 합계` }]
          : [{ store: s.code, channel: null, label: s.name }],
      )
      const csv = rowsToCsv(
        dates.map((d) => ({ d })),
        [{ label: '날짜', value: 'd' }, ...cols.map((col) => ({ label: col.label, value: (x) => cellAmount(col, x.d) ?? '' })), { label: '합계', value: (x) => dayTotal(x.d) }],
      )
      downloadCsv(`일매출_${month}.csv`, csv)
    } else {
      const lines = stores.flatMap((s) => [
        { name: s.name, r: result.byStore.get(s.code) },
        ...(childRows?.get(s.code) ?? []).map((c) => ({ name: `${s.name} ${c.name}`, r: c.r })),
      ])
      const csv = rowsToCsv([...lines, { name: '합계', r: result.grand }], [
        { label: fieldLabel, value: 'name' },
        ...result.periods.map((p) => ({ label: periodLabel(p), value: (x) => x.r.byPeriod.get(p)[field] })),
        { label: '합계', value: (x) => x.r.totals[field] },
      ])
      downloadCsv(`매출합산_${from}_${to}.csv`, csv)
    }
  }

  const multiStores = stores.filter((s) => hasChannels(s.code))

  return (
    <>
      <div className="price-alert-box okpos-note">
        <p className="hint">🔌 OKPOS 연결 전이에요. 지금은 직접 입력하고, 연결되면 매일 자동으로 채워져요.</p>
      </div>

      <button type="button" className="btn-primary" onClick={() => (formOpen ? setFormOpen(false) : loadForm(formStore, formDate))}>
        {formOpen ? '입력 칸 닫기' : '✏️ 일매출 입력'}
      </button>

      {formOpen && (
        <div className="cost-summary invoice-form">
          <div className="rrn-row">
            <input type="date" className="input sales-date" value={formDate} onChange={(e) => loadForm(formStore, e.target.value)} aria-label="날짜" />
            <select className="select sales-store" value={formStore} onChange={(e) => loadForm(e.target.value, formDate)} aria-label="매장">
              {stores.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          {existing && <p className="hint">이미 입력된 날이에요. 고쳐서 저장하면 바뀌어요.</p>}

          {formChannels.map((ch) => {
            const p = parts[ch.code] ?? EMPTY_PART
            return (
              <div key={ch.code} className={ch.label ? 'sales-channel-block' : ''}>
                {ch.label && (
                  <p className="sales-channel-title">
                    {ch.label}
                    {!partEmpty(p) && <span className="hint"> · {num(partTotal(p))}원</span>}
                  </p>
                )}
                <div className="field">
                  <label>총매출 (원)</label>
                  <input
                    className="input"
                    inputMode="numeric"
                    value={fmtInput(p.total)}
                    onChange={(e) => setPart(ch.code, 'total', digits(e.target.value))}
                    placeholder={partSum(p) ? `비우면 카드+현금+기타 = ${num(partSum(p))}원` : 'POS 일마감 총매출'}
                  />
                </div>
                <div className="sales-parts">
                  {[
                    ['card', '카드'],
                    ['cash', '현금'],
                    ['other', '기타'],
                  ].map(([k, label]) => (
                    <div className="field" key={k}>
                      <label>{label}</label>
                      <input className="input" inputMode="numeric" value={fmtInput(p[k])} onChange={(e) => setPart(ch.code, k, digits(e.target.value))} />
                    </div>
                  ))}
                  <div className="field">
                    <label>객수</label>
                    <input className="input" inputMode="numeric" value={p.guests} onChange={(e) => setPart(ch.code, 'guests', digits(e.target.value))} />
                  </div>
                </div>
              </div>
            )
          })}

          {formChannels.length > 1 && (
            <div className="cost-summary-row sales-form-total">
              <span>{stores.find((s) => s.code === formStore)?.name} 합계</span>
              <strong>
                {num(formTotal)}원
                {formTotal > 0 && (
                  <span className="hint">
                    {' '}
                    ({formChannels.map((ch) => `${ch.label} ${((partTotal(parts[ch.code] ?? EMPTY_PART) / formTotal) * 100).toFixed(1)}%`).join(' · ')})
                  </span>
                )}
              </strong>
            </div>
          )}

          <div className="field">
            <label>메모 (선택)</label>
            <input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} />
          </div>
          <button type="button" className="btn-primary" onClick={save} disabled={saving}>
            {saving ? '저장 중...' : '저장'}
          </button>
          {existing && (
            <button type="button" className="link-btn link-btn-danger" onClick={remove} disabled={saving}>
              이 날 기록 지우기
            </button>
          )}
        </div>
      )}

      <div className="preset-row" style={{ marginTop: 14 }}>
        {[
          ['day', '일별'],
          ['month', '월별 합산'],
          ['year', '년별 합산'],
        ].map(([key, label]) => (
          <button key={key} type="button" className={mode === key ? 'chip chip-active' : 'chip'} onClick={() => setMode(key)}>
            {label}
          </button>
        ))}
      </div>

      {mode === 'day' ? (
        <div className="month-nav">
          <button type="button" className="chip" onClick={() => setMonth(shiftMonthKey(month, -1))} aria-label="이전 달">
            ◀
          </button>
          <strong>{periodLabel(month)}</strong>
          <button type="button" className="chip" onClick={() => setMonth(shiftMonthKey(month, 1))} aria-label="다음 달">
            ▶
          </button>
        </div>
      ) : (
        <RangePicker from={range.from} to={range.to} setRange={setRange} group={group} setGroup={(g) => setMode(g === 'year' ? 'year' : 'month')} />
      )}

      {loading && <p className="hint">불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}
      {message && <p className="success-text">{message}</p>}

      {!loading && !error && mode === 'day' && (
        <>
          {multiStores.length > 0 && (
            <label className="toggle-row channel-toggle">
              <input type="checkbox" checked={showChannels} onChange={(e) => setShowChannels(e.target.checked)} />
              <span>층별로 보기 ({multiStores.map((s) => `${s.name}: ${channelsFor(s.code).map((c) => c.label).join(' / ')}`).join(', ')})</span>
            </label>
          )}
          <div className="ledger-table-wrap">
            <table className="dispatch-table cons-table">
              <thead>
                <tr>
                  <th>날짜</th>
                  {dayColumns.map((col) => (
                    <th key={col.key} className={`num${col.sub ? ' sub-col' : ''}`}>
                      {col.label}
                    </th>
                  ))}
                  <th className="num">합계</th>
                </tr>
              </thead>
              <tbody>
                {dates.map((d) => (
                  <tr key={d} className={weekday(d) === '일' ? 'sunday' : weekday(d) === '토' ? 'saturday' : ''}>
                    <td>
                      {Number(d.slice(8))}일 ({weekday(d)})
                    </td>
                    {dayColumns.map((col) => {
                      const amount = cellAmount(col, d)
                      const c = combined.get(`${col.store}|${d}`)
                      const missing = !col.channel && hasChannels(col.store) && c ? channelsFor(col.store).filter((ch) => !c.channels.has(ch.code)) : []
                      return (
                        <td
                          key={col.key}
                          className={`num clickable-cell${col.sub ? ' sub-col' : ''}`}
                          onClick={() => loadForm(col.store, d)}
                          title="눌러서 입력·수정"
                        >
                          {amount != null ? num(amount) : <span className="hint">-</span>}
                          {!showChannels && !col.channel && hasChannels(col.store) && c && (
                            <span className="channel-breakdown">
                              {channelsFor(col.store)
                                .map((ch) => (c.channels.has(ch.code) ? `${ch.label.replace(' 매장', '')} ${num(c.channels.get(ch.code).total_amount)}` : `${ch.label.replace(' 매장', '')} 미입력`))
                                .join(' · ')}
                            </span>
                          )}
                          {showChannels && missing.length > 0 && <span className="channel-breakdown pending-text">{missing.map((m) => m.label).join('·')} 미입력</span>}
                        </td>
                      )
                    })}
                    <td className="num strong">{dayTotal(d) ? num(dayTotal(d)) : ''}</td>
                  </tr>
                ))}
                <tr className="total-row">
                  <td>합계</td>
                  {dayColumns.map((col) => (
                    <td key={col.key} className={`num strong${col.sub ? ' sub-col' : ''}`}>
                      {num(
                        col.channel
                          ? channelResult?.byStore.get(`${col.store}:${col.channel}`)?.totals.total_amount
                          : result.byStore.get(col.store).totals.total_amount,
                      )}
                    </td>
                  ))}
                  <td className="num strong">{num(result.grand.totals.total_amount)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="cost-summary">
            <div className="cost-summary-row">
              <span>{periodLabel(month)} 합계</span>
              <strong>{num(result.grand.totals.total_amount)}원</strong>
            </div>
            <div className="cost-summary-row">
              <span>입력한 날 · 일평균</span>
              <span>
                {enteredDays}일 · {enteredDays ? num(result.grand.totals.total_amount / enteredDays) : 0}원
              </span>
            </div>
            <div className="cost-summary-row">
              <span>카드 / 현금 / 기타</span>
              <span>
                {num(result.grand.totals.card_amount)} / {num(result.grand.totals.cash_amount)} / {num(result.grand.totals.other_amount)}
              </span>
            </div>
            {result.grand.totals.guest_count > 0 && (
              <div className="cost-summary-row">
                <span>객수 · 객단가 (전체)</span>
                <span>
                  {num(result.grand.totals.guest_count)}명 · {perGuest(result.grand.totals.total_amount, result.grand.totals.guest_count)}원
                </span>
              </div>
            )}
            {multiStores.map((s) => {
              const t = result.byStore.get(s.code).totals
              if (!t.total_amount) return null
              return (
                <div key={s.code} className="channel-summary">
                  <p className="source-sum-title">{s.name}</p>
                  {channelsFor(s.code).map((c) => {
                    const ct = channelResult?.byStore.get(`${s.code}:${c.code}`)?.totals
                    if (!ct) return null
                    return (
                      <div key={c.code} className="cost-summary-row position-sum-row">
                        <span>
                          {c.label} ({t.total_amount ? ((ct.total_amount / t.total_amount) * 100).toFixed(1) : 0}%)
                        </span>
                        <span>
                          {num(ct.total_amount)}원 · 객수 {num(ct.guest_count)} · 객단가 {perGuest(ct.total_amount, ct.guest_count)}원
                        </span>
                      </div>
                    )
                  })}
                </div>
              )
            })}
            <p className="hint">표의 칸을 누르면 그 매장·날짜 매출을 입력하거나 고칠 수 있어요.</p>
          </div>
        </>
      )}

      {!loading && !error && mode !== 'day' && (
        <>
          <div className="preset-row">
            {SALES_FIELDS.map(([k, label]) => (
              <button key={k} type="button" className={field === k ? 'chip chip-active' : 'chip'} onClick={() => setField(k)}>
                {label}
              </button>
            ))}
          </div>
          <PeriodMatrix result={result} stores={stores} field={field} fieldLabel={fieldLabel} childRows={childRows} />
        </>
      )}

      {!loading && !error && (
        <button type="button" className="btn-secondary" onClick={exportCsv}>
          📥 엑셀(CSV) 내려받기
        </button>
      )}
    </>
  )
}
