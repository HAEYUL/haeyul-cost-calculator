import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'

// 화면의 기간·필터·검색어와 스크롤 위치를 "그 화면의 방문 기록(history 항목)"에 같이 저장한다.
// 상세 화면을 보고 뒤로 돌아오면(← 뒤로 버튼이든 휴대폰 뒤로가기든) 보던 그대로 다시 보인다.
// 메뉴에서 새로 들어오면 새 방문 기록이라 기본값으로 시작한다.
//
// React Router는 history.state.usr에 location.state를 보관하므로, 그 안의 PAGE_KEY 칸에 덧붙여 쓴다.
// navigate(replace)를 쓰지 않고 history.replaceState로 직접 써서, 화면이 다시 그려지지 않고 여러 값을
// 동시에 바꿔도 서로 덮어쓰지 않는다.
const PAGE_KEY = '__page'
const SCROLL_KEY = '__scrollY'

function readPageState() {
  return window.history.state?.usr?.[PAGE_KEY] ?? {}
}

function writePageState(patch) {
  const historyState = window.history.state ?? {}
  const usr = historyState.usr ?? {}
  window.history.replaceState({ ...historyState, usr: { ...usr, [PAGE_KEY]: { ...(usr[PAGE_KEY] ?? {}), ...patch } } }, '')
}

const resolve = (initial) => (typeof initial === 'function' ? initial() : initial)

// useState와 똑같이 쓰되, 값이 이 화면의 방문 기록에 남는다.
export function useHistoryState(key, initial) {
  const location = useLocation()
  const [value, setValue] = useState(() => {
    const saved = readPageState()[key]
    return saved !== undefined ? saved : resolve(initial)
  })

  // 같은 화면 컴포넌트가 다른 방문 기록으로 바뀌면(예: 다른 거래처 상세로 이동) 그 기록의 값을 다시 읽는다.
  const lastKey = useRef(location.key)
  useEffect(() => {
    if (lastKey.current === location.key) return
    lastKey.current = location.key
    const saved = readPageState()[key]
    setValue(saved !== undefined ? saved : resolve(initial))
    // initial은 렌더링마다 새로 만들어지는 경우가 많아 의존성에서 뺀다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key, key])

  useEffect(() => {
    writePageState({ [key]: value })
  }, [key, value])

  return [value, setValue]
}

// 앱 전체에 한 번 둔다: 새 화면으로 가면 맨 위에서 시작하고, 뒤로 돌아오면 보던 위치로 스크롤한다.
// 목록은 데이터를 불러온 뒤에야 길어지므로, 보던 위치까지 내려갈 수 있을 때까지 잠깐 다시 시도한다.
export function ScrollManager() {
  const location = useLocation()
  const navigationType = useNavigationType()

  useEffect(() => {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual'
  }, [])

  useEffect(() => {
    let timer
    const onScroll = () => {
      clearTimeout(timer)
      timer = setTimeout(() => writePageState({ [SCROLL_KEY]: window.scrollY }), 150)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      clearTimeout(timer)
      window.removeEventListener('scroll', onScroll)
    }
  }, [location.key])

  useEffect(() => {
    const target = navigationType === 'POP' ? (readPageState()[SCROLL_KEY] ?? 0) : 0
    if (!target) {
      window.scrollTo(0, 0)
      return
    }
    let tries = 0
    const attempt = () => {
      const maxY = document.documentElement.scrollHeight - window.innerHeight
      window.scrollTo(0, Math.min(target, Math.max(maxY, 0)))
      if (maxY < target && tries++ < 30) retry = setTimeout(attempt, 100)
    }
    let retry = setTimeout(attempt, 0)
    return () => clearTimeout(retry)
  }, [location.key, navigationType])

  return null
}

// "← 뒤로" 버튼: 앱 안에서 왔으면 온 곳으로 돌아가고(보던 기간·위치 그대로), 링크로 바로 열었으면 fallback으로 간다.
export function useGoBack(fallback) {
  const navigate = useNavigate()
  const location = useLocation()
  return () => (location.key !== 'default' ? navigate(-1) : navigate(fallback))
}
