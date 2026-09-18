'use client'

// Quicky — LUDO ROUND BAR (Ludo PRD §30/§32/§44 REVISED)
//
// The old dice+button controls bar is GONE: the dice are a SERVER action
// (there is no roll button) and the 3D die now floats OVER the board while
// it rolls, then disappears — exactly like the bottle in Spin the Bottle.
// What remains at the bottom of the table is ONE slim hint line that:
//   · shows the LAST ROLL of the round: "Alex: rolled 6" — it stays visible
//     until the round moves on (the rolled number is never lost with the die)
//   · carries the 45s VISIBLE move timer ("pick a coin — 32s") that ticks
//     down while a dice is pending; the last 10s glow red
//   · explains every other phase (waiting / starting / rolling / finished)

import { memo, useEffect, useState } from 'react'

export type TurnPhase =
  | 'waiting'
  | 'starting'
  | 'my_roll'
  | 'my_move'
  | 'their_turn'
  | 'finished'

export const LudoRoundBar = memo(function LudoRoundBar({
  phase,
  lastRoll,
  moveDeadlineAt,
  serverSkewMs,
  currentPlayerName,
  statusText,
}: {
  phase: TurnPhase
  /** The last dice result of the round — persists until the round moves on. */
  lastRoll: { name: string; value: number; isMe: boolean } | null
  /** Server-epoch move deadline (dice pending) — drives the visible 45s timer. */
  moveDeadlineAt: number | null
  /** serverNow - clientNow, from the snapshot. */
  serverSkewMs: number
  currentPlayerName: string
  statusText?: string
}) {
  // Ticking countdown — 250ms cadence keeps the seconds honest without churn.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (phase !== 'my_move' && phase !== 'their_turn') return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [phase])

  const secondsLeft =
    moveDeadlineAt != null ? Math.max(0, Math.ceil((moveDeadlineAt - serverSkewMs - now) / 1000)) : null
  const urgent = secondsLeft != null && secondsLeft <= 10

  let main: string
  if (phase === 'waiting') main = 'Waiting for players — the table needs 2'
  else if (phase === 'starting') main = 'The table is getting ready…'
  else if (phase === 'finished') main = 'Game over'
  else if (lastRoll) main = `${lastRoll.isMe ? 'You' : lastRoll.name}: rolled ${lastRoll.value}`
  else if (phase === 'my_roll') main = 'Your turn — rolling the dice…'
  else main = `${currentPlayerName}'s turn — rolling the dice…`

  let action: string | null = null
  if (phase === 'my_move') action = 'pick a coin'
  else if (phase === 'their_turn' && moveDeadlineAt != null) action = 'deciding'

  return (
    <div className="ldo-roundbar" data-testid="ludo-roundbar">
      <span className="ldo-roundbar-main">
        <i className="ldo-roundbar-dice" aria-hidden>🎲</i>
        {main}
      </span>
      {action && secondsLeft != null && (
        <span
          className={`ldo-roundbar-timer${urgent ? ' ldo-roundbar-urgent' : ''}`}
          data-testid="ludo-move-timer"
        >
          {action} · {secondsLeft}s
        </span>
      )}
      {!action && statusText && <span className="ldo-roundbar-status">{statusText}</span>}
    </div>
  )
})
