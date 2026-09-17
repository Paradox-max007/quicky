'use client'

// Quicky — LUDO DICE (Ludo PRD §14/§15/§55/§103)
//
// The dice face. The VALUE always comes from the server (§14/§106 — the
// client only renders); the shake/rotate animation is pure presentation.
// When ANOTHER player rolls, everyone sees the same animation (§55).

import { memo } from 'react'

const PIP_LAYOUT: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
}

export const LudoDice = memo(function LudoDice({
  value,
  rolling,
  color,
}: {
  value: number | null
  rolling: boolean
  /** Current player color — accents the face shadow while their dice shows. */
  color: string
}) {
  const pips = PIP_LAYOUT[1]
  const shown = PIP_LAYOUT[value ?? 1] ?? pips
  return (
    <div
      className={`ldo-dice${rolling ? ' ldo-rolling' : ''}`}
      style={value ? { boxShadow: `0 4px 12px rgba(0,0,0,0.45), 0 0 0 2px ${color}` } : undefined}
      role="img"
      aria-label={value ? `Dice showing ${value}` : 'Dice ready'}
      data-testid="ludo-dice"
    >
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={`ldo-pip${shown.includes(i) ? '' : ' off'}`} aria-hidden />
      ))}
    </div>
  )
})
