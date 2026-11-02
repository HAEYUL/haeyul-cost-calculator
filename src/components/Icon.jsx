// 선 아이콘 (이모지 대신). name은 아래 PATHS의 키.
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }

const PATHS = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  receipt: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h4" />,
  box: <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5zM3 7.5 12 12l9-4.5M12 12v9" />,
  check: <path d="M8 4h8v3H8zM6 5H5v16h14V5h-1M9 13l2 2 4-4" />,
  store: <path d="M3 9 5 4h14l2 5M3 9h18M3 9v1a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0V9M5 13v8h14v-8M10 21v-5h4v5" />,
  card: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="M3 10h18M7 15h4" />
    </>
  ),
  inbox: <path d="M3 13h5l1.5 3h5L16 13h5M3 13l3-8h12l3 8v6H3z" />,
  trend: <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />,
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  sum: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 7h8M8 11h2M12 11h2M8 15h2M12 15h2M8 18h2M12 18h4" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6" />
    </>
  ),
  send: <path d="M21 3 10 14M21 3l-7 18-4-7-7-4z" />,
  print: <path d="M7 8V3h10v5M7 17H4v-7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7h-3M7 14h10v7H7z" />,
  bell: <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0" />,
  mega: <path d="M3 10v4h3l7 4V6L6 10zM16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12" />,
  hand: <path d="M3 12h4l3-3h4l3 3h4M7 12l4 4a2 2 0 0 0 3 0l3-4M3 12v5h3M21 12v5h-3" />,
  out: <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11" />,
  warn: <path d="M12 3 2 20h20zM12 10v4M12 17v.5" />,
  doc: <path d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6" />,
  chev: <path d="M9 6l6 6-6 6" />,
  book: <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M8 7h7" />,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  coin: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9 9.5h4.5a1.75 1.75 0 0 1 0 3.5H10.5a1.75 1.75 0 0 0 0 3.5H15M12 7.5v1.5M12 16.5V18" />
    </>
  ),
  wave: <path d="M3 17l4-6 4 3 4-8 6 9" />,
  list: <path d="M9 6h11M9 12h11M9 18h11M4 6h.5M4 12h.5M4 18h.5" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  save: <path d="M5 3h11l3 3v15H5zM8 3v5h7V3M8 21v-7h8v7" />,
  chat: <path d="M4 5h16v11H9l-5 4z" />,
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17v.5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l9-9M17 6l2 2M15 8l2 2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" />
    </>
  ),
  pen: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
}

export default function Icon({ name, size = 18, className = '' }) {
  const path = PATHS[name] ?? PATHS.doc
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...S}>
      {path}
    </svg>
  )
}
