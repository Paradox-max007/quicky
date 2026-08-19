'use client'

// QuickyBrand — logo lockup. Coral circle with white "Q" + wordmark.

export function QuickyBrand({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizes = {
    sm: { mark: 24, text: 'text-lg', gap: 'gap-1.5' },
    md: { mark: 36, text: 'text-2xl', gap: 'gap-2' },
    lg: { mark: 56, text: 'text-4xl', gap: 'gap-3' },
  }
  const s = sizes[size]
  return (
    <div className={`flex items-center ${s.gap}`}>
      <div
        className="rounded-full bg-coral-gradient flex items-center justify-center glow-coral"
        style={{ width: s.mark, height: s.mark }}
      >
        <span className="text-white font-bold" style={{ fontSize: s.mark * 0.55, lineHeight: 1 }}>
          Q
        </span>
      </div>
      <span className={`${s.text} font-bold tracking-tight text-white`}>
        Quicky
      </span>
    </div>
  )
}
