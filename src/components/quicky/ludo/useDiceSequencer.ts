'use client'

// Quicky — LUDO DICE SEQUENCER (ROUND-4 multiplayer PRD §13/§16-§21/§26/§27/
// §52/§53)
//
// The dice is ONE continuous client-side animation state machine — never a
// pile of unrelated booleans (§26/§53: that is exactly what produced the old
// "suddenly appears / suddenly disappears" dice):
//
//   hidden → entering → rolling → settling → revealed → exiting → hidden
//             fade in   faces      slow to    server     fade out
//                       cycle      the value  value hold
//
// Hard rules honoured here:
//   · THE FINAL FACE IS THE SERVER'S VALUE (§14/§15) — the faces cycled
//     during the roll are pure decoration and are never the "result".
//   · THE RESULT IS HIDDEN UNTIL SETTLE (§13/§16) — `finalValue` is known
//     internally from the start, but the cube only lands on it in the
//     settling phase; `revealed` (the token-selection gate) opens there.
//   · DEDUPE (§27) — every roll carries a unique rollId; a redelivered or
//     replayed snapshot NEVER plays the sequence twice.
//   · LATE MOUNT (§52/§93) — the FIRST roll a freshly mounted client sees is
//     never replayed as a full animation. If that roll's dice is still
//     pending the sequencer snaps straight to `revealed` (show the
//     authoritative number, resume the phase); otherwise it stays hidden.
//   · GAME STATE ≠ VISUAL STATE (§51) — this hook owns presentation only;
//     the authoritative game (version/tokens/dice) flows untouched beside
//     it, and an interrupted animation can always recover from state.
//   · TOKEN GATE (§18/§41) — `freeAtRef` carries the epoch ms at which the
//     die has LANDED on the server value (DICE_REVEAL_MS): from that beat
//     the number is readable, the timer is running and coin movement is
//     allowed. Coins never move under a still-rolling/settling die, but
//     they no longer wait for the full exit either — with the 5s sequence
//     that wait left a ~1.65s dead gap between tap and movement (the
//     "desync" feel) and pushed the hop animation into the NEXT roll's
//     die entrance. The die still owns its own exit timeline (§40: the
//     exit choreography always completes, untouched by the tap).

import { useEffect, useRef, useState } from 'react'
import {
  DICE_ENTER_MS,
  DICE_EXIT_MS,
  DICE_HOLD_MS,
  DICE_ROLL_MS,
  DICE_SETTLE_MS,
} from '@/lib/quicky/ludo/constants'
import type { LudoRollRecord } from '@/lib/quicky/ludo/types'

export type DicePhase =
  | 'hidden'
  | 'entering'
  | 'rolling'
  | 'settling'
  | 'revealed'
  | 'exiting'

export type DiceHint = {
  rollId: string
  playerId: string
  value: number
}

export type DiceSequencer = {
  phase: DicePhase
  /** The face currently readable on the cube (cycles while rolling). */
  displayFace: number
  /** The authoritative server value — null before the first live roll. */
  finalValue: number | null
  rollId: string | null
  /** True from the LANDING beat of the CURRENT roll on (= DICE_REVEAL_MS,
   * the same beat the server starts the 30s window) — coins become
   * selectable exactly when the number and the timer appear. */
  revealed: boolean
  /** Persisted "Alex: rolled 6" hint for the round bar (survives the exit). */
  hint: DiceHint | null
  /** Epoch ms when the die has LANDED on the server value (= the reveal
   * beat). Coin movement is allowed from this beat; the die's own exit
   * timeline continues independently. */
  freeAtRef: React.MutableRefObject<number>
}

/**
 * Decelerating face-swap schedule (multiplayer PRD §20 — FAST → MEDIUM →
 * SLOW → SETTLE): the interval between readable faces grows geometrically
 * until it fills the roll window. The LAST face before settle is swapped by
 * the settle timer itself, so the cycle always ends on the server value.
 */
function faceSchedule(): number[] {
  const times: number[] = []
  let t = 0
  let step = 95
  while (t + step < DICE_ROLL_MS - 120) {
    t += step
    times.push(t)
    step *= 1.34
  }
  return times
}

/** A random face ≠ the current one — repeated faces read as a frozen die. */
function nextFace(current: number): number {
  let f = 1 + Math.floor(Math.random() * 6)
  if (f === current) f = ((f + 1 + Math.floor(Math.random() * 5)) % 6) + 1
  return f
}

export function useDiceSequencer(
  roll: LudoRollRecord | null | undefined,
  /** True while the authoritative dice is still pending (a move is owed). */
  pendingDice: boolean
): DiceSequencer {
  const [phase, setPhase] = useState<DicePhase>('hidden')
  const [displayFace, setDisplayFace] = useState(1)
  const [finalValue, setFinalValue] = useState<number | null>(null)
  const [rollId, setRollId] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [hint, setHint] = useState<DiceHint | null>(null)
  const lastSeenRef = useRef<string | null>(null)
  const freeAtRef = useRef(0)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  // ROUND-4 FIX — pendingDice is read through a REF, never as an effect
  // dependency. The coin tap consumes the authoritative dice MID-SEQUENCE
  // (the player picks during the hold); with pendingDice as a dep that flip
  // re-ran this effect, its CLEANUP cancelled the exit/hidden timers, and
  // the same-rollId early-return scheduled nothing new → the die froze on
  // the table until the next roll (and re-entered with an ugly reverse
  // spin). The exit choreography must ALWAYS complete: the sequence is
  // keyed by the rollId alone.
  const pendingDiceRef = useRef(pendingDice)
  useEffect(() => {
    // Declared BEFORE the sequencer effect so the freshest pendingDice is
    // already in the ref when a new rollId lands in the same commit.
    pendingDiceRef.current = pendingDice
  }, [pendingDice])

  useEffect(() => {
    const clearTimers = () => {
      timersRef.current.forEach(clearTimeout)
      timersRef.current = []
    }
    const rollKey = roll?.rollId ?? null
    if (!roll || !rollKey || rollKey === lastSeenRef.current) return

    const firstSight = lastSeenRef.current === null
    lastSeenRef.current = rollKey
    clearTimers()
    const timers = timersRef.current

    if (firstSight) {
      // Reconnect / refresh / rejoin — never replay history as theatre.
      if (pendingDiceRef.current) {
        // The dice of THIS roll is still owed → snap to the authoritative
        // number, hold it briefly, leave. The player can pick immediately —
        // the die is already ON the server face, so the coin-move gate opens
        // NOW (the die's own fade-out continues in parallel).
        // (Deferred one tick — react-hooks v6: no setState in effect bodies.)
        timers.push(
          setTimeout(() => {
            setRollId(rollKey)
            setFinalValue(roll.value)
            setDisplayFace(roll.value)
            setPhase('revealed')
            setRevealed(true)
            setHint({ rollId: rollKey, playerId: roll.playerId, value: roll.value })
            freeAtRef.current = Date.now()
          }, 0)
        )
        timers.push(setTimeout(() => setPhase('exiting'), DICE_HOLD_MS))
        timers.push(
          setTimeout(() => {
            setPhase('hidden')
            setRevealed(false)
            freeAtRef.current = 0
          }, DICE_HOLD_MS + DICE_EXIT_MS)
        )
      }
      return clearTimers
    }

    // LIVE roll — the full continuous sequence. The start is deferred one
    // tick (react-hooks v6 rule); every later beat is already timer-driven.
    const total =
      DICE_ENTER_MS + DICE_ROLL_MS + DICE_SETTLE_MS + DICE_HOLD_MS + DICE_EXIT_MS
    const landMs = DICE_ENTER_MS + DICE_ROLL_MS + DICE_SETTLE_MS // = DICE_REVEAL_MS
    timers.push(
      setTimeout(() => {
        setRollId(rollKey)
        setFinalValue(roll.value)
        setDisplayFace(nextFace(roll.value))
        setPhase('entering')
        setRevealed(false)
        // Coin-move gate opens at the LANDING beat — the same beat the
        // number, the coin selectability and the 30s timer flip (§41).
        freeAtRef.current = Date.now() + landMs
      }, 0)
    )

    timers.push(setTimeout(() => setPhase('rolling'), DICE_ENTER_MS))
    const base = DICE_ENTER_MS
    for (const at of faceSchedule()) {
      timers.push(
        setTimeout(() => setDisplayFace((f) => nextFace(f)), base + at)
      )
    }
    // ═══ THE SYNC ANCHOR (Unified PRD §41 revision) ═══ The tumble ends and
    // the die begins its landing: the display target becomes the SERVER value
    // (never before — §16) and the 3D slerp aligns to that face THROUGH the
    // settle. Nothing the player READS flips yet — the number, the coin gate
    // and the timer all wait for the landing beat below, so they can never
    // disagree with the die face on any device.
    timers.push(
      setTimeout(() => {
        setDisplayFace(roll.value)
        setPhase('settling')
      }, base + DICE_ROLL_MS)
    )
    // ═══ THE LANDING BEAT = DICE_REVEAL_MS (enter + roll + settle) ═══ The die
    // is now RESTING on the server value — this is the exact beat the server
    // starts the 30s move window (moveDeadlineAt = roll + DICE_REVEAL_MS +
    // TURN_MOVE_TIMEOUT_MS). EVERYTHING the player reads flips TOGETHER here:
    //   · the persistent "{name}: rolled {n}" hint appears (round bar),
    //   · the coins become selectable (`revealed`),
    //   · the visible countdown starts its first honest 30s tick.
    timers.push(
      setTimeout(() => {
        setPhase('revealed')
        setRevealed(true)
        setHint({ rollId: rollKey, playerId: roll.playerId, value: roll.value })
      }, base + DICE_ROLL_MS + DICE_SETTLE_MS)
    )
    timers.push(
      setTimeout(
        () => setPhase('exiting'),
        base + DICE_ROLL_MS + DICE_SETTLE_MS + DICE_HOLD_MS
      )
    )
    timers.push(
      setTimeout(() => {
        setPhase('hidden')
        setRevealed(false)
        freeAtRef.current = 0
      }, base + total)
    )
    return clearTimers
  }, [roll?.rollId])

  return { phase, displayFace, finalValue, rollId, revealed, hint, freeAtRef }
}
