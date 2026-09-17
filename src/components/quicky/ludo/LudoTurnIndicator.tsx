'use client'

// Quicky — LUDO TURN INDICATOR (Ludo PRD §30/§32/§93/§95)
//
// The status line + ROLL DICE control. States:
//   my turn, no dice yet → big enabled "ROLL DICE"
//   my turn, dice pending → "Pick a token" (the board highlights are live)
//   other player's turn → "Alex is rolling…" + disabled control
//   waiting (fewer than 2 players) → "Waiting for more players" (§95)
//   starting → the countdown overlay covers gameplay (§56/§93)

import { memo } from 'react'

export type TurnPhase =
  | 'waiting'
  | 'starting'
  | 'my_roll'
  | 'my_move'
  | 'their_turn'
  | 'finished'

export const LudoTurnIndicator = memo(function LudoTurnIndicator({
  phase,
  dice,
  rolling,
  currentPlayerName,
  onRoll,
  statusText,
}: {
  phase: TurnPhase
  dice: number | null
  rolling: boolean
  currentPlayerName: string
  onRoll: () => void
  statusText?: string
}) {
  return (
    <div className="ldo-controls-wrap">
      <div className="ldo-controls">
        <LudoDiceSlot phase={phase} dice={dice} rolling={rolling} currentPlayerName={currentPlayerName} />
        {phase === 'my_roll' && (
          <button className="ldo-roll-btn" onClick={onRoll} disabled={rolling} data-testid="ludo-roll">
            {rolling ? 'Rolling…' : '🎲 ROLL DICE'}
          </button>
        )}
        {phase === 'my_move' && (
          <button className="ldo-roll-btn" disabled data-testid="ludo-pick">
            Pick a token
          </button>
        )}
        {phase === 'their_turn' && (
          <button className="ldo-roll-btn" disabled data-testid="ludo-wait">
            {currentPlayerName} is rolling…
          </button>
        )}
        {phase === 'waiting' && (
          <button className="ldo-roll-btn" disabled data-testid="ludo-waiting">
            Waiting for players
          </button>
        )}
        {phase === 'finished' && (
          <button className="ldo-roll-btn" disabled data-testid="ludo-finished">
            Game over
          </button>
        )}
      </div>
      {statusText && <p className="ldo-status-line">{statusText}</p>}
    </div>
  )
})

// Local import shim so the file list matches the PRD (§81: LudoDice.tsx).
import { LudoDice } from './LudoDice'

function LudoDiceSlot({
  phase,
  dice,
  rolling,
}: {
  phase: TurnPhase
  dice: number | null
  rolling: boolean
  currentPlayerName: string
}) {
  return <LudoDice value={dice} rolling={rolling || phase === 'their_turn' && dice === null} color="var(--qk-accent)" />
}
