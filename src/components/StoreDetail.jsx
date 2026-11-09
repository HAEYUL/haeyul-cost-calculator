import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { todayStr } from '../lib/vendorLedger'
import { shortWon } from '../lib/salesSummary'
import { FOOD_COST_DANGER, FOOD_COST_WARN, loadBriefingDetails } from '../lib/storeBriefing'
import { storeColor } from '../data/stores'
import Icon from './Icon'

const LEVEL_LABEL = { red: '바로 확인', orange: '이번 주 처리', yellow: '참고' }
const FOOD_LABEL = { good: '정상', warn: '주의', danger: '위험' }

// 매장 박스 머리띠의 작은 신호등: 긴급 n(바로 확인) / 처리 n(이번 주 처리) / 정상
export function StoreSignal({ briefing, failed }) {
  if (failed) return null
  if (!briefing) return <span className="sd-signal sd-signal-wait">···</span>
  const red = briefing.alerts.filter((a) => a.level === 'red').length
  const orange = briefing.alerts.filter((a) => a.level === 'orange').length
  if (!red && !orange) {
    return (
      <span className="sd-signal sd-signal-ok">
        <i />
        정상
      </span>
    )
  }
  return (
    <span className="sd-signal-group">
      {red > 0 && (
        <span className="sd-signal sd-signal-red">
          <i />
          긴급 {red}
        </span>
      )}
      {orange > 0 && (
        <span className="sd-signal sd-signal-orange">
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
    <span className="sd-gauge" aria-hidden="true">
      <span className={`sd-gauge-fill sd-gauge-${level}`} style={{ width: `${pct}%` }} />
      <span className="sd-gauge-mark" style={{ left: `${(FOOD_COST_WARN / 50) * 100}%` }} />
      <span className="sd-gauge-mark" style={{ left: `${(FOOD_COST_DANGER / 50) * 100}%` }} />
    </span>
  )
}

// 매장 박스를 누르면 박스들 아래에 펼쳐지는 그 매장 상세
export default function StoreDetail({ store, summary, briefing, error, onGo, onClose }) {
  const [details, setDetails] = useState(null)
  const ref = useRef(null)

  // 휴대폰에서는 상세가 카드들 아래에 열리므로 화면에 보이게 내려 준다.
  useEffect(() => {
    ref.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
  }, [store.code])

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    setDetails(null)
    loadBriefingDetails(store.code, todayStr())
      .then((d) => !cancelled && setDetails(d))
      .catch(() => !cancelled && setDetails([]))
    return () => {
      cancelled = true
    }
  }, [store.code])

  const sales = briefing?.sales
  const change = sales?.change
  const allAlerts = briefing ? [...briefing.alerts, ...(details ?? [])] : []
  const groups = ['red', 'orange', 'yellow'].map((level) => ({ level, items: allAlerts.filter((a) => a.level === level) }))

  return (
    <section ref={ref} className="sd" style={{ '--c': storeColor(store.code) }} aria-label={`${store.name} 상세`}>
      <header className="sd-hd">
        <div>
          <p className="sd-eyebrow">STORE DETAIL</p>
          <h3 className="sd-title">{store.name}</h3>
        </div>
        <button type="button" className="sd-close" onClick={onClose} aria-label="상세 닫기">
          닫기 ✕
        </button>
      </header>

      {error && <p className="error-text">{error}</p>}

      <div className="sd-metrics">
        <div className="sd-metric">
          <span className="sd-metric-label">이번 달 매출</span>
          {!briefing ? (
            <span className="sd-skeleton" />
          ) : sales.hasData ? (
            <span className="sd-metric-value">
              {shortWon(sales.month)}
              <small>원</small>
              {change != null && (
                <span className={`sd-delta ${change >= 0 ? 'sd-delta-up' : 'sd-delta-down'}`}>
                  {change >= 0 ? '▲' : '▼'}
                  {Math.abs(change).toFixed(0)}%
                </span>
              )}
            </span>
          ) : (
            <span className="sd-metric-value sd-muted">미입력</span>
          )}
          <span className="sd-metric-sub">
            {sales?.prevSame > 0 ? `지난달 같은 기간 ${shortWon(sales.prevSame)}원` : '지난달 같은 기간 대비'}
          </span>
        </div>

        <div className="sd-metric">
          <span className="sd-metric-label">식재료비율</span>
          {!briefing ? (
            <span className="sd-skeleton" />
          ) : briefing.foodRatio != null ? (
            <>
              <span className="sd-metric-value">
                <span className={`sd-food-${briefing.foodLevel}`}>{briefing.foodRatio.toFixed(1)}%</span>
                <span className={`sd-food-tag sd-food-${briefing.foodLevel}`}>{FOOD_LABEL[briefing.foodLevel]}</span>
              </span>
              <FoodGauge ratio={briefing.foodRatio} level={briefing.foodLevel} />
            </>
          ) : (
            <span className="sd-metric-value sd-muted">—</span>
          )}
          <span className="sd-metric-sub">
            {briefing ? `입고 ${shortWon(briefing.purchase)}원 ÷ 매출` : '입고 ÷ 매출'} · {FOOD_COST_WARN}% 이하 정상
          </span>
        </div>

        <div className="sd-metric">
          <span className="sd-metric-label">거래처 미지급</span>
          {summary ? (
            <span className="sd-metric-value">
              {shortWon(summary.balance)}
              <small>원</small>
            </span>
          ) : (
            <span className="sd-skeleton" />
          )}
          <span className="sd-metric-sub">장부 기준</span>
        </div>
      </div>

      {sales?.missingDays?.length > 0 && <p className="sd-note">이번 달 매출 입력이 빠진 날 {sales.missingDays.length}일 — 식재료비율이 실제보다 높게 보일 수 있어요</p>}

      <div className="sd-alerts">
        {groups.map(
          (g) =>
            g.items.length > 0 && (
              <div key={g.level} className={`sd-alert-group sd-level-${g.level}`}>
                <p className="sd-alert-title">
                  <i />
                  {LEVEL_LABEL[g.level]}
                </p>
                <ul>
                  {g.items.map((a, i) => (
                    <li key={i}>
                      <button type="button" className="sd-alert" onClick={() => onGo(store, a.to)}>
                        <span>{a.text}</span>
                        <Icon name="chev" size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ),
        )}
        {briefing && details && allAlerts.length === 0 && <p className="sd-all-clear">✓ 사장님이 확인할 일이 없어요</p>}
        {briefing && !details && <p className="sd-loading-more">참고 사항을 확인하는 중…</p>}
      </div>

      <div className="sd-actions">
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
    </section>
  )
}
