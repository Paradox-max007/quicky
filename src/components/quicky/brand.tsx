'use client'

// QuickyBrand — logo lockup. Q-heart mark image + wordmark.

export function QuickyBrand({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizes = {
    sm: { mark: 28, text: 'text-lg', gap: 'gap-1.5' },
    md: { mark: 42, text: 'text-2xl', gap: 'gap-2' },
    lg: { mark: 64, text: 'text-4xl', gap: 'gap-3' },
  }
  const s = sizes[size]
  return (
    <div className={`flex items-center ${s.gap}`}>
      <img
        src="/logo.png"
        alt="Quicky"
        className="glow-coral select-none"
        style={{ height: s.mark, width: 'auto' }}
        draggable={false}
      />
      <span className={`${s.text} font-bold tracking-tight text-white`}>
        Quicky
      </span>
    </div>
  )
}
