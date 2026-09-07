import { useEffect, useState } from 'react'

function readStored(storageKey) {
  if (!storageKey || typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(`dateRange:${storageKey}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeStored(storageKey, value) {
  if (!storageKey || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(`dateRange:${storageKey}`, JSON.stringify(value))
  } catch {
    // 사생활 보호 모드 등 localStorage를 못 쓰는 환경이면 그냥 기억을 건너뛴다.
  }
}

// 기간(dateFrom/dateTo) 선택 상태를 브라우저에 기억해둔다. 화면을 나갔다 다시 들어와도(또는
// 새로고침해도) 마지막으로 고른 기간이 그대로 유지된다. storageKey가 다르면 서로 다른 기억
// 공간을 쓴다 — 거래처 상세처럼 대상마다 따로 기억하고 싶으면 storageKey에 그 대상의 id를
// 포함시키면 된다(예: `vendor-detail:${vendorId}`). storageKey가 바뀌면(다른 대상으로
// 이동하면) 그 키에 저장된 값을 다시 불러온다. defaultRange는 저장된 값이 없을 때만 쓴다.
export function useRememberedDateRange(storageKey, defaultRange) {
  const initial = readStored(storageKey)
  const [dateFrom, setDateFromState] = useState(initial?.dateFrom ?? defaultRange.start)
  const [dateTo, setDateToState] = useState(initial?.dateTo ?? defaultRange.end)
  const [activePreset, setActivePresetState] = useState(initial?.activePreset ?? defaultRange.activePreset ?? null)

  useEffect(() => {
    const next = readStored(storageKey)
    setDateFromState(next?.dateFrom ?? defaultRange.start)
    setDateToState(next?.dateTo ?? defaultRange.end)
    setActivePresetState(next?.activePreset ?? defaultRange.activePreset ?? null)
    // defaultRange는 매 렌더링마다 새 객체로 넘어오는 경우가 많아 의존성에서 뺀다 —
    // storageKey가 바뀔 때만(=다른 대상으로 이동했을 때만) 다시 불러오면 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

  const setDateFrom = (value) => {
    setDateFromState(value)
    setActivePresetState(null)
    writeStored(storageKey, { dateFrom: value, dateTo, activePreset: null })
  }

  const setDateTo = (value) => {
    setDateToState(value)
    setActivePresetState(null)
    writeStored(storageKey, { dateFrom, dateTo: value, activePreset: null })
  }

  const applyPreset = (preset) => {
    const { start, end } = preset.range()
    setDateFromState(start)
    setDateToState(end)
    setActivePresetState(preset.key)
    writeStored(storageKey, { dateFrom: start, dateTo: end, activePreset: preset.key })
  }

  return { dateFrom, dateTo, activePreset, setDateFrom, setDateTo, applyPreset }
}
