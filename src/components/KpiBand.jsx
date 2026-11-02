import Icon from './Icon'

// 네이비 띠: 핵심 숫자 4개. items: [{ icon, label, value, unit, sub, tone: 'neg'|'gold', to }]
export default function KpiBand({ items, onOpen }) {
  return (
    <div className="kpi-band">
      {items.map((k) => (
        <button type="button" key={k.label} className="kpi-item" onClick={() => k.to && onOpen?.(k.to)}>
          <span className="kpi-label">
            <Icon name={k.icon} size={16} /> {k.label}
          </span>
          <span className={`kpi-value${k.tone ? ` kpi-${k.tone}` : ''}`}>
            {k.value}
            <small>{k.unit}</small>
          </span>
          <span className="kpi-sub">{k.sub}</span>
        </button>
      ))}
    </div>
  )
}
