// Quicky — LUDO RULES ENGINE (Ludo PRD §12-§27/§58/§83/§85)
//
// The DETERMINISTIC PURE game engine: no React, no DB, no IO, no clocks.
// Every function takes an immutable state and returns a NEW state — the
// server (authoritative) and the client (prediction/highlights) and the
// tests all run THIS exact code (PRD §85: one shared rule source).
//
// Classic rule set implemented here:
//   §13  a token leaves the yard only on a 6 → lands on its start cell
//   §16  rolling a 6 grants another roll (even with no legal move)
//   §17  three consecutive 6s → the third is cancelled, turn passes
//   §21  landing on opponent token(s) on a NON-SAFE cell captures them
//   §22  tokens on safe squares can never be captured
//   §24  track → home path → center progression
//   §25  EXACT finish: overshooting the center is illegal
//   §27  4/4 tokens finished → winner, status finished
//   §58  turn order = seat order RED→GREEN→YELLOW→BLUE, skipping empty/left

import {
  FINISH_STEP,
  HOME_ENTRY,
  SEAT_COLORS,
  SIX_STREAK_LIMIT,
  START_COUNTDOWN_MS,
  TOKENS_PER_PLAYER,
  TURN_AUTOROLL_DELAY_MS,
  TURN_MOVE_TIMEOUT_MS,
  colorForSeat,
  isSafeRingCell,
} from './constants'
import { ringIndexForStep } from './board'
import type {
  EngineResult,
  LudoColor,
  LudoGameEvent,
  LudoGameState,
  LudoLegalMove,
  LudoPlayer,
  LudoSeat,
  LudoToken,
} from './types'

// ── Factories ────────────────────────────────────────────────────────────────

function tokensForPlayer(player: Pick<LudoPlayer, 'userId' | 'color'>): LudoToken[] {
  return Array.from({ length: TOKENS_PER_PLAYER }, (_, i) => ({
    id: `${player.color}-${i + 1}`,
    playerId: player.userId,
    color: player.color,
    index: i as 0 | 1 | 2 | 3,
    state: 'yard' as const,
    position: -1,
  }))
}

/**
 * Fresh state for a lobby (Ludo PRD §45/§93). Players are seated in seat
 * order; every token starts in its yard. status 'waiting' until the server
 * starts the game (≥ 2 players, §5).
 */
export function createGameState(players: Pick<LudoPlayer, 'userId' | 'seat' | 'displayName' | 'avatar'>[]): LudoGameState {
  const seated = [...players].sort((a, b) => a.seat - b.seat).map<LudoPlayer>((p) => ({
    userId: p.userId,
    seat: p.seat as LudoSeat,
    color: colorForSeat(p.seat),
    displayName: p.displayName,
    avatar: p.avatar,
    status: 'ready',
    tokensFinished: 0,
    captures: 0,
  }))
  return {
    version: 1,
    status: 'waiting',
    players: seated,
    currentPlayerId: null,
    turnNumber: 0,
    dice: { value: null, rolledBy: null, rolledAt: null },
    sixStreak: 0,
    tokens: seated.flatMap((p) => tokensForPlayer(p)),
    winnerId: null,
    lastActionId: null,
    lastActionAt: 0,
    turnDeadlineAt: null,
    moveDeadlineAt: null,
    startedAt: null,
    endedAt: null,
    lastEvent: null,
  }
}

/** Deep clone helper — engine functions never mutate their input. */
function clone(state: LudoGameState): LudoGameState {
  return typeof structuredClone === 'function'
    ? structuredClone(state)
    : (JSON.parse(JSON.stringify(state)) as LudoGameState)
}

function nowPatch(state: LudoGameState, actionId: string) {
  state.version += 1
  state.lastActionId = actionId
  state.lastActionAt = Date.now()
}

// ── Turn flow (Ludo PRD §58: seat order, skip empty/left) ───────────────────

function activePlayers(state: LudoGameState): LudoPlayer[] {
  return state.players
    .filter((p) => p.status === 'playing' || p.status === 'ready' || p.status === 'disconnected')
    .sort((a, b) => a.seat - b.seat)
}

function nextPlayerAfter(state: LudoGameState, seat: number): LudoPlayer | null {
  const active = activePlayers(state)
  if (active.length === 0) return null
  const idx = active.findIndex((p) => p.seat > seat)
  return idx === -1 ? active[0] : active[idx]
}

function armTurn(state: LudoGameState, playerId: string | null, now: number) {
  state.currentPlayerId = playerId
  state.dice = { value: null, rolledBy: null, rolledAt: null }
  state.moveDeadlineAt = null
  // §14 revised — the deadline is the SERVER'S OWN auto-roll beat: the user
  // never rolls, the server throws the dice for them after this delay.
  state.turnDeadlineAt = playerId ? now + TURN_AUTOROLL_DELAY_MS : null
}

/**
 * Start the game (server only, ≥ LUDO_MIN_PLAYERS connected — PRD §5/§56):
 * picks the first player at random among active players (§57 — decided
 * HERE, once, server-side; clients never compute a different first player).
 */
export function startGame(
  prev: LudoGameState,
  rng: () => number = Math.random,
  now: number = Date.now()
): LudoGameState {
  const state = clone(prev)
  const active = activePlayers(state)
  state.status = 'playing'
  state.startedAt = now
  state.players = state.players.map((p) =>
    p.status === 'ready' ? { ...p, status: 'playing' } : p
  )
  const first = active.length > 0 ? active[Math.floor(rng() * active.length)] : null
  state.turnNumber = 1
  state.sixStreak = 0
  armTurn(state, first?.userId ?? null, now)
  state.lastEvent = { type: 'turn_changed', playerId: first?.userId ?? null }
  return state
}

// ── Legal moves (Ludo PRD §13/§20/§25/§84) ──────────────────────────────────

/**
 * All legal moves for `playerId` given a dice value. The UI highlights these
 * tokens (§20); the server validates the chosen move against THIS list (§84).
 */
export function getLegalMoves(state: LudoGameState, playerId: string, dice: number): LudoLegalMove[] {
  if (state.status !== 'playing') return []
  const me = state.players.find((p) => p.userId === playerId)
  if (!me) return []
  const moves: LudoLegalMove[] = []
  for (const token of state.tokens) {
    if (token.playerId !== playerId) continue
    let to: number
    if (token.state === 'yard' || token.position < 0) {
      if (dice !== 6) continue // §13 — a 6 is required to leave the yard
      to = 0
    } else {
      if (token.state === 'finished') continue
      to = token.position + dice
      if (to > FINISH_STEP) continue // §25 — exact finish, no overshoot
    }
    // §21 — captures: landing on the shared track on a NON-SAFE ring cell
    // sends every opponent token on that cell back to its yard.
    const captures: string[] = []
    if (to <= HOME_ENTRY - 1) {
      const ringIdx = ringIndexForStep(token.color, to)
      if (ringIdx != null && !isSafeRingCell(ringIdx)) {
        for (const other of state.tokens) {
          if (other.playerId === playerId) continue
          if (other.state !== 'track') continue
          const otherRing = ringIndexForStep(other.color, other.position)
          if (otherRing === ringIdx) captures.push(other.id)
        }
      }
    }
    moves.push({ tokenId: token.id, from: token.position, to, captures, finishes: to === FINISH_STEP })
  }
  return moves
}

// ── Roll (Ludo PRD §14/§16/§17) ─────────────────────────────────────────────

/**
 * Roll the dice for the current player. SERVER-ONLY authority (§14/§106):
 * the caller passes its own rng (crypto-backed on the server) — the client
 * NEVER sends a dice value.
 */
export function rollDice(
  prev: LudoGameState,
  playerId: string,
  actionId: string,
  rng: () => number = Math.random,
  now: number = Date.now()
): EngineResult {
  if (prev.status !== 'playing') return { ok: false, error: 'game_not_playing' }
  if (prev.currentPlayerId !== playerId) return { ok: false, error: 'not_your_turn' }
  if (prev.dice.value != null) return { ok: false, error: 'dice_pending' }

  const state = clone(prev)
  const value = 1 + Math.floor(rng() * 6)
  const events: LudoGameEvent[] = [{ type: 'dice_rolled', playerId, dice: value }]

  // §17 — three consecutive sixes: the third six is cancelled, the turn
  // passes and the streak resets. Server-side only (§17).
  if (value === 6) {
    state.sixStreak += 1
    if (state.sixStreak >= SIX_STREAK_LIMIT) {
      state.sixStreak = 0
      const next = nextPlayerAfter(state, seatOf(state, playerId))
      armTurn(state, next?.userId ?? null, now)
      state.turnNumber += 1
      events.push({ type: 'six_cancelled', playerId })
      events.push({ type: 'turn_changed', playerId: next?.userId ?? null })
      nowPatch(state, actionId)
      state.lastEvent = events[events.length - 1]
      return { ok: true, state, events }
    }
  } else {
    state.sixStreak = 0
  }

  const legal = getLegalMoves(state, playerId, value)
  if (legal.length === 0) {
    if (value === 6) {
      // §16 — no legal move after a 6 → the player rolls again (server
      // auto-rolls after the short beat — still no user action required).
      state.dice = { value: null, rolledBy: null, rolledAt: null }
      state.moveDeadlineAt = null
      state.turnDeadlineAt = now + TURN_AUTOROLL_DELAY_MS
      events.push({ type: 'extra_turn', playerId })
    } else {
      // No legal move, no 6 → the turn passes automatically.
      const next = nextPlayerAfter(state, seatOf(state, playerId))
      state.turnNumber += 1
      armTurn(state, next?.userId ?? null, now)
      events.push({ type: 'no_moves', playerId, dice: value })
      events.push({ type: 'turn_changed', playerId: next?.userId ?? null })
    }
    nowPatch(state, actionId)
    state.lastEvent = events[events.length - 1]
    return { ok: true, state, events }
  }

  state.dice = { value, rolledBy: playerId, rolledAt: now }
  state.moveDeadlineAt = now + TURN_MOVE_TIMEOUT_MS
  nowPatch(state, actionId)
  state.lastEvent = events[events.length - 1]
  return { ok: true, state, events }
}

function seatOf(state: LudoGameState, playerId: string): number {
  return state.players.find((p) => p.userId === playerId)?.seat ?? -1
}

// ── Move (Ludo PRD §18/§21/§24/§25/§26/§27) ─────────────────────────────────

/**
 * Apply a validated token move. The server MUST have checked the token id
 * against getLegalMoves() — this function re-verifies everything anyway
 * (§105 security: never trust the client).
 */
export function moveToken(
  prev: LudoGameState,
  playerId: string,
  tokenId: string,
  actionId: string,
  now: number = Date.now()
): EngineResult {
  if (prev.status !== 'playing') return { ok: false, error: 'game_not_playing' }
  if (prev.currentPlayerId !== playerId) return { ok: false, error: 'not_your_turn' }
  const dice = prev.dice.value
  if (dice == null) return { ok: false, error: 'no_dice' }
  const token = prev.tokens.find((t) => t.id === tokenId)
  if (!token) return { ok: false, error: 'unknown_token' }
  if (token.playerId !== playerId) return { ok: false, error: 'not_your_token' }
  const legal = getLegalMoves(prev, playerId, dice)
  const move = legal.find((m) => m.tokenId === tokenId)
  if (!move) return { ok: false, error: 'illegal_move' }

  const state = clone(prev)
  const events: LudoGameEvent[] = []
  const t = state.tokens.find((x) => x.id === tokenId)!
  t.position = move.to
  t.state =
    move.to === FINISH_STEP ? 'finished' : move.to >= HOME_ENTRY ? 'home' : 'track'

  events.push({
    type: 'token_moved',
    playerId,
    tokenId,
    from: move.from,
    to: move.to,
    steps: move.from < 0 ? 1 : move.to - move.from,
  })

  // §21 — captures (server-decided, from the precomputed legal move).
  for (const capturedId of move.captures) {
    const victim = state.tokens.find((x) => x.id === capturedId)
    if (!victim) continue
    victim.position = -1
    victim.state = 'yard'
    const capturer = state.players.find((p) => p.userId === playerId)
    if (capturer) capturer.captures += 1
    events.push({ type: 'token_captured', playerId: victim.playerId, tokenId: capturedId, byPlayerId: playerId })
  }

  // §26 — token finished.
  if (move.finishes) {
    const me = state.players.find((p) => p.userId === playerId)
    if (me) me.tokensFinished = Math.min(TOKENS_PER_PLAYER, me.tokensFinished + 1)
    events.push({ type: 'token_finished', playerId, tokenId })
  }

  // §27 — win condition: 4/4 tokens home.
  const myTokens = state.tokens.filter((x) => x.playerId === playerId)
  if (myTokens.every((x) => x.state === 'finished')) {
    const me = state.players.find((p) => p.userId === playerId)
    if (me) me.status = 'winner'
    state.status = 'finished'
    state.winnerId = playerId
    state.endedAt = now
    state.dice = { value: null, rolledBy: null, rolledAt: null }
    state.moveDeadlineAt = null
    state.turnDeadlineAt = null
    state.sixStreak = 0
    events.push({ type: 'game_finished', winnerId: playerId, winnerName: me?.displayName ?? 'Player' })
    nowPatch(state, actionId)
    state.lastEvent = events[events.length - 1]
    return { ok: true, state, events }
  }

  // §16 — a 6 grants another roll to the SAME player (server auto-rolls —
  // the user only ever picks a token).
  if (dice === 6) {
    state.dice = { value: null, rolledBy: null, rolledAt: null }
    state.moveDeadlineAt = null
    state.turnDeadlineAt = now + TURN_AUTOROLL_DELAY_MS
    events.push({ type: 'extra_turn', playerId })
  } else {
    const next = nextPlayerAfter(state, seatOf(state, playerId))
    state.turnNumber += 1
    state.sixStreak = 0
    armTurn(state, next?.userId ?? null, now)
    events.push({ type: 'turn_changed', playerId: next?.userId ?? null })
  }

  nowPatch(state, actionId)
  state.lastEvent = events[events.length - 1]
  return { ok: true, state, events }
}

// ── Turn recovery (Ludo PRD §42-§44 — the game can NEVER lock) ──────────────

/**
 * Watchdog pass: discard a departed/timed-out player's pending dice and
 * advance the turn. `reason` 'timeout' (idle watchdog) or 'left' (player
 * left mid-turn). Safe to call speculatively — it only mutates when the
 * given player is still the current one.
 */
export function passTurn(
  prev: LudoGameState,
  playerId: string,
  reason: 'timeout' | 'left',
  actionId: string,
  now: number = Date.now()
): EngineResult {
  if (prev.status !== 'playing') return { ok: false, error: 'game_not_playing' }
  if (prev.currentPlayerId !== playerId) return { ok: false, error: 'not_your_turn' }
  const state = clone(prev)
  const events: LudoGameEvent[] = [{ type: 'turn_skipped', playerId, reason }]
  const next = nextPlayerAfter(state, seatOf(state, playerId))
  state.turnNumber += 1
  state.sixStreak = 0
  armTurn(state, next?.userId ?? null, now)
  events.push({ type: 'turn_changed', playerId: next?.userId ?? null })
  nowPatch(state, actionId)
  state.lastEvent = events[events.length - 1]
  return { ok: true, state, events }
}

/**
 * Remove a player who left the room (Ludo PRD §41/§43: no ghost players on
 * the board — their tokens are removed; if it was their turn the turn
 * advances; fewer than 2 active players reverts the room to 'waiting').
 */
export function removePlayer(
  prev: LudoGameState,
  userId: string,
  actionId: string,
  now: number = Date.now()
): { state: LudoGameState; events: LudoGameEvent[]; wasCurrent: boolean } {
  const state = clone(prev)
  const events: LudoGameEvent[] = []
  const leaver = state.players.find((p) => p.userId === userId)
  const wasCurrent = state.currentPlayerId === userId
  if (leaver) leaver.status = 'left'
  state.tokens = state.tokens.filter((t) => t.playerId !== userId)

  if (state.status === 'playing' && activePlayers(state).length < 2) {
    // Not enough players to keep playing → back to the lobby (§5: a game
    // may only run with ≥ 2 players). Everything resets cleanly.
    state.status = 'waiting'
    state.currentPlayerId = null
    state.dice = { value: null, rolledBy: null, rolledAt: null }
    state.moveDeadlineAt = null
    state.turnDeadlineAt = null
    state.sixStreak = 0
    state.turnNumber = 0
    state.tokens = state.players
      .filter((p) => p.status !== 'left')
      .flatMap((p) => tokensForPlayer(p))
    state.players = state.players.map((p) =>
      p.status === 'playing' || p.status === 'disconnected'
        ? { ...p, status: 'ready', tokensFinished: 0, captures: 0 }
        : p
    )
    events.push({ type: 'turn_changed', playerId: null })
  } else if (wasCurrent && state.status === 'playing') {
    // §43 — the ACTIVE player left: advance to the next active player.
    const next = nextPlayerAfter(state, leaver?.seat ?? -1)
    state.turnNumber += 1
    state.sixStreak = 0
    armTurn(state, next?.userId ?? null, now)
    events.push({ type: 'turn_changed', playerId: next?.userId ?? null })
  }
  nowPatch(state, actionId)
  if (events.length > 0) state.lastEvent = events[events.length - 1]
  return { state, events, wasCurrent }
}

/** Effective status for the HUD: disconnected players still hold their seat. */
export function playerBySeat(state: LudoGameState, seat: LudoSeat): LudoPlayer | undefined {
  return state.players.find((p) => p.seat === seat)
}

/** All colors currently seated (used to render empty seats). */
export function seatedColors(state: LudoGameState): LudoColor[] {
  return state.players.filter((p) => p.status !== 'left').map((p) => p.color)
}

/** Convenience for the countdown overlay + tests. */
export function seatColor(seat: LudoSeat): LudoColor {
  return SEAT_COLORS[seat] as LudoColor
}
