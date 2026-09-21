// Full-game simulation of the LUDO SERVER ORCHESTRATION (ludo-server.ts)
// to find the "only one player gets the turn" bug.
//
// This mimics EXACTLY:
//   · armTurn: turnDeadlineAt = now + TURN_AUTOROLL_DELAY_MS (1500)
//   · watchdog fires at min(deadlines) + WATCHDOG_GRACE_MS (250)
//   · autoRollFor -> engineRollDice (server rolls for current player)
//   · moveDeadlineAt = rollAt + DICE_REVEAL_MS + TURN_MOVE_TIMEOUT_MS
//   · simulated player picks a legal move after the reveal beat
//   · passTurnFor on timeout
// No DB — single-threaded event loop with a virtual clock.

import {
  DICE_REVEAL_MS,
  ROLL_SPACING_MS,
  TURN_AUTOROLL_DELAY_MS,
  TURN_MOVE_TIMEOUT_MS,
  WATCHDOG_GRACE_MS,
} from '../src/lib/quicky/ludo/constants'
import {
  createGameState,
  getLegalMoves,
  moveToken as engineMoveToken,
  passTurn as enginePassTurn,
  rollDice as engineRollDice,
  startGame,
} from '../src/lib/quicky/ludo/rules'
import type { LudoGameState } from '../src/lib/quicky/ludo/types'

// ── Virtual clock event loop ─────────────────────────────────────────────────
// ROLL SPACING model — every emitted roll event occupies the client dice
// sequence (DICE_SEQ_TOTAL_MS); consecutive rolls must respect ROLL_SPACING_MS
// or the client animation gets cut (the original bug).
type Task = { at: number; run: () => void; label: string }
const tasks: Task[] = []
let now = 0
let lastRollEmittedAt = -Infinity
let spacingViolations = 0
const rollEmissions: { at: number; playerId: string }[] = []
function schedule(delayMs: number, label: string, run: () => void) {
  tasks.push({ at: now + delayMs, label, run })
}
function emitRoll(playerId: string) {
  if (lastRollEmittedAt > -Infinity && now - lastRollEmittedAt < ROLL_SPACING_MS - 1) {
    spacingViolations++
    console.log(`  !! ROLL SPACING VIOLATION @${now}: gap ${now - lastRollEmittedAt}ms < ${ROLL_SPACING_MS}ms`)
  }
  lastRollEmittedAt = now
  rollEmissions.push({ at: now, playerId })
}

function runLoop(maxMs: number) {
  let guard = 0
  while (tasks.length > 0 && guard++ < 200_000) {
    tasks.sort((a, b) => a.at - b.at)
    const t = tasks.shift()!
    if (t.at > maxMs) break
    now = t.at
    t.run()
  }
  if (guard >= 200_000) throw new Error('event loop overflow')
}

// ── The server room (mirrors ludo-server.ts state + watchdog) ────────────────
let state: LudoGameState
const rng = Math.random

function scheduleWatchdog() {
  const deadlines = [state.turnDeadlineAt, state.moveDeadlineAt].filter((d): d is number => d != null)
  if (deadlines.length === 0) return
  const at = Math.min(...deadlines) + WATCHDOG_GRACE_MS
  const delay = Math.max(400, at - now)
  schedule(delay, 'watchdog', () => {
    if (state.status !== 'playing' || !state.currentPlayerId) return
    const rollLate =
      state.dice.value == null && state.turnDeadlineAt != null && now >= state.turnDeadlineAt + WATCHDOG_GRACE_MS
    const moveLate =
      state.dice.value != null && state.moveDeadlineAt != null && now >= state.moveDeadlineAt + WATCHDOG_GRACE_MS
    if (rollLate) {
      autoRollFor(state.currentPlayerId)
      return
    }
    if (moveLate) {
      passTurnFor(state.currentPlayerId)
      return
    }
    scheduleWatchdog()
  })
}

function autoRollFor(playerId: string) {
  const res = engineRollDice(state, playerId, `auto_${now}`, rng, now)
  if (!res.ok) {
    console.log(`  !! autoRoll REJECTED (${res.error}) @${now} — turn stuck with ${state.currentPlayerId}`)
    return
  }
  state = res.state
  emitRoll(playerId)
  // dice pending → arm the player-choice simulation + watchdog
  if (state.dice.value != null) armPlayerChoice()
  scheduleWatchdog()
}

function passTurnFor(playerId: string) {
  const res = enginePassTurn(state, playerId, 'timeout', `wd_${now}`, now)
  if (!res.ok) return
  state = res.state
  stats.timeouts++
  scheduleWatchdog()
}

// ── Simulated players ────────────────────────────────────────────────────────
type Stats = {
  rolls: Record<string, number>
  choices: Record<string, number> // times a player actually got to pick
  timeouts: number
  turns: Record<string, number> // times a turn was armed for the player
  stuck: boolean
}
let stats: Stats

function armPlayerChoice() {
  const me = state.currentPlayerId!
  const dice = state.dice.value!
  const legal = getLegalMoves(state, me, dice)
  if (legal.length === 0) return // engine already passed/expects re-roll
  stats.choices[me] = (stats.choices[me] ?? 0) + 1
  // Player reacts somewhere between the reveal beat and the deadline.
  const react = DICE_REVEAL_MS + 300 + Math.random() * 4000 // generous human
  const deadline = state.moveDeadlineAt ?? now
  if (now + react > deadline) {
    return // won't make it — watchdog passes the turn
  }
  schedule(react, `move:${me}`, () => {
    if (state.currentPlayerId !== me || state.dice.value == null) return // turn already passed
    const pick = legal[Math.floor(Math.random() * legal.length)]
    const res = engineMoveToken(state, me, pick.tokenId, `mv_${now}`, now)
    if (!res.ok) {
      console.log(`  !! move REJECTED (${res.error})`)
      return
    }
    state = res.state
  })
}

// ── Run games ────────────────────────────────────────────────────────────────
function playGame(playerIds: string[]): Stats {
  tasks.length = 0
  now = 0
  lastRollEmittedAt = -Infinity
  rollEmissions.length = 0
  stats = { rolls: {}, choices: {}, timeouts: 0, turns: {}, stuck: false }
  const players = playerIds.map((id, i) => ({ userId: id, seat: (i * 2) as 0 | 1 | 2 | 3, displayName: id, avatar: null }))
  state = startGame(createGameState(players), rng, 0)
  scheduleWatchdog()
  try {
    runLoop(60 * 60 * 1000) // 1h virtual
  } catch (e) {
    stats.stuck = true
  }
  if (state.status !== 'finished') stats.stuck = true
  return stats
}

const N = 200
const agg: Record<string, { turns: number; choices: number; games: number; stuck: number }> = {}
let stuckGames = 0
for (let i = 0; i < N; i++) {
  const s = playGame(['A', 'B'])
  if (s.stuck) {
    stuckGames++
    console.log(`game ${i}: STUCK — status=${state.status} current=${state.currentPlayerId} dice=${state.dice.value}`)
  }
  for (const p of ['A', 'B']) {
    agg[p] ??= { turns: 0, choices: 0, games: 0, stuck: 0 }
    agg[p].turns += s.turns[p] ?? 0
    agg[p].choices += s.choices[p] ?? 0
    if ((s.choices[p] ?? 0) > 0) agg[p].games++
  }
}

console.log(`\n${N} games, stuck: ${stuckGames}, ROLL SPACING violations: ${spacingViolations}`)
for (const p of Object.keys(agg)) {
  console.log(`${p}: choices in ${agg[p].games}/${N} games, avg choices/game = ${(agg[p].choices / N).toFixed(1)}`)
}
// The user's report: ONE player gets ALL turns/choices. Detect one-sided games:
let oneSided = 0
for (let i = 0; i < N; i++) {
  const s = playGame(['A', 'B'])
  const a = s.choices['A'] ?? 0
  const b = s.choices['B'] ?? 0
  if (a === 0 || b === 0) oneSided++
}
console.log(`one-sided games (a player never chose): ${oneSided}/${N}`)
console.log(`ROLL_SPACING_MS = ${ROLL_SPACING_MS} (every roll fully visible; no animation cut)`)
