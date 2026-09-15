'use client'

// QuickyBrand — logo lockup where the stylized transparent PNG Q-heart logo
// serves as the leading "Q" of the wordmark ("uicky").

export function QuickyBrand({
  size = 'md',
  className = '',
}: {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const sizes = {
    sm: { mark: 28, text: 'text-xl', gap: 'gap-0.5' },
    md: { mark: 40, text: 'text-3xl', gap: 'gap-0.5' },
    lg: { mark: 56, text: 'text-4xl', gap: 'gap-1' },
  }
  const s = sizes[size]
  return (
    <div className={`inline-flex items-center select-none ${s.gap} ${className}`}>
      { }
      <img
        src="/logo.png"
        alt="Q"
        className="select-none object-contain drop-shadow-[0_0_20px_rgba(255,75,110,0.45)]"
        style={{ height: s.mark, width: 'auto' }}
        draggable={false}
      />
      <span className={`${s.text} font-bold tracking-tight text-white leading-none`}>
        uicky
      </span>
    </div>
  )
}

