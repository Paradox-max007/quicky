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
//   · TOKEN GATE (§18/§22) — `freeAtRef` carries the epoch ms at which the
//     sequence has fully left the table; the board's token animation waits
//     for it, so coins never move while the die is still on screen.

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
  /** True from the settle of the CURRENT roll on — coins become selectable. */
  revealed: boolean
  /** Persisted "Alex: rolled 6" hint for the round bar (survives the exit). */
  hint: DiceHint | null
  /** Epoch ms when the die has fully left the table (token-animation gate). */
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
        // number, hold it briefly, leave. The player can pick immediately.
        // (Deferred one tick — react-hooks v6: no setState in effect bodies.)
        timers.push(
          setTimeout(() => {
            setRollId(rollKey)
            setFinalValue(roll.value)
            setDisplayFace(roll.value)
            setPhase('revealed')
            setRevealed(true)
            setHint({ rollId: rollKey, playerId: roll.playerId, value: roll.value })
            freeAtRef.current = Date.now() + DICE_HOLD_MS + DICE_EXIT_MS
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
    timers.push(
      setTimeout(() => {
        setRollId(rollKey)
        setFinalValue(roll.value)
        setDisplayFace(nextFace(roll.value))
        setPhase('entering')
        setRevealed(false)
        freeAtRef.current = Date.now() + total
      }, 0)
    )

    timers.push(setTimeout(() => setPhase('rolling'), DICE_ENTER_MS))
    const base = DICE_ENTER_MS
    for (const at of faceSchedule()) {
      timers.push(
        setTimeout(() => setDisplayFace((f) => nextFace(f)), base + at)
      )
    }
    // Resolve to the SERVER value exactly here — never before (§16).
    timers.push(
      setTimeout(() => {
        setDisplayFace(roll.value)
        setPhase('settling')
      }, base + DICE_ROLL_MS)
    )
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
