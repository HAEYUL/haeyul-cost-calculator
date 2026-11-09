// 물품명 검색: 입력한 글자가 이름 "어디에든" 들어 있으면 찾는다(예: "연근채" → "염장연근채(중국산/...)box").
// 띄어쓰기·대소문자는 무시하고, 앞글자부터 맞는 이름을 먼저 보여준다.
const normalize = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, '')

export function searchItemNames(names, query, limit = 20) {
  const q = normalize(query)
  if (!q) return []
  const prefix = []
  const middle = []
  for (const name of names) {
    const n = normalize(name)
    if (n.startsWith(q)) prefix.push(name)
    else if (n.includes(q)) middle.push(name)
  }
  return [...prefix, ...middle].slice(0, limit)
}
