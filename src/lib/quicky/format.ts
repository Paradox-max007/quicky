// Quicky — compact point formatting (Games hub trophies/hearts)
//
//   999 → "999" · 1000 → "1k" · 1100 → "1.1k" · 12 340 → "12.3k"
//   1 234 000 → "1.2M"
//
// At most one decimal, never a trailing ".0", always ASCII (k/M/B).

export function formatCompact(n: number): string {
  const v = Number.isFinite(n) ? n : 0
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs < 1000) return `${sign}${Math.round(abs)}`
  if (abs < 1_000_000) return `${sign}${trim1(abs / 1000)}k`
  if (abs < 1_000_000_000) return `${sign}${trim1(abs / 1_000_000)}M`
  return `${sign}${trim1(abs / 1_000_000_000)}B`
}

function trim1(value: number): string {
  const s = value.toFixed(1)
  return s.endsWith('.0') ? s.slice(0, -2) : s
}
