'use client'

import { useEffect, useRef } from 'react'

// RoomBottle — the centered game bottle. Same contract as the old Three.js
// sprite: it interpolates startRotation → endRotation (radians) with a
// quintic ease-out over `duration` ms while `spinning` is true, and snaps to
// endRotation when false. Rendered as a glossy SVG game asset that rotates
// around its center (0 rad = pointing up, matching the server seat angles).
// Art follows the approved mockups: emerald glass, gold foil cap, specular
// highlights and a light label band.

type Props = {
  startRotation: number
  endRotation: number
  duration: number
  spinning: boolean
  /** False while the duel spotlight is on — the bottle fades/shrinks away. */
  visible?: boolean
}

const BOTTLE_SVG = (
  <svg viewBox="0 0 60 180" width="100%" height="100%" aria-hidden>
    <defs>
      <linearGradient id="sbrGlass" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#047857" />
        <stop offset="30%" stopColor="#34d399" />
        <stop offset="62%" stopColor="#10b981" />
        <stop offset="100%" stopColor="#065f46" />
      </linearGradient>
    </defs>
    {/* gold foil cap */}
    <rect x="25" y="3" width="10" height="8" rx="2" fill="#f59e0b" stroke="#78350f" strokeWidth="1.4" />
    {/* neck ring */}
    <rect x="23" y="12" width="14" height="4" rx="1.6" fill="#0d9f6e" />
    {/* neck + shoulders + body */}
    <path
      d="M24 15 C24 26 24 36 24 45 C24 56 12 70 12 86 L12 164 C12 172 17 177 25 177 L35 177 C43 177 48 172 48 164 L48 86 C48 70 36 56 36 45 C36 36 36 26 36 15 Z"
      fill="url(#sbrGlass)"
      stroke="#065f46"
      strokeWidth="1.6"
    />
    {/* label band */}
    <rect x="13.5" y="118" width="33" height="26" rx="3" fill="#fbbf24" opacity="0.28" />
    <rect x="13.5" y="118" width="33" height="26" rx="3" fill="none" stroke="#fcd34d" strokeWidth="1" opacity="0.5" />
    {/* specular highlights */}
    <path d="M17 88 L17 156" stroke="#ffffff" strokeOpacity="0.42" strokeWidth="3" strokeLinecap="round" />
    <path d="M22 26 L22 44" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M43 92 L43 150" stroke="#022c22" strokeOpacity="0.35" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
)

export function RoomBottle({ startRotation, endRotation, duration, spinning, visible = true }: Props) {
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
    <div
      className={`sbr-bottle-layer ${visible ? '' : 'sbr-bottle-hidden'}`}
      aria-hidden={!visible}
    >
      <div className="sbr-bottle-glow" aria-hidden />
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
