import { useState } from 'react'

const BANKS = ['기업은행', '국민은행', '농협', '신한은행', '우리은행', '하나은행', '카카오뱅크', '토스뱅크', '새마을금고', '우체국', '수협', '신협', 'SC제일은행', '케이뱅크']

const CUSTOM = '__custom'

// 은행 고르기: 진짜 선택 상자(<select>) + 목록에 없으면 [직접 입력].
// 예전 '입력칸 + 추천 목록(datalist)'은 삼성 인터넷 일부 버전·카카오톡 등 앱 안 브라우저에서
// 목록을 눌러도 값이 전달되지 않아 은행이 빈칸으로 저장됐다. <select>는 어느 휴대폰에서나 똑같이 동작한다.
// onChange(은행 이름 문자열)
export default function BankSelect({ value, onChange, disabled = false, className = '' }) {
  const bank = value ?? ''
  // 목록에 없는 은행 이름(예: 부산은행)이 이미 들어 있으면 처음부터 직접 입력 상태로 보여 준다.
  const [custom, setCustom] = useState(() => bank !== '' && !BANKS.includes(bank))
  // 목록에 있는 은행이면(다른 인력을 골라 값이 바뀐 경우 포함) 선택 상자로, 아니면 직접 입력 칸으로
  const isCustom = BANKS.includes(bank) ? false : custom || bank !== ''

  return (
    <span className={`bank-select ${className}`.trim()}>
      <select
        className="input"
        value={isCustom ? CUSTOM : bank}
        disabled={disabled}
        aria-label="은행"
        onChange={(e) => {
          const v = e.target.value
          if (v === CUSTOM) {
            setCustom(true)
            onChange('')
          } else {
            setCustom(false)
            onChange(v)
          }
        }}
      >
        <option value="">은행 선택</option>
        {BANKS.map((b) => (
          <option key={b} value={b}>
            {b}
          </option>
        ))}
        <option value={CUSTOM}>직접 입력</option>
      </select>
      {isCustom && (
        <input
          className="input"
          value={bank}
          onChange={(e) => onChange(e.target.value)}
          placeholder="은행 이름"
          aria-label="은행 이름 직접 입력"
          disabled={disabled}
        />
      )}
    </span>
  )
}
