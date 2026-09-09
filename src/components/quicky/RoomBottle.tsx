'use client'

import { useEffect, useRef } from 'react'

// RoomBottle — the centered game bottle. Same contract as the old Three.js
// sprite: it interpolates startRotation → endRotation (radians) with a
// quintic ease-out over `duration` ms while `spinning` is true, and snaps to
// endRotation when false. Rendered as a glossy SVG game asset that rotates
// around its center (0 rad = pointing up, matching the server seat angles).

type Props = {
  startRotation: number
  endRotation: number
  duration: number
  spinning: boolean
}

const BOTTLE_SVG = (
  <svg viewBox="0 0 80 232" width="100%" height="100%" aria-hidden>
    <defs>
      <linearGradient id="sbrGlass" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#2f9e2f" />
        <stop offset="22%" stopColor="#63d13f" />
        <stop offset="40%" stopColor="#8ce95c" />
        <stop offset="62%" stopColor="#4cbf30" />
        <stop offset="88%" stopColor="#2c8c22" />
        <stop offset="100%" stopColor="#1f6b18" />
      </linearGradient>
      <linearGradient id="sbrCap" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#ffe27a" />
        <stop offset="55%" stopColor="#f5b93c" />
        <stop offset="100%" stopColor="#d9921b" />
      </linearGradient>
    </defs>
    {/* cap / foil */}
    <rect x="30" y="2" width="20" height="16" rx="4" fill="url(#sbrCap)" />
    <rect x="30" y="14" width="20" height="3" fill="rgba(120,70,0,0.35)" />
    {/* neck */}
    <rect x="33" y="16" width="14" height="44" fill="url(#sbrGlass)" />
    {/* shoulder + body */}
    <path
      d="M33 58 C33 70 12 74 12 96 L12 208 C12 220 20 228 40 228 C60 228 68 220 68 208 L68 96 C68 74 47 70 47 58 Z"
      fill="url(#sbrGlass)"
    />
    {/* glass highlight */}
    <rect x="20" y="82" width="7" height="128" rx="3.5" fill="rgba(255,255,255,0.4)" />
    <rect x="30" y="66" width="4" height="30" rx="2" fill="rgba(255,255,255,0.45)" />
    {/* right shade */}
    <rect x="58" y="84" width="6" height="124" rx="3" fill="rgba(10,60,5,0.28)" />
    {/* base glow */}
    <ellipse cx="40" cy="222" rx="22" ry="5" fill="rgba(0,0,0,0.18)" />
  </svg>
)

export function RoomBottle({ startRotation, endRotation, duration, spinning }: Props) {
  const elRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = elRef.current
    if (!el) return
    if (!spinning) {
      el.style.transform = `rotate(${endRotation}rad)`
      return
    }
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / Math.max(1, duration))
      const eased = 1 - Math.pow(1 - t, 5) // quintic ease-out (same as before)
      el.style.transform = `rotate(${startRotation + (endRotation - startRotation) * eased}rad)`
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [spinning, startRotation, endRotation, duration])

  return (
    <div className="sbr-bottle-layer">
      <div className="sbr-bottle-float">
        <div
          ref={elRef}
          className={`sbr-bottle ${spinning ? 'sbr-bottle-spinning' : ''}`}
          style={{ transform: `rotate(${endRotation}rad)` }}
        >
          {BOTTLE_SVG}
        </div>
      </div>
      <div className="sbr-bottle-shadow" />
    </div>
  )
}
