import { useEffect, useRef, useState } from 'react'

// "관리 ▾" 버튼 하나에 여러 작업을 모아 두는 작은 펼침 메뉴. 목록 한 줄에 버튼이 여러 개 있으면
// 이름 칸이 좁아지므로, 자주 안 쓰는 작업은 여기에 넣는다. 바깥을 누르거나 Esc를 누르면 닫힌다.
export default function ActionMenu({ label = '관리', items }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="action-menu" ref={ref}>
      <button
        type="button"
        className="mini-btn action-menu-toggle"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {label} ▾
      </button>
      {open && (
        <div className="action-menu-list" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="action-menu-item"
              onClick={() => {
                setOpen(false)
                item.onClick()
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
