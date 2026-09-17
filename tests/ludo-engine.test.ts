// Quicky — LUDO ENGINE UNIT TESTS (Ludo PRD §86)
//
// Run with:  bun run tests/ludo-engine.test.ts   (or: npx tsx tests/…)
// Framework-free asserts so the suite runs with zero extra dependencies.
// Covers every PRD §86 rule: dice range, starting, movement, exact finish,
// capture, safe squares, extra turn, three sixes, win — plus seat-order
// turn rotation, leaver recovery and board integrity (§87-§89 server-side
// race properties are enforced by the API layer's CAS writes).

import {
  BOARD_SIZE,
  FINISH_STEP,
  HOME_ENTRY,
  LUDO_MAX_PLAYERS,
  RING_SIZE,
  SEAT_COLORS,
  isSafeRingCell,
} from '../src/lib/quicky/ludo/constants'
import {
  RING,
  assertBoardIntegrity,
  ringIndexForStep,
  tokenPlacement,
  trackCellForStep,
} from '../src/lib/quicky/ludo/board'
import { movementPath } from '../src/lib/quicky/ludo/movement'
import {
  createGameState,
  getLegalMoves,
  moveToken,
  passTurn,
  removePlayer,
  rollDice,
  startGame,
} from '../src/lib/quicky/ludo/rules'
import { parseMoveRequest, parseRollRequest, statusForEngineError } from '../src/lib/quicky/ludo/validation'
import type { LudoGameState, LudoToken } from '../src/lib/quicky/ludo/types'

let passed = 0
let failed = 0
function check(name: string, cond: boolean) {
  if (cond) {
    passed++
  } else {
    failed++
    console.error(`  ✗ ${name}`)
  }
}
function section(name: string) {
  console.log(`\n── ${name}`)
}

// rng contract: dice = 1 + floor(rng() * 6) → this helper always yields k.
const d = (k: number) => () => (k - 1 + 0.5) / 6

const P = (id: string, seat: number) => ({ userId: id, seat: seat as 0 | 1 | 2 | 3, displayName: id, avatar: null })
const setToken = (s: LudoGameState, id: string, patch: Partial<LudoToken>): LudoGameState => ({
  ...s,
  tokens: s.tokens.map((t) => (t.id === id ? { ...t, ...patch } : t)),
})

// ── Board integrity ──────────────────────────────────────────────────────────
section('Board integrity (PRD §9/§10)')
assertBoardIntegrity()
check('ring has exactly 52 cells', RING.length === RING_SIZE)
check('ring cells stay on the 15×15 grid', RING.every((c) => c.row >= 0 && c.row < BOARD_SIZE && c.col >= 0 && c.col < BOARD_SIZE))
check('ring cells are unique', new Set(RING.map((c) => `${c.row},${c.col}`)).size === RING_SIZE)
check('seat colors are R/G/Y/B in order', JSON.stringify(SEAT_COLORS) === JSON.stringify(['red', 'green', 'yellow', 'blue']))
check('safe cells include the 4 starts + 4 stars', [0, 8, 13, 21, 26, 34, 39, 47].every(isSafeRingCell))
check('non-safe cell is not safe', !isSafeRingCell(5))
check('red step 0 is its start ring cell 0', ringIndexForStep('red', 0) === 0)
check('green start offset is 13', ringIndexForStep('green', 0) === 13)
check('yellow start offset is 26', ringIndexForStep('yellow', 0) === 26)
check('blue start offset is 39', ringIndexForStep('blue', 0) === 39)
check('home steps are off-ring', trackCellForStep('red', 51) === null)
check('finish step is off-ring', trackCellForStep('red', 56) === null)
{
  // Each color's lap ends adjacent to its own home path entry.
  for (const color of ['red', 'green', 'yellow', 'blue'] as const) {
    const lastRing = trackCellForStep(color, 50)
    const homeEntry = tokenPlacement(color, 0, HOME_ENTRY)
    const adj =
      Math.abs((lastRing?.row ?? -9) - homeEntry.row) + Math.abs((lastRing?.col ?? -9) - homeEntry.col) === 1
    check(`${color}: last ring cell touches its home path`, adj)
  }
}

// ── Starting tokens (PRD §13) ────────────────────────────────────────────────
section('Starting a token (PRD §13)')
{
  const s0 = startGame(createGameState([P('a', 0), P('b', 1)]), () => 0)
  const r5 = rollDice(s0, s0.currentPlayerId!, 'act-1', d(5))
  check('dice 5 cannot leave the yard', r5.ok && getLegalMoves(r5.state, s0.currentPlayerId!, 5).length === 0)
  const r6 = rollDice(s0, s0.currentPlayerId!, 'act-2', d(6))
  check('roll ok', r6.ok)
  if (r6.ok) {
    const me = r6.state.currentPlayerId!
    const legal6 = getLegalMoves(r6.state, me, 6)
    check('dice 6 can start any of the 4 yard tokens', legal6.length === 4 && legal6.every((m) => m.to === 0))
    const myToken = legal6[0].tokenId
    const mv = moveToken(r6.state, me, myToken, 'act-3')
    check('move ok', mv.ok)
    if (mv.ok) {
      const t = mv.state.tokens.find((t) => t.id === myToken)!
      check('token left the yard onto its start square', t.state === 'track' && t.position === 0)
      check('rolling 6 grants an extra roll (same player)', mv.state.currentPlayerId === me)
      check('extra_turn event present', mv.events.some((e) => e.type === 'extra_turn'))
    }
  }
}

// ── Movement (PRD §18) + exact finish (PRD §25) ─────────────────────────────
section('Movement + exact finish (PRD §18/§25)')
{
  const s0 = startGame(createGameState([P('a', 0), P('b', 1)]), () => 0)
  const s1 = setToken(s0, 'red-1', { state: 'track', position: 10 })
  const legal = getLegalMoves({ ...s1, dice: { value: 4, rolledBy: 'a', rolledAt: 1 } }, 'a', 4)
  check('10 + 4 → 14 is legal', legal.some((m) => m.tokenId === 'red-1' && m.to === 14))
  const path = movementPath('red', 0, 10, 14)
  check('movement path steps through EVERY square (no teleport)', path.length === 4)
  const exitPath = movementPath('red', 0, -1, 0)
  check('yard exit is a single hop', exitPath.length === 1)
  // Exact finish
  const s2 = setToken(s0, 'red-1', { state: 'home', position: 53 })
  const legalOver = getLegalMoves({ ...s2, dice: { value: 4, rolledBy: 'a', rolledAt: 1 } }, 'a', 4)
  check('needs 3, rolls 4 → illegal (no overshoot)', !legalOver.some((m) => m.tokenId === 'red-1'))
  const legalExact = getLegalMoves({ ...s2, dice: { value: 3, rolledBy: 'a', rolledAt: 1 } }, 'a', 3)
  check('needs 3, rolls 3 → legal finish', legalExact.some((m) => m.tokenId === 'red-1' && m.finishes))
}

// ── Capture (PRD §21/§22) ────────────────────────────────────────────────────
section('Capture + safe squares (PRD §21/§22)')
{
  const s0 = startGame(createGameState([P('a', 0), P('b', 1)]), () => 0)
  // red-1 on step 2 (ring 2, non-safe); green-1 on ring 6 (non-safe).
  // Red rolls 4: 2 + 4 → ring 6 → captures green.
  let s1 = setToken(s0, 'red-1', { state: 'track', position: 2 })
  s1 = setToken(s1, 'green-1', { state: 'track', position: 6 - 13 + 52 }) // green step 45 → ring 6
  const legal = getLegalMoves({ ...s1, dice: { value: 4, rolledBy: 'a', rolledAt: 1 } }, 'a', 4)
  const cap = legal.find((m) => m.tokenId === 'red-1')
  check('landing on enemy non-safe square captures', !!cap && cap.captures.includes('green-1'))
  check('target cell is really non-safe', !isSafeRingCell(6))
  if (cap) {
    const mv = moveToken({ ...s1, dice: { value: 4, rolledBy: 'a', rolledAt: 1 } }, 'a', 'red-1', 'act-cap')
    check('move with capture ok', mv.ok)
    if (mv.ok) {
      const victim = mv.state.tokens.find((t) => t.id === 'green-1')!
      check('victim returned to yard', victim.state === 'yard' && victim.position === -1)
      check('capture counter on the capturer', mv.state.players.find((p) => p.userId === 'a')!.captures === 1)
      check('token_captured event emitted', mv.events.some((e) => e.type === 'token_captured'))
    }
  }
  // Safe square: red lands on the star cell ring 8 while green sits there → no capture.
  let s2 = setToken(s0, 'red-1', { state: 'track', position: 2 })
  s2 = setToken(s2, 'green-1', { state: 'track', position: 47 }) // green step 47 → ring (13+47)%52 = 8
  const legalSafe = getLegalMoves({ ...s2, dice: { value: 6, rolledBy: 'a', rolledAt: 1 } }, 'a', 6)
  const capSafe = legalSafe.find((m) => m.tokenId === 'red-1')
  check('red can legally land on the star cell', !!capSafe)
  check('landing on a STAR cell captures nothing', !!capSafe && capSafe.captures.length === 0)
  // Start cells are safe too: green sits on blue start ring 39.
  check('blue start cell is safe', isSafeRingCell(39))
}

// ── Extra turn (PRD §16) + three sixes (PRD §17) ────────────────────────────
section('Extra turn + three sixes (PRD §16/§17)')
{
  const s0 = startGame(createGameState([P('a', 0), P('b', 1)]), () => 0)
  // No-legal-move-on-6 scenario: red-1 sits in the home path needing exactly
  // 1 to finish (step 55), all other red tokens yarded → 6 is illegal for
  // them all… except yard exit IS legal on 6, so instead put ALL red tokens
  // in the home path where 6 overshoots everything.
  const s1 = {
    ...s0,
    tokens: s0.tokens.map((t) =>
      t.playerId === 'a' && t.id === 'red-1'
        ? { ...t, state: 'home' as const, position: 54 }
        : t.playerId === 'a'
          ? { ...t, state: 'home' as const, position: 50 + t.index } // 51..53, none fits +6 without overshoot? 51+6=57>56 ✓
          : t
    ),
  }
  // red tokens at 51,52,53,54 → +6 = 57..60 > 56 → all illegal ✓
  const r = rollDice(s1, 'a', 'act-x', d(6))
  check('roll ok', r.ok)
  if (r.ok) {
    check('6 with no legal move → same player rolls again', r.state.currentPlayerId === 'a' && r.state.dice.value === null)
    check('extra_turn event present', r.events.some((e) => e.type === 'extra_turn'))
  }

  // Three consecutive sixes (PRD §17): roll 6 → move → roll 6 → move →
  // roll 6 → third is cancelled, turn passes, streak resets.
  let st = startGame(createGameState([P('a', 0), P('b', 1)]), () => 0)
  const rr1 = rollDice(st, st.currentPlayerId!, 's1', d(6))
  check('first roll ok', rr1.ok)
  if (rr1.ok) {
    const m1 = moveToken(rr1.state, rr1.state.currentPlayerId!, 'red-1', 's2')
    check('first move ok', m1.ok)
    if (m1.ok) {
      const rr2 = rollDice(m1.state, 'a', 's3', d(6))
      check('second roll ok', rr2.ok)
      if (rr2.ok) {
        const m2 = moveToken(rr2.state, 'a', 'red-2', 's4')
        check('second move ok', m2.ok)
        if (m2.ok) {
          const rr3 = rollDice(m2.state, 'a', 's5', d(6))
          check('third roll accepted by engine', rr3.ok)
          if (rr3.ok) {
            check('third six cancelled → turn passed', rr3.events.some((e) => e.type === 'six_cancelled'))
            check('turn moved to player b', rr3.state.currentPlayerId === 'b')
            check('six streak reset', rr3.state.sixStreak === 0)
            check('no pending dice after cancellation', rr3.state.dice.value === null)
          }
        }
      }
    }
  }
}

// ── Turn order (PRD §58/§59/§60) ─────────────────────────────────────────────
section('Turn order skips empty seats (PRD §58)')
{
  const s0 = startGame(createGameState([P('a', 0), P('b', 1)]), () => 0)
  check('a starts (first active)', s0.currentPlayerId === 'a')
  // 3 players at seats 0, 1, 2 — the empty seat 3 is skipped by rotation.
  const t0 = startGame(createGameState([P('a', 0), P('b', 1), P('c', 2)]), () => 0.999) // last active = c
  check('random first player is server-decided (c here)', t0.currentPlayerId === 'c')
  const p = passTurn(t0, 'c', 'timeout', 'pt')
  check('pass turn wraps c → a (seat 3 skipped)', p.ok && p.state.currentPlayerId === 'a')
  const p2 = passTurn(p.ok ? p.state : t0, 'a', 'timeout', 'pt2')
  check('rotation a → b', p2.ok && p2.state.currentPlayerId === 'b')
}

// ── Win (PRD §27) ────────────────────────────────────────────────────────────
section('Win condition (PRD §27)')
{
  const s0 = startGame(createGameState([P('a', 0), P('b', 1)]), () => 0)
  let s1: LudoGameState = {
    ...s0,
    dice: { value: 1, rolledBy: 'a', rolledAt: 1 },
    tokens: s0.tokens.map((t) =>
      t.playerId === 'a' && t.id !== 'red-1' ? { ...t, state: 'finished' as const, position: FINISH_STEP } : t
    ),
  }
  s1 = setToken(s1, 'red-1', { state: 'home', position: 55 })
  const mv = moveToken(s1, 'a', 'red-1', 'win-1')
  check('final token move ok', mv.ok)
  if (mv.ok) {
    check('status finished', mv.state.status === 'finished')
    check('winnerId set server-side', mv.state.winnerId === 'a')
    check('winner player status', mv.state.players.find((p) => p.userId === 'a')!.status === 'winner')
    check('game_finished event', mv.events.some((e) => e.type === 'game_finished'))
  }
}

// ── Leaving player recovery (PRD §41/§43/§44) ───────────────────────────────
section('Leaver recovery (PRD §41/§43/§44)')
{
  const s0 = startGame(createGameState([P('a', 0), P('b', 1), P('c', 2)]), () => 0)
  // a is current (rng=0). Remove a mid-turn: tokens removed, turn advances.
  const out = removePlayer(s0, 'a', 'lv')
  check('leaver marked left', out.state.players.find((p) => p.userId === 'a')!.status === 'left')
  check('no ghost tokens on the board', !out.state.tokens.some((t) => t.playerId === 'a'))
  check('active leaver → turn advanced to b', out.wasCurrent && out.state.currentPlayerId === 'b')
  check('turn_skipped event', out.events.some((e) => e.type === 'turn_changed' && e.playerId === 'b'))
  // Pending dice of a departed player is discarded (PRD §44).
  const s0d = { ...s0, dice: { value: 3, rolledBy: 'a', rolledAt: 1 } }
  const outD = removePlayer(s0d, 'a', 'lv-d')
  check('departed player’s pending dice discarded', outD.state.dice.value === null)
  // Dropping to a single active player reverts the room to waiting.
  const s2 = startGame(createGameState([P('x', 0), P('y', 1)]), () => 0)
  const out2 = removePlayer(s2, 'y', 'lv2')
  check('1 player left → lobby resets to waiting', out2.state.status === 'waiting')
  check('remaining tokens reset to yard', out2.state.tokens.every((t) => t.state === 'yard'))
}

// ── Security/validation (PRD §105/§106) ─────────────────────────────────────
section('Server validation (PRD §105/§106)')
{
  check('roll parser passes actionId only', parseRollRequest({ actionId: 'abcdefgh', dice: 6 })!.actionId === 'abcdefgh')
  check('roll parser rejects short action ids', parseRollRequest({ actionId: 'x' }) === null)
  check('move parser accepts canonical token ids', parseMoveRequest({ tokenId: 'red-1', actionId: 'abcdefgh' }) !== null)
  check('move parser rejects junk token ids', parseMoveRequest({ tokenId: 'gold-9', actionId: 'abcdefgh' }) === null)
  check('engine error → 403 for wrong turn', statusForEngineError('not_your_turn') === 403)
  check('engine error → 409 for illegal move', statusForEngineError('illegal_move') === 409)
  const s0 = startGame(createGameState([P('a', 0), P('b', 1)]), () => 0)
  const notTurn = rollDice(s0, 'b', 'zzzzzzzz')
  check('rolling out of turn rejected', !notTurn.ok && notTurn.error === 'not_your_turn')
  const badToken = moveToken({ ...s0, dice: { value: 3, rolledBy: 'a', rolledAt: 1 } }, 'a', 'green-1', 'zzzzzzzz')
  check("moving someone else's token rejected", !badToken.ok && badToken.error === 'not_your_token')
  const doubleRoll = rollDice({ ...s0, dice: { value: 2, rolledBy: 'a', rolledAt: 1 } }, 'a', 'zzzzzzzz')
  check('double roll rejected (dice pending)', !doubleRoll.ok && doubleRoll.error === 'dice_pending')
  const noDice = moveToken(s0, 'a', 'red-1', 'zzzzzzzz')
  check('move without a dice rejected', !noDice.ok && noDice.error === 'no_dice')
}

// ── Constants sanity ─────────────────────────────────────────────────────────
section('Game limits (PRD §5/§6)')
check('max players is exactly 4', LUDO_MAX_PLAYERS === 4)
check('finish step is 56 (51 ring + 5 home)', FINISH_STEP === 56 && HOME_ENTRY === 51)

console.log(`\n═══ Ludo engine tests: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
