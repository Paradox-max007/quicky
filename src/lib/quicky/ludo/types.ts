// Quicky — LUDO TYPES (Ludo PRD §11/§45/§46/§83)
//
// The shared, dependency-free type layer for the 4-player room-based Ludo
// game. Imported by the SERVER (authoritative state machine), the CLIENT
// (board rendering + animation) and the TEST SUITE — there is exactly ONE
// rule definition in the repo (PRD §85: no drifting client/server rules).
//
// Pure TypeScript: no React, no DB, no IO anywhere in src/lib/quicky/ludo/.

export type LudoColor = 'red' | 'green' | 'yellow' | 'blue'

/** Ludo PRD §6 — the color is determined by the SEAT, not the user. */
export type LudoSeat = 0 | 1 | 2 | 3

/**
 * Ludo PRD §11 — token state machine:
 *   yard     = token inside the player's home yard
 *   track    = token on the shared 52-cell path
 *   home     = token on the player's private colored home path
 *   finished = token reached the final center
 */
export type LudoTokenState = 'yard' | 'track' | 'home' | 'finished'

/**
 * Ludo PRD §11 — every token carries its identity + progression.
 * `position` encoding (shared with board.ts / rules.ts):
 *   -1        → yard
 *   0..50     → shared track step (cell = ring[(START_OFFSET[color] + step) % 52])
 *   51..55    → home path cell 0..4
 *   56        → finished (center)
 */
export type LudoToken = {
  id: string
  playerId: string
  color: LudoColor
  index: 0 | 1 | 2 | 3
  state: LudoTokenState
  position: number
}

/** Ludo PRD §46 — player state as stored inside the authoritative snapshot. */
export type LudoPlayerStatus =
  | 'waiting'
  | 'ready'
  | 'playing'
  | 'disconnected'
  | 'left'
  | 'winner'

export type LudoPlayer = {
  userId: string
  seat: LudoSeat
  color: LudoColor
  displayName: string
  avatar: string | null
  status: LudoPlayerStatus
  tokensFinished: number
  /** Lifetime-of-this-game capture counter (Ludo PRD §74 "Captures"). */
  captures: number
}

/**
 * Ludo PRD §52/§54 — typed realtime events. The authoritative state always
 * rides the snapshot; events describe WHAT HAPPENED so every client can play
 * the same animation (PRD §53: server transition → client animation, never
 * the other way round).
 */
export type LudoGameEvent =
  | { type: 'dice_rolled'; playerId: string; dice: number }
  | { type: 'no_moves'; playerId: string; dice: number }
  | { type: 'six_cancelled'; playerId: string }
  | {
      type: 'token_moved'
      playerId: string
      tokenId: string
      from: number
      to: number
      steps: number
    }
  | { type: 'token_captured'; playerId: string; tokenId: string; byPlayerId: string }
  | { type: 'token_finished'; playerId: string; tokenId: string }
  | { type: 'extra_turn'; playerId: string }
  | { type: 'turn_changed'; playerId: string | null }
  | { type: 'turn_skipped'; playerId: string; reason: 'timeout' | 'left' }
  | { type: 'game_finished'; winnerId: string; winnerName: string }

/**
 * Ludo PRD §45 — server state. `version` is the stateVersion every mutation
 * increments (§51): clients ignore stale versions and reconcile on gaps.
 */
export type LudoGameState = {
  version: number
  status: 'waiting' | 'starting' | 'playing' | 'finished'
  players: LudoPlayer[]
  currentPlayerId: string | null
  turnNumber: number
  dice: {
    value: number | null
    rolledBy: string | null
    rolledAt: number | null
  }
  sixStreak: number
  tokens: LudoToken[]
  winnerId: string | null
  lastActionId: string | null
  lastActionAt: number
  /** Watchdog (Ludo PRD §42-§44): roll deadline for the current player. */
  turnDeadlineAt: number | null
  /** Watchdog: move deadline once a dice is pending. */
  moveDeadlineAt: number | null
  startedAt: number | null
  endedAt: number | null
  /** Last event emitted — clients diff `version` + this to animate once. */
  lastEvent: LudoGameEvent | null
}

export type LudoLegalMove = {
  tokenId: string
  from: number
  to: number
  /** Opponent token ids sent back to the yard when this move lands. */
  captures: string[]
  /** True when this move lands the token exactly on the finish step. */
  finishes: boolean
}

export type LudoEngineError =
  | 'not_your_turn'
  | 'dice_pending'
  | 'no_dice'
  | 'game_not_playing'
  | 'unknown_token'
  | 'not_your_token'
  | 'illegal_move'
  | 'unknown_player'

export type EngineResult =
  | { ok: true; state: LudoGameState; events: LudoGameEvent[] }
  | { ok: false; error: LudoEngineError }

/** Result payloads for the roll/move HTTP APIs (Ludo PRD §48/§49). */
export type LudoRollResponse = {
  ok: true
  dice: number
  legalMoves: LudoLegalMove[]
  stateVersion: number
  state: LudoGameState
}

export type LudoMoveResponse = {
  ok: true
  stateVersion: number
  state: LudoGameState
}
