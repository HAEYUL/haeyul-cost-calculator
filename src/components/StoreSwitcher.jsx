// 메인 관리자가 보는 매장을 바꾸는 선택칸
export default function StoreSwitcher({ stores, store, onChange, className = '' }) {
  return (
    <select
      className={`select ${className}`}
      value={store.code}
      onChange={(e) => {
        const next = stores.find((s) => s.code === e.target.value)
        if (next) onChange(next)
      }}
      aria-label="보는 매장"
    >
      {stores.map((s) => (
        <option key={s.code} value={s.code}>
          {s.name}
        </option>
      ))}
    </select>
  )
}
