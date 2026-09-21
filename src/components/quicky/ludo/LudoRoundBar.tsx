'use client'

// Quicky — LUDO ROUND BAR (Ludo PRD §30/§32/§44 REVISED + animation-sync revision)
//
// The old dice+button controls bar is GONE: the dice are a SERVER action
// (there is no roll button) and the 3D die now floats OVER the board while it
// rolls, then disappears — exactly like the bottle in Spin the Bottle.
// What remains at the bottom of the table is ONE slim hint line that:
//   · shows the LAST ROLL of the round: "Alex rolled 6" — it stays visible
//     until the round moves on (the rolled number is never lost with the die)
//   · carries the 30s VISIBLE move timer as a chip rendered IMMEDIATELY NEXT
//     TO the rolled number (product revision: "You rolled: 6 ⏱24s" — one
//     glance reads value + urgency together, instead of the timer floating
//     detached at the end of the bar)
//   · explains every other phase (waiting / starting / rolling / finished)
//
// ANIMATION SYNC (Unified PRD §41 revision): the timer, the rolled number and
// the coin selectability all flip on the SAME beat — the moment the die lands
// on the server value. While `diceAnimating` is true the bar says the dice is
// rolling and shows NO countdown (the server deadline already excludes the
// reveal window, so the first visible tick is the full 30s).

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
  diceAnimating = false,
  playersJoined = 0,
  maxPlayers = 4,
}: {
  phase: TurnPhase
  /** The last dice result of the round — persists until the round moves on. */
  lastRoll: { name: string; value: number; isMe: boolean } | null
  /** Server-epoch move deadline (dice pending) — drives the visible 30s timer. */
  moveDeadlineAt: number | null
  /** serverNow - clientNow, from the snapshot. */
  serverSkewMs: number
  currentPlayerName: string
  statusText?: string
  /** True while the CURRENT roll's die is still tumbling (pre-reveal): the
   * countdown and the rolled number stay hidden so the bar, the die face and
   * the timer can never tell three different stories. */
  diceAnimating?: boolean
  /** REVISED — mode-aware waiting state lives HERE (on mobile this strip
   * IS the room-state surface; the board overlay stays web-only). */
  playersJoined?: number
  maxPlayers?: number
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
  // §41 sync — the countdown is only honest once the value has LANDED (the
  // server deadline starts at the reveal beat; before that the player cannot
  // act, so nothing counts).
  const rollRevealed = lastRoll != null && !diceAnimating

  let main: string
  if (phase === 'waiting')
    main = `Waiting for players — ${playersJoined}/${maxPlayers} joined · chat is open`
  else if (phase === 'starting') main = 'The table is getting ready…'
  else if (phase === 'finished') main = 'Game over'
  else if (diceAnimating && (phase === 'my_move' || phase === 'my_roll'))
    main = 'Your dice is rolling…'
  else if (diceAnimating) main = `${currentPlayerName}'s dice is rolling…`
  // The rolled NUMBER lives ONLY in the bold accent element below — never
  // baked into the sentence too (it used to render twice: "You rolled 6 6").
  else if (lastRoll) main = `${lastRoll.isMe ? 'You' : lastRoll.name} rolled:`
  else if (phase === 'my_roll') main = 'Your turn — rolling the dice…'
  else main = `${currentPlayerName}'s turn — rolling the dice…`

  // The action hint ("pick a coin" / "deciding") — the countdown itself no
  // longer lives here; it rides the roll chip (next to the number).
  let action: string | null = null
  if (phase === 'my_move' && rollRevealed) action = 'pick a coin'
  else if (phase === 'their_turn' && rollRevealed && moveDeadlineAt != null) action = 'deciding'

  // Product revision — the choice countdown renders NEXT TO the rolled
  // number, inside the same pill: value + urgency in one glance.
  const showInlineTimer =
    rollRevealed && lastRoll != null && secondsLeft != null && phase !== 'finished'

  return (
    <div className="ldo-roundbar" data-testid="ludo-roundbar">
      <span className="ldo-roundbar-main">
        <i className="ldo-roundbar-dice" aria-hidden>🎲</i>
        {main}
        {rollRevealed && lastRoll && (
          <b className="ldo-roundbar-roll" data-testid="ludo-roundbar-roll">
            {lastRoll.value}
          </b>
        )}
        {showInlineTimer && (
          <span
            className={`ldo-roundbar-timer-chip${urgent ? ' ldo-roundbar-urgent' : ''}`}
            data-testid="ludo-move-timer"
            aria-label={`${secondsLeft} seconds left to move`}
          >
            ⏱{secondsLeft}s
          </span>
        )}
      </span>
      {action && <span className="ldo-roundbar-status">{action}</span>}
      {!action && statusText && <span className="ldo-roundbar-status">{statusText}</span>}
    </div>
  )
})
