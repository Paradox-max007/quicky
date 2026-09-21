'use client'

// Quicky — TURN ALERT SOURCES (in-game notification layer, reusable registry)
//
// ONE generic "your game needs you" notification card (TurnAlertCard) is
// driven by THIS registry. Every game that keeps a live runtime while the
// user browses other screens registers a source here and gets, for free:
//
//   · a slide-down alert whenever it is the player's turn while they are NOT
//     on the game screen — with Dismiss + Go to Game buttons
//   · "Go to Game" returning to the live game AT THE EXACT ROUND (the room
//     runtime never detached, so the board re-renders the authoritative state)
//   · a compact "your turn — Ns" pill after dismissal, so the player can
//     always jump back while the game runs
//   · per-turn re-arm (a NEW turn re-shows the card), haptic, and the
//     server-authoritative countdown
//
// HOW TO ADD A NEW GAME (the whole integration):
//   1. write a `useAlertState(): TurnAlertState | null` hook reading your
//      game's room store (snapshot + my-turn + deadline + navigate),
//   2. push `{ gameId, useAlertState }` into TURN_ALERT_SOURCES below.
// Nothing else — GameAlertCenter + TurnAlertCard do the rest.
//
// Spin the Bottle keeps its own richer GameDecisionDrawer (kiss/no-thanks
// actions + result drawers), so it is not duplicated here.

import { useMemo } from 'react'
import { useQuickyStore } from '@/store/quicky'
import { useLudoRoomStore } from '@/store/ludo-room'

export type TurnAlertState = {
  /** Stable id of the CURRENT turn — dismissal + re-arm are keyed on it
   *  (the same pattern the Spin Bottle decision drawer uses per spin id). */
  turnKey: string
  /** Short card title, e.g. "Your turn". */
  title: string
  /** One-line body, e.g. "You rolled 6 — pick a coin". */
  detail: string
  /** Round label shown on the card, e.g. "Round 12". */
  roundLabel: string
  /** Server-epoch deadline for the choice — drives the live countdown.
   *  Null while the turn has no countdown yet (pre-roll). */
  deadlineMs: number | null
  /** Server-clock skew sampler (serverNow - clientNow) from the game's
   *  runtime — keeps the countdown honest like the in-room timers. */
  getSkewMs: () => number
  /** Navigate straight back to the live game at the exact current round. */
  goToGame: () => void
}

export type TurnAlertSource = {
  gameId: string
  /** Game name shown in a11y labels / fallbacks. */
  label: string
  /** Emoji glyph for the card. */
  emoji: string
  /** The view that IS the game screen — the alert hides while on it. */
  gameView: string
  useAlertState: () => TurnAlertState | null
}

// ── LUDO source ─────────────────────────────────────────────────────────────
export function useLudoAlertState(): TurnAlertState | null {
  const view = useQuickyStore((s) => s.view)
  const meId = useQuickyStore((s) => s.user?.id ?? '')
  const ludoRoomId = useQuickyStore((s) => s.ludoRoomId)
  const roomId = useLudoRoomStore((s) => s.roomId)
  const snapshot = useLudoRoomStore((s) => s.snapshot)

  return useMemo(() => {
    // The runtime must be attached (it never detaches while navigating —
    // the module controller keeps streaming in personal chats etc).
    const activeRoomId = roomId ?? ludoRoomId
    if (!activeRoomId) return null
    if (view === 'ludo-room') return null // on the game screen — no alert
    const game = snapshot?.game
    if (!game || game.status !== 'playing') return null
    if (snapshot.status === 'CLOSING') return null
    // My turn only — the alert is actionable ("pick a coin"), exactly like
    // the Spin Bottle drawer that arms when the user is the decision maker.
    if (game.currentPlayerId !== meId) return null

    const dicePending = game.dice?.value != null
    // Countdown only while a dice is pending — the pre-roll autoroll beat
    // (~1.5s) is not a decision the player can influence, so no countdown.
    const deadline = dicePending ? game.moveDeadlineAt ?? null : null
    return {
      turnKey: game.turnId ?? `turn_${game.turnNumber}`,
      title: 'Your turn',
      detail: dicePending
        ? `You rolled ${game.dice?.value} — pick a coin`
        : 'Dice rolling — get back to the board',
      roundLabel: `Round ${game.turnNumber}`,
      deadlineMs: deadline,
      getSkewMs: () => useLudoRoomStore.getState().getSkew(),
      goToGame: () => {
        // The room runtime stayed attached: setView lands the user back on
        // the live board at the EXACT round (turn, dice, token positions all
        // render from the authoritative snapshot).
        const qk = useQuickyStore.getState()
        if (!qk.ludoRoomId) qk.setLudoRoomId(activeRoomId)
        qk.setView('ludo-room')
      },
    }
  }, [view, meId, ludoRoomId, roomId, snapshot])
}

/** The registry every turn-based game plugs into. New games: add a source. */
export const TURN_ALERT_SOURCES: TurnAlertSource[] = [
  {
    gameId: 'ludo',
    label: 'Quicky Ludo',
    emoji: '🎲',
    gameView: 'ludo-room',
    useAlertState: useLudoAlertState,
  },
]

/** Exported for tests/QA: the ludo source hook on its own. */
export const useLudoTurnAlert = useLudoAlertState
