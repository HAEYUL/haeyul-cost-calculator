import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { todayStr } from '../lib/vendorLedger'
import { shortWon } from '../lib/salesSummary'
import { FOOD_COST_DANGER, FOOD_COST_WARN, loadBriefingDetails, loadStoreBriefing } from '../lib/storeBriefing'
import { STORE_INFO, storeColor } from '../data/stores'
import Icon from './Icon'

const LEVEL_LABEL = { red: '바로 확인', orange: '이번 주 처리', yellow: '참고' }
const FOOD_LABEL = { good: '정상', warn: '주의', danger: '위험' }

function man(n) {
  return shortWon(n)
}

function Signal({ alerts }) {
  if (!alerts) return <span className="sb-signal sb-signal-wait">···</span>
  const red = alerts.filter((a) => a.level === 'red').length
  const orange = alerts.filter((a) => a.level === 'orange').length
  if (!red && !orange) {
    return (
      <span className="sb-signal sb-signal-ok">
        <i />
        정상
      </span>
    )
  }
  return (
    <span className="sb-signal-group">
      {red > 0 && (
        <span className="sb-signal sb-signal-red">
          <i />
          긴급 {red}
        </span>
      )}
      {orange > 0 && (
        <span className="sb-signal sb-signal-orange">
          <i />
          처리 {orange}
        </span>
      )}
    </span>
  )
}

// 식재료비율 막대: 0~50% 구간, 35%·40% 기준선
function FoodGauge({ ratio, level }) {
  const pct = Math.max(0, Math.min(100, (ratio / 50) * 100))
  return (
    <span className="sb-gauge" aria-hidden="true">
      <span className={`sb-gauge-fill sb-gauge-${level}`} style={{ width: `${pct}%` }} />
      <span className="sb-gauge-mark" style={{ left: `${(FOOD_COST_WARN / 50) * 100}%` }} />
      <span className="sb-gauge-mark" style={{ left: `${(FOOD_COST_DANGER / 50) * 100}%` }} />
    </span>
  )
}

function StoreRow({ store, summary, onGo }) {
  const [briefing, setBriefing] = useState(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [details, setDetails] = useState(null)

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    loadStoreBriefing(store.code, todayStr())
      .then((b) => !cancelled && setBriefing(b))
      .catch((e) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [store.code])

  useEffect(() => {
    if (!open || details || !supabase) return
    let cancelled = false
    loadBriefingDetails(store.code, todayStr())
      .then((d) => !cancelled && setDetails(d))
      .catch(() => !cancelled && setDetails([]))
    return () => {
      cancelled = true
    }
  }, [open, details, store.code])

  const sales = briefing?.sales
  const change = sales?.change
  const allAlerts = briefing ? [...briefing.alerts, ...(details ?? [])] : []
  const groups = ['red', 'orange', 'yellow'].map((level) => ({ level, items: allAlerts.filter((a) => a.level === level) }))

  return (
    <li className={`sb-row${open ? ' sb-row-open' : ''}`} style={{ '--c': storeColor(store.code) }}>
      <button type="button" className="sb-row-main" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="sb-store">
          <span className="sb-store-name">{store.name}</span>
          <span className="sb-store-info">{STORE_INFO[store.code] ?? ''}</span>
        </span>

        <span className="sb-metric">
          <span className="sb-metric-label">이번 달 매출</span>
          {!briefing ? (
            <span className="sb-skeleton" />
          ) : sales.hasData ? (
            <span className="sb-metric-value">
              {man(sales.month)}
              <small>원</small>
              {change != null && (
                <span className={`sb-delta ${change >= 0 ? 'sb-delta-up' : 'sb-delta-down'}`}>
                  {change >= 0 ? '▲' : '▼'}
                  {Math.abs(change).toFixed(0)}%
                </span>
              )}
            </span>
          ) : (
            <span className="sb-metric-value sb-muted">미입력</span>
          )}
        </span>

        <span className="sb-metric">
          <span className="sb-metric-label">식재료비율</span>
          {!briefing ? (
            <span className="sb-skeleton" />
          ) : briefing.foodRatio != null ? (
            <span className="sb-metric-value">
              <span className={`sb-food sb-food-${briefing.foodLevel}`}>{briefing.foodRatio.toFixed(0)}%</span>
              <FoodGauge ratio={briefing.foodRatio} level={briefing.foodLevel} />
            </span>
          ) : (
            <span className="sb-metric-value sb-muted">—</span>
          )}
        </span>

        <span className="sb-metric">
          <span className="sb-metric-label">거래처 미지급</span>
          {summary ? (
            <span className="sb-metric-value">
              {man(summary.balance)}
              <small>원</small>
            </span>
          ) : (
            <span className="sb-skeleton" />
          )}
        </span>

        <span className="sb-status">
          {error ? <span className="sb-signal sb-signal-wait">오류</span> : <Signal alerts={briefing?.alerts} />}
          <span className="sb-chev" aria-hidden="true">
            <Icon name="chev" size={16} />
          </span>
        </span>
      </button>

      {open && (
        <div className="sb-detail">
          {error && <p className="error-text">{error}</p>}
          {briefing && (
            <div className="sb-facts">
              <div className="sb-fact">
                <span>입고</span>
                <b>{man(briefing.purchase)}원</b>
              </div>
              <div className="sb-fact-op">÷</div>
              <div className="sb-fact">
                <span>매출</span>
                <b>{sales.hasData ? `${man(sales.month)}원` : '미입력'}</b>
              </div>
              <div className="sb-fact-op">=</div>
              <div className="sb-fact">
                <span>식재료비율</span>
                <b className={briefing.foodLevel ? `sb-food-${briefing.foodLevel}` : ''}>
                  {briefing.foodRatio != null ? `${briefing.foodRatio.toFixed(1)}% · ${FOOD_LABEL[briefing.foodLevel]}` : '—'}
                </b>
              </div>
              <p className="sb-fact-note">
                기준: {FOOD_COST_WARN}% 이하 정상 · {FOOD_COST_DANGER}% 초과 위험
                {sales.prevSame > 0 && ` · 지난달 같은 기간 매출 ${man(sales.prevSame)}원`}
                {sales.missingDays.length > 0 && ` · 매출 입력 빠진 날 ${sales.missingDays.length}일`}
              </p>
            </div>
          )}

          <div className="sb-alerts">
            {groups.map(
              (g) =>
                g.items.length > 0 && (
                  <div key={g.level} className={`sb-alert-group sb-level-${g.level}`}>
                    <p className="sb-alert-title">
                      <i />
                      {LEVEL_LABEL[g.level]}
                    </p>
                    <ul>
                      {g.items.map((a, i) => (
                        <li key={i}>
                          <button type="button" className="sb-alert" onClick={() => onGo(store, a.to)}>
                            <span>{a.text}</span>
                            <Icon name="chev" size={14} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ),
            )}
            {briefing && details && allAlerts.length === 0 && <p className="sb-all-clear">✓ 사장님이 확인할 일이 없어요</p>}
            {briefing && !details && <p className="sb-loading-more">참고 사항을 확인하는 중…</p>}
          </div>

          <div className="sb-actions">
            <button type="button" onClick={() => onGo(store, '/consolidated')}>
              매출·결산
            </button>
            <button type="button" onClick={() => onGo(store, '/spending-report')}>
              입고 내역
            </button>
            <button type="button" onClick={() => onGo(store, '/vendors')}>
              미지급 장부
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

// 관리자 홈 "오늘의 매장 현황": 매장마다 한 줄(이번 달 매출·식재료비율·미지급·신호등), 누르면 펼쳐짐.
export default function StoreBoard({ stores, summaries, onGo }) {
  return (
    <section className="sb">
      <header className="sb-hd">
        <div>
          <p className="sb-eyebrow">STORE BRIEFING</p>
          <h2 className="sb-title">오늘의 매장 현황</h2>
        </div>
        <p className="sb-meta">이번 달 1일 ~ 오늘 · 식재료비율 = 입고 ÷ 매출 · 매장을 누르면 자세히</p>
      </header>
      <div className="sb-cols" aria-hidden="true">
        <span>매장</span>
        <span>이번 달 매출</span>
        <span>식재료비율</span>
        <span>거래처 미지급</span>
        <span>상태</span>
      </div>
      <ul className="sb-list">
        {stores.map((s) => (
          <StoreRow key={s.code} store={s} summary={summaries?.get(s.code)} onGo={onGo} />
        ))}
      </ul>
    </section>
  )
}
