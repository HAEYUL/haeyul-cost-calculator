import { positionLabel } from '../lib/dispatch'

// 홀/주방 표시
export default function PositionTag({ value }) {
  if (!value) return <span className="hint">-</span>
  return <span className={`position-tag position-tag-${value}`}>{positionLabel(value)}</span>
}
