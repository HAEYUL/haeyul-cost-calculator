import { useRef } from 'react'

// 커서 앞에 있는 숫자(콤마 제외)의 개수를 센다.
function digitsBeforePosition(str, pos) {
  return str.slice(0, pos).replace(/[^\d]/g, '').length
}

// 문자열에서 숫자를 digitCount개 지나간 직후의 위치를 찾는다.
function positionAfterDigits(str, digitCount) {
  if (digitCount <= 0) return 0
  let seen = 0
  for (let i = 0; i < str.length; i++) {
    if (/\d/.test(str[i])) {
      seen++
      if (seen === digitCount) return i + 1
    }
  }
  return str.length
}

// 숫자와 소수점(최대 1개)만 남기고 나머지(콤마 등)는 지운다. 단가처럼 나눗셈으로 소수점이
// 생기는 값을 그대로 입력받기 위함 — 예전엔 소수점까지 지워버려서 172,727.3원이 1,727,273원으로
// 둔갑하는 버그가 있었다.
function sanitizeDigits(raw) {
  const cleaned = raw.replace(/[^\d.]/g, '')
  const dotIndex = cleaned.indexOf('.')
  if (dotIndex === -1) return cleaned
  return cleaned.slice(0, dotIndex + 1) + cleaned.slice(dotIndex + 1).replace(/\./g, '')
}

// 정수부에만 1,000단위 콤마를 넣는다. 소수점을 막 입력한 직후(소수부가 아직 비어있음)에도
// 점이 사라지지 않도록 그대로 붙여둔다.
function formatDigits(digits) {
  if (digits === '') return ''
  const dotIndex = digits.indexOf('.')
  if (dotIndex === -1) return Number(digits).toLocaleString('ko-KR')
  const intPart = digits.slice(0, dotIndex)
  const fracPart = digits.slice(dotIndex + 1)
  const formattedInt = intPart === '' ? '0' : Number(intPart).toLocaleString('ko-KR')
  return `${formattedInt}.${fracPart}`
}

// 숫자만 입력받아 1,000단위 콤마를 넣어서 보여주는 금액 입력칸. value/onChange는
// 기존 코드와 호환되도록 콤마 없는 순수 숫자 문자열을 그대로 주고받는다. 콤마가
// 늘거나 줄어도 커서가 튀지 않도록, 입력한 숫자 개수를 기준으로 커서 위치를 복원한다.
export default function AmountInput({ value, onChange, ...props }) {
  const ref = useRef(null)
  const digits = sanitizeDigits(String(value ?? ''))
  const formatted = formatDigits(digits)

  const handleChange = (e) => {
    const el = e.target
    const cursorPos = el.selectionStart ?? el.value.length
    const digitCountBeforeCursor = digitsBeforePosition(el.value, cursorPos)
    const nextDigits = sanitizeDigits(el.value)
    onChange(nextDigits)

    requestAnimationFrame(() => {
      if (!ref.current) return
      const nextFormatted = formatDigits(nextDigits)
      const pos = positionAfterDigits(nextFormatted, digitCountBeforeCursor)
      ref.current.setSelectionRange(pos, pos)
    })
  }

  return <input {...props} ref={ref} inputMode="decimal" value={formatted} onChange={handleChange} />
}
