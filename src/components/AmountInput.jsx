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

// 숫자만 입력받아 1,000단위 콤마를 넣어서 보여주는 금액 입력칸. value/onChange는
// 기존 코드와 호환되도록 콤마 없는 순수 숫자 문자열을 그대로 주고받는다. 콤마가
// 늘거나 줄어도 커서가 튀지 않도록, 입력한 숫자 개수를 기준으로 커서 위치를 복원한다.
export default function AmountInput({ value, onChange, ...props }) {
  const ref = useRef(null)
  const digits = String(value ?? '').replace(/[^\d]/g, '')
  const formatted = digits === '' ? '' : Number(digits).toLocaleString('ko-KR')

  const handleChange = (e) => {
    const el = e.target
    const cursorPos = el.selectionStart ?? el.value.length
    const digitCountBeforeCursor = digitsBeforePosition(el.value, cursorPos)
    const nextDigits = el.value.replace(/[^\d]/g, '')
    onChange(nextDigits)

    requestAnimationFrame(() => {
      if (!ref.current) return
      const nextFormatted = nextDigits === '' ? '' : Number(nextDigits).toLocaleString('ko-KR')
      const pos = positionAfterDigits(nextFormatted, digitCountBeforeCursor)
      ref.current.setSelectionRange(pos, pos)
    })
  }

  return <input {...props} ref={ref} inputMode="decimal" value={formatted} onChange={handleChange} />
}
