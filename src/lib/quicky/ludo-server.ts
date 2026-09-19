// Quicky — LUDO SERVER (Ludo PRD §47-§51/§56-§58/§97-§98/§105/§106/§113)
//
// The authoritative DB-backed state machine for Quicky Ludo. Architecture
// rules honoured here:
//   · THE ROOM IS THE PLATFORM (§122): Ludo reuses the SpinRoom /
//     SpinRoomPlayer / SpinRoomMessage / gift infrastructure with
//     gameType='ludo' — NO second room table (§76).
//   · SERVER AUTHORITY (§47/§105): dice are generated HERE, moves are
//     validated against the shared pure engine (ludo/rules.ts), and the
//     client never sends a dice value, position, winner or turn.
//   · IDEMPOTENCY (§50): every roll/move carries an actionId — a repeat
//     request returns the stored result without re-executing.
//   · STATE VERSIONING (§51): every mutation bumps state.version and is
//     written with a CAS guard (UPDATE … WHERE version = readVersion), so
//     delayed requests, double tabs and reconnects can never fork state.
//   · THE GAME CAN NEVER LOCK (§42-§44): a per-room watchdog auto-passes
//     the turn when the active player stalls (roll or move deadline), and
//     lazy runtime recovery re-runs the rules on every server touch — a
//     process restart cannot strand a game.
//   · WRITE STATE FIRST, THEN BROADCAST (§113): the DB transition wins,
//     the room event bus (spin-events.ts — roomId-keyed, shared by every
//     room game) wakes the SSE streams afterwards.

import { db } from '@/lib/db'
import { randomInt } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import {
  LUDO_MIN_PLAYERS,
  LUDO_POINTS_PER_CAPTURE,
  LUDO_POINTS_PER_TOKEN,
  LUDO_POINTS_WIN,
  START_COUNTDOWN_MS,
  WATCHDOG_GRACE_MS,
} from './ludo/constants'
import {
  createGameState,
  getLegalMoves,
  moveToken as engineMoveToken,
  passTurn as enginePassTurn,
  removePlayer as engineRemovePlayer,
  rollDice as engineRollDice,
  startGame as engineStartGame,
} from './ludo/rules'
import type { LudoGameEvent, LudoGameState, LudoPlayer } from './ludo/types'
import { emitRoomUpdate } from './spin-events'

// ── Per-process timer registry (mirrors spin-bottle.ts; cancelled on leave,
//    close and cleanup so no dead timer ever touches a deleted room) ────────
const roomTimers = new Map<string, ReturnType<typeof setTimeout>[]>()

/**
 * ROUND-4 (multiplayer PRD §12) — the dice are generated with a
 * CRYPTOGRAPHIC RNG on the server, never Math.random: uniform, unguessable,
 * and unreachable from any client (the client sends only an actionId).
 */
const secureRng = (): number => randomInt(0, 2 ** 31) / 2 ** 31

function pushTimer(roomId: string, t: ReturnType<typeof setTimeout>) {
  const list = roomTimers.get(roomId) ?? []
  list.push(t)
  roomTimers.set(roomId, list)
}

export function cancelLudoTimers(roomId: string) {
  const timers = roomTimers.get(roomId)
  if (timers) {
    timers.forEach((t) => clearTimeout(t))
    roomTimers.delete(roomId)
  }
}

// ── Persistence helpers ──────────────────────────────────────────────────────

export async function loadGameState(roomId: string): Promise<{ room: {
  id: string
  status: string
  startedAt: Date | null
  maxPlayers: number
  minPlayers: number
  singletonStartedAt: Date | null
}; state: LudoGameState | null } | null> {
  const room = await db.spinRoom.findUnique({
    where: { id: roomId },
    select: {
      id: true,
      status: true,
      startedAt: true,
      maxPlayers: true,
      minPlayers: true,
      singletonStartedAt: true,
      gameType: true,
      gameState: true,
    },
  })
  if (!room || room.gameType !== 'ludo') return null
  return { room, state: (room.gameState as LudoGameState | null) ?? null }
}

/**
 * CAS write (§51): the update lands ONLY if the state version still equals
 * the version we read. Two racing requests (double tab, stale client) —
 * exactly one wins; the loser gets count 0 → 409 → client reconciles.
 */
export async function writeGameStateCas(roomId: string, state: LudoGameState, readVersion: number): Promise<boolean> {
  const updated = await db.spinRoom.updateMany({
    where: { id: roomId, gameType: 'ludo', gameState: { path: ['version'], equals: readVersion } },
    data: {
      gameState: state as unknown as Prisma.InputJsonValue,
      lastActivityAt: new Date(),
    },
  })
  return updated.count === 1
}

// ── Game start (Ludo PRD §56/§57/§97) ───────────────────────────────────────

/**
 * Arm the in-process STARTING → PLAYING countdown (§56: "3 · 2 · 1 · LUDO!").
 * The lazy ensureLudoRuntime() path is the recovery net if this process
 * dies; the timer only makes the transition instant.
 */
export function scheduleLudoCountdown(roomId: string) {
  const t = setTimeout(() => {
    void ensureLudoRuntime(roomId).catch(() => {})
  }, START_COUNTDOWN_MS + 250)
  pushTimer(roomId, t)
}

/** Exported for the join route: the CURRENT seating as engine players. */
export async function seatedLudoPlayers(roomId: string): Promise<LudoPlayer[]> {
  return seatedPlayers(roomId)
}

async function seatedPlayers(roomId: string): Promise<LudoPlayer[]> {
  const rows = await db.spinRoomPlayer.findMany({
    where: { roomId, leftAt: null, isActive: true, connection: { in: ['online', 'reconnecting'] } },
    orderBy: { seatIndex: 'asc' },
    include: { user: { select: { name: true, photos: { orderBy: { position: 'asc' }, take: 1, select: { url: true, isPrivate: true } } } } },
  })
  return rows.map((r) => ({
    userId: r.userId,
    seat: r.seatIndex as LudoPlayer['seat'],
    color: ({ 0: 'red', 1: 'green', 2: 'yellow', 3: 'blue' } as const)[r.seatIndex as 0 | 1 | 2 | 3] ?? 'red',
    displayName: r.user?.name ?? 'Player',
    avatar: (r.user?.photos.find((p) => !p.isPrivate) ?? r.user?.photos[0])?.url ?? null,
    status: 'ready',
    tokensFinished: 0,
    captures: 0,
  }))
}

/**
 * Flip a STARTING room whose countdown elapsed into PLAYING (Ludo PRD §56):
 * builds the final seating from the CURRENT member rows (late joiners during
 * the countdown are included, §97), picks the first player at random
 * SERVER-side (§57) and arms the watchdog. Also the lazy recovery path: a
 * process restart can never strand a room in STARTING forever.
 */
export async function ensureLudoRuntime(roomId: string): Promise<void> {
  const loaded = await loadGameState(roomId)
  if (!loaded) return
  const { room, state } = loaded

  if (room.status === 'STARTING') {
    const startedAt = room.startedAt?.getTime() ?? 0
    if (Date.now() - startedAt < START_COUNTDOWN_MS) return
    const players = await seatedPlayers(roomId)
    if (players.length < LUDO_MIN_PLAYERS) {
      // Everyone left during the countdown → back to the lobby (§5).
      await db.spinRoom.updateMany({
        where: { id: roomId, status: 'STARTING' },
        data: {
          status: 'WAITING',
          startedAt: null,
          gameState: createGameState([]) as unknown as Prisma.InputJsonValue,
        },
      })
      emitRoomUpdate(roomId, 'LUDO_STATE', { roomId })
      return
    }
    const next = engineStartGame(createGameState(players), secureRng)
    const flipped = await db.spinRoom.updateMany({
      where: { id: roomId, status: 'STARTING' },
      data: {
        status: 'PLAYING',
        gameState: next as unknown as Prisma.InputJsonValue,
        lastActivityAt: new Date(),
      },
    })
    if (flipped.count > 0) {
      scheduleWatchdog(roomId, next)
      emitRoomUpdate(roomId, 'LUDO_STARTED', { roomId, stateVersion: next.version })
      emitRoomUpdate(roomId)
    }
    return
  }

  // PLAYING — lazy watchdog (covers process restarts / lost timers):
  // the auto-roll beat elapsed with no dice → the SERVER rolls for the
  // player (§14 revised); a move deadline passed with a pending dice →
  // discard it and skip the chance (§44 — the game always moves forward).
  if (room.status === 'PLAYING' && state?.status === 'playing' && state.currentPlayerId) {
    const now = Date.now()
    const rollLate = state.dice.value == null && state.turnDeadlineAt != null && now >= state.turnDeadlineAt + WATCHDOG_GRACE_MS
    const moveLate = state.dice.value != null && state.moveDeadlineAt != null && now >= state.moveDeadlineAt + WATCHDOG_GRACE_MS
    if (rollLate) {
      await autoRollFor(roomId, state, state.currentPlayerId)
    } else if (moveLate) {
      await passTurnFor(roomId, state, state.currentPlayerId, 'timeout')
    }
  }
}

// ── Watchdog (Ludo PRD §42-§44 — disconnect/idle can never freeze a turn) ──

/**
 * §14 REVISED — the dice are a SERVER ACTION: when the auto-roll beat
 * elapses the server throws the dice FOR the active player. The user never
 * rolls — they only pick a token inside the 45s move window.
 */
async function autoRollFor(roomId: string, state: LudoGameState, playerId: string) {
  const actionId = `auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const res = engineRollDice(state, playerId, actionId, secureRng)
  if (!res.ok) return
  if (!(await writeGameStateCas(roomId, res.state, state.version))) return
  for (const ev of res.events) {
    if (ev.type === 'dice_rolled') emitRoomUpdate(roomId, 'LUDO_DICE_ROLLED', { roomId, playerId, dice: ev.dice })
  }
  emitRoomUpdate(roomId)
  scheduleWatchdog(roomId, res.state)
}

function scheduleWatchdog(roomId: string, state: LudoGameState) {
  const deadlines = [state.turnDeadlineAt, state.moveDeadlineAt].filter((d): d is number => d != null)
  if (deadlines.length === 0) return
  const at = Math.min(...deadlines) + WATCHDOG_GRACE_MS
  const delay = Math.max(400, at - Date.now())
  const t = setTimeout(() => {
    void (async () => {
      const loaded = await loadGameState(roomId)
      if (!loaded || loaded.room.status !== 'PLAYING' || !loaded.state) return
      const st = loaded.state
      if (st.status !== 'playing' || !st.currentPlayerId) return
      const now = Date.now()
      const rollLate = st.dice.value == null && st.turnDeadlineAt != null && now >= st.turnDeadlineAt + WATCHDOG_GRACE_MS
      const moveLate = st.dice.value != null && st.moveDeadlineAt != null && now >= st.moveDeadlineAt + WATCHDOG_GRACE_MS
      if (rollLate) {
        // Server throws the dice for the (idle) active player — the turn
        // NEVER waits for a roll.
        await autoRollFor(roomId, st, st.currentPlayerId)
        return
      }
      if (moveLate) {
        await passTurnFor(roomId, st, st.currentPlayerId, 'timeout')
        return
      }
      // Nothing due yet (a roll/move landed in between) — re-arm on the
      // NEXT deadline so the chain of watchdogs never dies mid-game.
      scheduleWatchdog(roomId, st)
    })().catch(() => {})
  }, delay)
  pushTimer(roomId, t)
}

async function passTurnFor(roomId: string, state: LudoGameState, playerId: string, reason: 'timeout' | 'left') {
  const res = enginePassTurn(state, playerId, reason, `wd_${Date.now()}`)
  if (!res.ok) return
  if (await writeGameStateCas(roomId, res.state, state.version)) {
    emitRoomUpdate(roomId, 'LUDO_TURN_SKIPPED', { roomId, playerId, reason })
    emitRoomUpdate(roomId)
    scheduleWatchdog(roomId, res.state)
  }
}

// ── Roll / Move (Ludo PRD §48/§49/§50) ──────────────────────────────────────

export type LudoActionResult =
  | { ok: true; state: LudoGameState; events: LudoGameEvent[]; idempotent: boolean; dice?: number; legalMoves?: { tokenId: string }[] }
  | { ok: false; status: number; error: string }

export async function performRoll(
  roomId: string,
  userId: string,
  actionId: string
): Promise<LudoActionResult> {
  await ensureLudoRuntime(roomId)
  const loaded = await loadGameState(roomId)
  if (!loaded || !loaded.state) return { ok: false, status: 404, error: 'room_not_found' }
  const state = loaded.state
  if (loaded.room.status !== 'PLAYING' || state.status !== 'playing') {
    return { ok: false, status: 409, error: 'game_not_playing' }
  }
  // §50 — idempotency: the same actionId replays the stored result without
  // executing twice (no duplicate dice, no duplicate turn pass).
  if (state.lastActionId === actionId) {
    return {
      ok: true,
      state,
      events: [],
      idempotent: true,
      dice: state.dice.value ?? undefined,
      legalMoves: state.dice.value != null ? getLegalMoves(state, userId, state.dice.value) : [],
    }
  }
  const res = engineRollDice(state, userId, actionId, secureRng)
  if (!res.ok) return { ok: false, status: mapError(res.error), error: res.error }
  if (!(await writeGameStateCas(roomId, res.state, state.version))) {
    return { ok: false, status: 409, error: 'state_conflict' }
  }
  const moved = res.state.lastEvent
  if (moved?.type === 'dice_rolled') {
    emitRoomUpdate(roomId, 'LUDO_DICE_ROLLED', { roomId, playerId: userId, dice: moved.dice })
  }
  emitRoomUpdate(roomId)
  scheduleWatchdog(roomId, res.state)
  const legal = res.state.dice.value != null ? getLegalMoves(res.state, userId, res.state.dice.value) : []
  return { ok: true, state: res.state, events: res.events, idempotent: false, dice: res.state.dice.value ?? undefined, legalMoves: legal }
}

export async function performMove(
  roomId: string,
  userId: string,
  tokenId: string,
  actionId: string
): Promise<LudoActionResult> {
  await ensureLudoRuntime(roomId)
  const loaded = await loadGameState(roomId)
  if (!loaded || !loaded.state) return { ok: false, status: 404, error: 'room_not_found' }
  const state = loaded.state
  if (loaded.room.status !== 'PLAYING' || state.status !== 'playing') {
    return { ok: false, status: 409, error: 'game_not_playing' }
  }
  // §50 — the same actionId replays the stored (already applied) state:
  // one movement, one capture, one winner, one reward — ever.
  if (state.lastActionId === actionId) {
    return { ok: true, state, events: [], idempotent: true }
  }
  const res = engineMoveToken(state, userId, tokenId, actionId)
  if (!res.ok) return { ok: false, status: mapError(res.error), error: res.error }
  if (!(await writeGameStateCas(roomId, res.state, state.version))) {
    return { ok: false, status: 409, error: 'state_conflict' }
  }
  for (const ev of res.events) {
    if (ev.type === 'token_moved') emitRoomUpdate(roomId, 'LUDO_TOKEN_MOVED', { roomId, ...ev })
    if (ev.type === 'token_captured') emitRoomUpdate(roomId, 'LUDO_TOKEN_CAPTURED', { roomId, ...ev })
    if (ev.type === 'token_finished') emitRoomUpdate(roomId, 'LUDO_TOKEN_FINISHED', { roomId, ...ev })
  }
  if (res.state.status === 'finished' && res.state.winnerId) {
    emitRoomUpdate(roomId, 'LUDO_GAME_FINISHED', { roomId, winnerId: res.state.winnerId })
    await awardLudoStats(roomId, res.state).catch(() => {})
  }
  emitRoomUpdate(roomId)
  scheduleWatchdog(roomId, res.state)
  return { ok: true, state: res.state, events: res.events, idempotent: false }
}

function mapError(error: string): number {
  switch (error) {
    case 'not_your_turn':
    case 'not_your_token':
    case 'unknown_token':
    case 'unknown_player':
      return 403
    case 'game_not_playing':
    case 'dice_pending':
    case 'no_dice':
    case 'illegal_move':
      return 409
    default:
      return 400
  }
}

// ── Permanent stats (Ludo PRD §74/§75/§78 — through the EXISTING systems) ──

async function awardLudoStats(roomId: string, state: LudoGameState) {
  const players = state.players.filter((p) => p.status === 'winner' || p.status === 'playing' || p.status === 'disconnected')
  if (players.length === 0) return
  await Promise.all(
    players.map(async (p) => {
      // §75 — game points flow through the EXISTING Quicky progression
      // (User.quickyScore); no separate Ludo currency is created.
      const points =
        (p.userId === state.winnerId ? LUDO_POINTS_WIN : 0) +
        p.tokensFinished * LUDO_POINTS_PER_TOKEN +
        p.captures * LUDO_POINTS_PER_CAPTURE
      await db.user
        .update({
          where: { id: p.userId },
          data: {
            gamesPlayed: { increment: 1 },
            quickyScore: { increment: points },
            ...(p.userId === state.winnerId ? { ludoWins: { increment: 1 } } : {}),
            ludoTokensFinished: { increment: p.tokensFinished },
            ludoCaptures: { increment: p.captures },
          },
        })
        .catch(() => {})
    })
  )
}

// ── Leave / disconnect (Ludo PRD §41/§43/§44) ───────────────────────────────

/**
 * Server-side removal of a Ludo player: their tokens leave the board
 * (§41 — no ghosts), a pending dice is discarded (§44), the turn advances
 * if it was theirs (§43). No-ops safely for lobby rooms.
 */
export async function detachLudoPlayer(roomId: string, userId: string): Promise<void> {
  cancelLudoTimers(roomId) // this process's watchdog restarts below if the game continues
  const loaded = await loadGameState(roomId)
  if (!loaded || !loaded.state) return
  const state = loaded.state
  if (loaded.room.status === 'PLAYING' && state.status === 'playing') {
    const out = engineRemovePlayer(state, userId, `leave_${Date.now()}`)
    if (await writeGameStateCas(roomId, out.state, state.version)) {
      emitRoomUpdate(roomId, 'LUDO_PLAYER_LEFT', { roomId, userId })
      if (out.state.status === 'playing') scheduleWatchdog(roomId, out.state)
      emitRoomUpdate(roomId)
    }
  } else {
    emitRoomUpdate(roomId, 'LUDO_PLAYER_LEFT', { roomId, userId })
    emitRoomUpdate(roomId)
  }
}


