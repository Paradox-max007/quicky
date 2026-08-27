// Quicky — Instagram/Snapchat-style media filter presets.
// The selected preset id is stored with each post/roll, and rendered by
// applying `css` as a CSS filter — so every viewer sees the same look.

export type MediaFilter = { id: string; label: string; css: string }

export const MEDIA_FILTERS: MediaFilter[] = [
  { id: 'none', label: 'Original', css: '' },
  { id: 'clarendon', label: 'Clarendon', css: 'contrast(1.2) saturate(1.35)' },
  { id: 'gingham', label: 'Gingham', css: 'brightness(1.05) sepia(0.12) hue-rotate(-10deg)' },
  { id: 'moon', label: 'Moon', css: 'grayscale(1) contrast(1.15) brightness(1.05)' },
  { id: 'lark', label: 'Lark', css: 'contrast(0.9) brightness(1.12) saturate(1.15)' },
  { id: 'reyes', label: 'Reyes', css: 'sepia(0.25) brightness(1.1) contrast(0.85) saturate(0.7)' },
  { id: 'juno', label: 'Juno', css: 'saturate(1.5) contrast(1.1) sepia(0.08) hue-rotate(-8deg)' },
  { id: 'slumber', label: 'Slumber', css: 'saturate(0.66) brightness(1.05) sepia(0.18)' },
  { id: 'crema', label: 'Crema', css: 'sepia(0.2) contrast(1.05) brightness(1.02) saturate(0.9)' },
  { id: 'ludwig', label: 'Ludwig', css: 'contrast(1.05) saturate(1.25) brightness(1.05)' },
  { id: 'aden', label: 'Aden', css: 'hue-rotate(-20deg) contrast(0.9) saturate(0.85) brightness(1.2)' },
  { id: 'vivid', label: 'Vivid', css: 'saturate(1.8) contrast(1.15)' },
]

// Resolve a stored filter id to its CSS string (empty string when unknown).
export function filterCss(id?: string | null): string {
  return MEDIA_FILTERS.find((f) => f.id === id)?.css ?? ''
}

// "2h", "3d", ... for post/roll timestamps
export function timeAgo(iso: string | Date): string {
  const t = typeof iso === 'string' ? new Date(iso).getTime() : iso.getTime()
  const s = Math.max(1, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  return `${Math.floor(d / 7)}w`
}
