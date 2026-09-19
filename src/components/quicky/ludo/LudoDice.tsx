'use client'

// Quicky — LUDO DICE (Ludo PRD §14/§15/§55/§103 — ROUND-4 multiplayer PRD
// §18-§21/§53: phase-driven 3D cube)
//
// A true CSS 3D CUBE with six pip faces whose MOTION is owned by the dice
// sequencer's phase machine — one continuous animation, never a boolean pile:
//
//   entering  cube rests, the die fades/scales in (wrapper)
//   rolling   framer tweens rotateX/rotateY through ~2 full turns with an
//             easeOut curve — FAST → MEDIUM → SLOW, physically decelerating
//             (§19/§20) — while the readable face cycles (§13: decoration
//             only, never the result)
//   settling  the cube springs the last half-turn onto the SERVER value's
//             face with a small overshoot bounce (§21)
//   revealed  the server value sits facing the viewer (§14/§15: the final
//             face is ALWAYS the authoritative number)
//   exiting   the wrapper fades the die away (no display:none jumps)
//
// The pip layout is CANONICAL whenever the cube is at/near rest (settling/
// revealed/exiting) so FACE_ORIENTATION lands the exact value; while the
// cube is spinning the faces are re-arranged per readable face — a physical
// tumbling die whose numbers visibly change, not a flat sprite swap.

import { memo } from 'react'
import { motion } from 'framer-motion'
import { DICE_ROLL_MS } from '@/lib/quicky/ludo/constants'
import type { DicePhase } from './useDiceSequencer'

// Pip layouts on a 3×3 grid (indices 0..8, center = 4).
const PIP_LAYOUT: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
}

// Canonical face values (opposite faces always sum to 7). FACE_ORIENTATION
// below is authored against THIS arrangement.
const FACE_VALUES = { front: 1, back: 6, right: 3, left: 4, top: 2, bottom: 5 } as const

// Cube orientation that brings each face toward the viewer (canonical layout).
const FACE_ORIENTATION: Record<number, { x: number; y: number }> = {
  1: { x: 0, y: 0 }, // front
  6: { x: 0, y: 180 }, // back
  3: { x: 0, y: -90 }, // right
  4: { x: 0, y: 90 }, // left
  2: { x: -90, y: 0 }, // top
  5: { x: 90, y: 0 }, // bottom
}

/**
 * Face arrangement while the cube TUMBLES: the front carries the readable
 * face, every other side keeps the classic "opposites sum to 7" feel. At
 * rest the cube switches back to the canonical layout so the settle
 * orientation shows the exact server value.
 */
function sideValues(readable: number, canonical: boolean) {
  if (canonical) return FACE_VALUES
  const right = ((readable + 1) % 6) + 1
  const top = ((readable + 3) % 6) + 1
  return {
    front: readable,
    back: (7 - readable) as 1 | 2 | 3 | 4 | 5 | 6,
    right: right as 1 | 2 | 3 | 4 | 5 | 6,
    left: (7 - right) as 1 | 2 | 3 | 4 | 5 | 6,
    top: top as 1 | 2 | 3 | 4 | 5 | 6,
    bottom: (7 - top) as 1 | 2 | 3 | 4 | 5 | 6,
  }
}

function DiceFace({ side, value }: { side: string; value: number }) {
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

// Roll rotation: ~2 full turns on X and ~1⅓ on Y under easeOut — the cube
// visibly slows INTO the settle instead of fast/fast/fast/STOP (§20).
const ROLL_X = 720
const ROLL_Y = 480

export const LudoDice = memo(function LudoDice({
  phase,
  displayFace,
  value,
  color,
}: {
  phase: DicePhase
  /** Face readable while the cube tumbles (decoration only, §15). */
  displayFace: number
  /** The SERVER value — the only face the cube ever settles on (§14). */
  value: number | null
  /** Current player color — accents the resting dice ring. */
  color: string
}) {
  const atRest = phase === 'settling' || phase === 'revealed' || phase === 'exiting'
  const shown = value ?? displayFace
  const o = FACE_ORIENTATION[shown] ?? FACE_ORIENTATION[1]
  const sides = sideValues(displayFace, atRest)

  const rotate =
    phase === 'entering'
      ? { rotateX: 0, rotateY: 0 }
      : phase === 'rolling'
        ? { rotateX: ROLL_X, rotateY: ROLL_Y }
        : { rotateX: ROLL_X + o.x, rotateY: ROLL_Y + o.y }
  const transition =
    phase === 'rolling'
      ? { duration: DICE_ROLL_MS / 1000, ease: 'easeOut' as const }
      : phase === 'entering'
        ? { duration: 0.22, ease: 'easeOut' as const }
        : // settle: short spring with a tiny physical overshoot (§21)
          { type: 'spring' as const, stiffness: 300, damping: 15, mass: 0.7 }

  return (
    <div
      className={`ldo-dice-scene${phase === 'rolling' ? ' ldo-rolling' : ''}${atRest ? ' ldo-settled' : ''}`}
      style={atRest ? ({ '--ldo-dice-ring': color } as React.CSSProperties) : undefined}
      role="img"
      aria-label={atRest ? `Dice showing ${shown}` : 'Dice rolling'}
      data-testid="ludo-dice"
    >
      <span className="ldo-dice-shadow" aria-hidden />
      <motion.span className="ldo-dice-cube" initial={false} animate={rotate} transition={transition} aria-hidden>
        <DiceFace side="front" value={sides.front} />
        <DiceFace side="back" value={sides.back} />
        <DiceFace side="right" value={sides.right} />
        <DiceFace side="left" value={sides.left} />
        <DiceFace side="top" value={sides.top} />
        <DiceFace side="bottom" value={sides.bottom} />
      </motion.span>
    </div>
  )
})
