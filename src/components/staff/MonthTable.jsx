import { POSITION_ICONS, employmentLabel } from '../../lib/staffPosition'

const MARK_CLASS = { O: 'mt-full', '△': 'mt-half', 연: 'mt-leave', X: 'mt-off' }

// 월 근무 현황표: 직원(포지션별 묶음) × 날짜. 이름 열은 고정, 칸을 누르면 표시가 바뀐다(수정 가능할 때).
// 아래에 포지션별 일별 인원(직원 근무 + 파출)과 파출 수를 보여준다. 기록 안 된 날은 빗금.
export default function MonthTable({ model, editable, onCycle, onRename }) {
  const { days, groups, headcount, dispatchPerDay } = model
  const colCount = days.length + 6
  return (
    <div className="mt-wrap">
      <table className="mt-table">
        <thead>
          <tr>
            <th className="mt-name mt-sticky">직원</th>
            {days.map((d) => (
              <th key={d.day} className={`${d.weekend ? 'mt-weekend' : ''}${d.unrecorded ? ' mt-unrecorded' : ''}`}>
                <span className="mt-day">{d.day}</span>
                <span className="mt-wd">{d.weekday}</span>
              </th>
            ))}
            <th className="mt-sum">종일</th>
            <th className="mt-sum">반</th>
            <th className="mt-sum">연차</th>
            <th className="mt-sum">휴무</th>
            <th className="mt-sum">총</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <GroupRows key={g.position} group={g} days={days} colCount={colCount} editable={editable} onCycle={onCycle} onRename={onRename} />
          ))}
          {headcount.length > 0 && (
            <tr className="mt-section">
              <td className="mt-name mt-sticky" colSpan={1}>
                일별 인원
              </td>
              <td colSpan={colCount - 1} className="mt-section-fill">
                직원 근무(종일·반타임) + 파출
              </td>
            </tr>
          )}
          {headcount.map((h) => (
            <tr key={h.position} className="mt-count-row">
              <td className="mt-name mt-sticky">
                {POSITION_ICONS[h.position] ?? ''} {h.position}
              </td>
              {h.perDay.map((c, i) => (
                <td key={i} className={days[i].weekend ? 'mt-weekend' : ''} title={c.dispatch ? `직원 ${c.staff} + 파출 ${c.dispatch}` : ''}>
                  {c.total || ''}
                  {c.dispatch > 0 && <sup className="mt-dispatch-mark">파</sup>}
                </td>
              ))}
              <td colSpan={5} />
            </tr>
          ))}
          <tr className="mt-count-row">
            <td className="mt-name mt-sticky">👷 파출</td>
            {dispatchPerDay.map((c, i) => (
              <td key={i} className={days[i].weekend ? 'mt-weekend' : ''}>
                {c || ''}
              </td>
            ))}
            <td colSpan={5} />
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function GroupRows({ group, days, colCount, editable, onCycle, onRename }) {
  return (
    <>
      <tr className="mt-group">
        <td className="mt-name mt-sticky">
          {POSITION_ICONS[group.position] ?? '👤'} {group.position} ({group.rows.length})
        </td>
        <td colSpan={colCount - 6} className="mt-section-fill" />
        <td className="mt-sum">{group.subtotal.full}</td>
        <td className="mt-sum">{group.subtotal.half}</td>
        <td className="mt-sum">{group.subtotal.leave}</td>
        <td className="mt-sum">{group.subtotal.off}</td>
        <td className="mt-sum mt-total">{group.subtotal.total}</td>
      </tr>
      {group.rows.map((r) => (
        <tr key={r.name}>
          <td className="mt-name mt-sticky">
            {onRename ? (
              <button type="button" className="mt-name-btn" onClick={() => onRename(r.name)} title="이름 고치기">
                {r.name}
              </button>
            ) : (
              r.name
            )}
            {r.employmentType && <span className="mt-emp">{employmentLabel(r.employmentType) === '아르바이트' ? '알바' : '정'}</span>}
          </td>
          {days.map((d) => {
            const mark = r.days[String(d.day)]
            return (
              <td
                key={d.day}
                className={`mt-cell ${MARK_CLASS[mark] ?? ''}${d.weekend ? ' mt-weekend' : ''}${d.unrecorded ? ' mt-unrecorded' : ''}`}
              >
                {editable ? (
                  <button type="button" className="mt-cell-btn" onClick={() => onCycle(r.name, d.day)} aria-label={`${r.name} ${d.day}일 ${mark ?? '빈칸'}`}>
                    {mark ?? ''}
                  </button>
                ) : (
                  mark ?? ''
                )}
              </td>
            )
          })}
          <td className="mt-sum">{r.counts.full}</td>
          <td className="mt-sum">{r.counts.half}</td>
          <td className="mt-sum">{r.counts.leave}</td>
          <td className="mt-sum">{r.counts.off}</td>
          <td className="mt-sum mt-total">{r.counts.total}</td>
        </tr>
      ))}
    </>
  )
}
