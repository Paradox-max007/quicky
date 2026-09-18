'use client'

// Quicky — LUDO DICE (Ludo PRD §14/§15/§55/§103 — REVISED: real-world 3D dice)
//
// A true CSS 3D CUBE with six pip faces that TUMBLES like a real die and
// settles on the server's value (§14/§106 — the client only renders; the
// value always comes from the server). While rolling, the cube spins on two
// axes with a bouncing hop; when the value lands, the cube tumbles to the
// matching face with a physical overshoot ease and an extra full turn per
// roll, so every roll animates even when the same number repeats.
// When ANOTHER player rolls, everyone sees the same animation (§55).

import { memo, useEffect, useRef, useState } from 'react'

// Pip layouts on a 3×3 grid (indices 0..8, center = 4).
const PIP_LAYOUT: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
}

// Which face carries which value (front/back, right/left, top/bottom —
// classic die: opposite faces always sum to 7).
const FACE_VALUES = { front: 1, back: 6, right: 3, left: 4, top: 2, bottom: 5 } as const

// Cube orientation that brings each face toward the viewer. Extra 360°
// multiples are added per roll so the settle ALWAYS animates a fresh tumble.
const FACE_ORIENTATION: Record<number, { x: number; y: number }> = {
  1: { x: 0, y: 0 }, // front
  6: { x: 0, y: 180 }, // back
  3: { x: 0, y: -90 }, // right
  4: { x: 0, y: 90 }, // left
  2: { x: -90, y: 0 }, // top
  5: { x: 90, y: 0 }, // bottom
}

function DiceFace({ side, value }: { side: keyof typeof FACE_VALUES; value: number }) {
  const pips = PIP_LAYOUT[value] ?? PIP_LAYOUT[1]
  const sideTransform: Record<string, string> = {
    front: 'translateZ(var(--ldo-dice-half))',
    back: 'rotateY(180deg) translateZ(var(--ldo-dice-half))',
    right: 'rotateY(90deg) translateZ(var(--ldo-dice-half))',
    left: 'rotateY(-90deg) translateZ(var(--ldo-dice-half))',
    top: 'rotateX(90deg) translateZ(var(--ldo-dice-half))',
    bottom: 'rotateX(-90deg) translateZ(var(--ldo-dice-half))',
  }
  return (
    <span className="ldo-dice-face" style={{ transform: sideTransform[side] }} aria-hidden>
      {Array.from({ length: 9 }, (_, i) => (
        <i key={i} className={`ldo-pip${pips.includes(i) ? '' : ' off'}`} />
      ))}
    </span>
  )
}

export const LudoDice = memo(function LudoDice({
  value,
  rolling,
  color,
}: {
  value: number | null
  rolling: boolean
  /** Current player color — accents the resting dice ring. */
  color: string
}) {
  // Every new roll adds a full extra turn so the settle animation always
  // plays, even when the value repeats. (State, not a ref — the settle
  // transform is read during render.)
  const [rollCount, setRollCount] = useState(0)
  const prevRollingRef = useRef(false)

  useEffect(() => {
    const wasRolling = prevRollingRef.current
    prevRollingRef.current = rolling
    if (!rolling || wasRolling) return
    // Deferred (react-hooks v6: no synchronous setState in effect bodies).
    const t = setTimeout(() => setRollCount((n) => n + 1), 0)
    return () => clearTimeout(t)
  }, [rolling])

  const shown = value ?? 1
  const o = FACE_ORIENTATION[shown] ?? FACE_ORIENTATION[1]
  const turns = rollCount * 360
  const settle = `rotateX(${o.x + turns}deg) rotateY(${o.y + turns}deg)`

  return (
    <div
      className={`ldo-dice-scene${rolling ? ' ldo-rolling' : ''}`}
      style={value && !rolling ? ({ '--ldo-dice-ring': color } as React.CSSProperties) : undefined}
      role="img"
      aria-label={value ? `Dice showing ${value}` : 'Dice ready'}
      data-testid="ludo-dice"
    >
      <span className="ldo-dice-shadow" aria-hidden />
      <span
        className="ldo-dice-cube"
        style={rolling ? undefined : ({ transform: settle } as React.CSSProperties)}
        aria-hidden
      >
        <DiceFace side="front" value={FACE_VALUES.front} />
        <DiceFace side="back" value={FACE_VALUES.back} />
        <DiceFace side="right" value={FACE_VALUES.right} />
        <DiceFace side="left" value={FACE_VALUES.left} />
        <DiceFace side="top" value={FACE_VALUES.top} />
        <DiceFace side="bottom" value={FACE_VALUES.bottom} />
      </span>
    </div>
  )
})
