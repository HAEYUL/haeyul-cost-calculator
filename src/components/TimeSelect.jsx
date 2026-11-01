import { WORK_HOURS, WORK_MINUTES } from '../lib/dispatch'

// 근무시간 고르기: 시(09~21) + 분(00 기본, 30). value/onChange는 'HH:MM' 또는 ''.
// 예전에 범위 밖 시각(예: 08:00)으로 저장된 근무를 고칠 때도 그 값이 보이도록 목록에 더한다.
export default function TimeSelect({ value, onChange, disabled, label }) {
  const [h = '', m = ''] = value ? value.split(':') : []
  const hours = WORK_HOURS.includes(h) || !h ? WORK_HOURS : [...WORK_HOURS, h].sort()
  const minutes = WORK_MINUTES.includes(m) || !m ? WORK_MINUTES : [...WORK_MINUTES, m].sort()
  return (
    <div className="time-select" role="group" aria-label={label}>
      <select
        className="select"
        value={h}
        onChange={(e) => onChange(e.target.value ? `${e.target.value}:${m || '00'}` : '')}
        disabled={disabled}
        aria-label={`${label} 시`}
      >
        <option value="">시</option>
        {hours.map((x) => (
          <option key={x} value={x}>
            {x}시
          </option>
        ))}
      </select>
      <select
        className="select"
        value={m || '00'}
        onChange={(e) => h && onChange(`${h}:${e.target.value}`)}
        disabled={disabled || !h}
        aria-label={`${label} 분`}
      >
        {minutes.map((x) => (
          <option key={x} value={x}>
            {x}분
          </option>
        ))}
      </select>
    </div>
  )
}
