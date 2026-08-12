export function parseScale(text) {
  const trimmed = text.trim()
  if (!trimmed) return null

  const fraction = trimmed.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/)
  if (fraction) {
    const denominator = Number(fraction[2])
    if (denominator === 0) return null
    return Number(fraction[1]) / denominator
  }

  const value = Number(trimmed)
  return Number.isFinite(value) && value > 0 ? value : null
}
