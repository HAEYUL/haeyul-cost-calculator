// 표(rows)를 CSV 텍스트로 바꾸고, 브라우저에서 파일로 내려받게 한다.
function escapeCsvValue(value) {
  if (value == null) return ''
  const str = String(value)
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

// columns: [{ label: '표시할 제목', value: '필드명' 또는 (row) => 값 }]
export function rowsToCsv(rows, columns) {
  const header = columns.map((c) => escapeCsvValue(c.label)).join(',')
  const lines = rows.map((row) =>
    columns.map((c) => escapeCsvValue(typeof c.value === 'function' ? c.value(row) : row[c.value])).join(','),
  )
  return [header, ...lines].join('\n')
}

// 엑셀에서 한글이 깨지지 않도록 UTF-8 BOM을 붙여서 내려받는다.
export function downloadCsv(filename, csvText) {
  const blob = new Blob(['﻿' + csvText], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
