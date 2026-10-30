import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

// 다른 화면에서 navigate(경로, { state: { scrollTo: 'id' } })로 들어오면, 자료를 다 불러온 뒤
// 그 id의 칸으로 내려가 준다. 예: 재고 목록의 "재고 실사" → 재고 상세의 실사 입력 칸.
// 같은 방문 기록에서는 한 번만 내려가서, 사용자가 위로 올려 본 위치를 다시 끌어내리지 않는다.
// ready: 자료를 다 불러왔는지. 화면은 불러오기 직전에도 잠깐 ready로 그려지므로, ready가 잠시
// 유지된 뒤(화면이 자리 잡은 뒤)에 내려간다. 그 사이 다시 불러오기 시작하면 기다렸다가 다시 잰다.
const SETTLE_MS = 250

export function useScrollToSection(ready) {
  const location = useLocation()
  const target = location.state?.scrollTo
  const doneKey = useRef(null)

  useEffect(() => {
    if (!ready || !target || doneKey.current === location.key) return
    const timer = setTimeout(() => {
      const el = document.getElementById(target)
      if (!el) return
      doneKey.current = location.key
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, SETTLE_MS)
    return () => clearTimeout(timer)
  }, [ready, target, location.key])
}
