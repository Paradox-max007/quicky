// Quicky — Ludo rules engine (PRD §9.2, server-authoritative)
// Pure functions: no DB, no IO. The API route owns the authoritative state
// blob stored on GameSession.state and validates every move here before
// committing. Clients render optimistically only what this module allows.
//
// Two-player classic mode: colors 'A' (red) and 'B' (green) start opposite
// each other on a 52-cell shared track. Each token travels 56 steps total:
//   step -1      → in its yard (needs a 6 to exit)
//   step 0–50    → shared track, cell = (startOffset + step) % 52
//   step 51–55   → private home column (5 cells)
//   step 56      → center finish (exact count required)

export type LudoColor = 'A' | 'B'
export type LudoToken = number // -1 yard, 0..55 en route, 56 finished

export type LudoState = {
  tokens: Record<LudoColor, LudoToken[]>
  // Dice awaiting a move decision; null when waiting to roll
  pendingDice: number | null
  // Rolls made this turn (a 6 grants another roll)
  rollsThisTurn: number
  sixStreak: number
  winner: LudoColor | null
  // Per-player last activity ms timestamps, for the turn-forfeit policy
  lastActedAt: number
}

export const TRACK_SIZE = 52
export const FINISH_STEP = 56
export const HOME_ENTRY = 51 // first home-column step
export const TURN_TIMEOUT_MS = 45000
const SIX_STREAK_LIMIT = 3

const START_OFFSET: Record<LudoColor, number> = { A: 0, B: 26 }
// Star/safe squares: starting squares + their 8-step stars
const SAFE_CELLS = [0, 8, 26, 34]

export function initialLudoState(firstMover: LudoColor): LudoState {
  return {
    tokens: { A: [-1, -1, -1, -1], B: [-1, -1, -1, -1] },
    pendingDice: null,
    rollsThisTurn: 0,
    sixStreak: 0,
    winner: null,
    lastActedAt: Date.now(),
  }
}

/** Global track cell for a step, or null when in yard/home column/finished. */
export function trackCell(color: LudoColor, step: number): number | null {
  if (step < 0 || step >= HOME_ENTRY) return null
  return (START_OFFSET[color] + step) % TRACK_SIZE
}

/**
 * All legal moves for `color` given a rolled dice value.
 * Rules enforced: 6-to-exit, exact-count finish (no overshoot), and the
 * classic block rule — an opponent block (2+ tokens on one non-safe cell)
 * can neither be landed on nor passed through.
 */
export function legalMoves(
  state: LudoState,
  color: LudoColor,
  dice: number
): { tokenId: number; captures: number[] }[] {
  const moves: { tokenId: number; captures: number[] }[] = []
  const opp: LudoColor = color === 'A' ? 'B' : 'A'

  for (let tokenId = 0; tokenId < 4; tokenId++) {
    const step = state.tokens[color][tokenId]
    if (step === FINISH_STEP) continue

    let dest: number
    if (step < 0) {
      if (dice !== 6) continue
      dest = 0
    } else {
      dest = step + dice
      if (dest > FINISH_STEP) continue // exact count required into center
    }

    // Pass-through / landing checks against opponent blocks
    let blocked = false
    for (let s = Math.max(step, 0) + 1; s <= dest; s++) {
      const cell = trackCell(color, s)
      if (cell === null || SAFE_CELLS.includes(cell)) continue
      const opponents = state.tokens[opp].filter((t) => t >= 0 && t < HOME_ENTRY && trackCell(opp, t) === cell)
      if (opponents.length >= 2) {
        blocked = true
        break
      }
    }
    if (blocked) continue

    // Captures: land on exactly one opponent token outside a safe square
    const destCell = trackCell(color, dest)
    let captures: number[] = []
    if (dest !== FINISH_STEP && destCell !== null && !SAFE_CELLS.includes(destCell)) {
      captures = state.tokens[opp]
        .map((t, i) => ({ t, i }))
        .filter(({ t }) => t >= 0 && t < HOME_ENTRY && trackCell(opp, t) === destCell)
        .map(({ i }) => i)
    }

    moves.push({ tokenId, captures })
  }
  return moves
}

export type MoveResult = {
  state: LudoState
  events: { kind: 'capture' | 'finish' | 'win'; color?: LudoColor; tokenId?: number }[]
}

/**
 * Apply a validated move. Always call legalMoves() first and assert the chosen
 * tokenId appears there — this function trusts the caller (server).
 */
export function applyMove(
  prev: LudoState,
  color: LudoColor,
  tokenId: number,
  dice: number,
  extraTurnOnSix: boolean = true
): MoveResult {
  const state: LudoState = JSON.parse(JSON.stringify(prev))
  const opp: LudoColor = color === 'B' ? 'A' : 'B'
  const events: MoveResult['events'] = []

  const dest =
    state.tokens[color][tokenId] < 0 ? 0 : state.tokens[color][tokenId] + dice

  // Captured opponents return to their yard
  const destCell = trackCell(color, dest)
  if (destCell !== null && !SAFE_CELLS.includes(destCell)) {
    state.tokens[opp] = state.tokens[opp].map((t, i) => {
      if (t >= 0 && t < HOME_ENTRY && trackCell(opp, t) === destCell) {
        events.push({ kind: 'capture', color: opp, tokenId: i })
        return -1
      }
      return t
    })
  }
  state.tokens[color][tokenId] = dest
  state.lastActedAt = Date.now()
  if (state.tokens[color][tokenId] === FINISH_STEP) {
    events.push({ kind: 'finish', color, tokenId })
  }

  if (state.tokens[color].every((t) => t === FINISH_STEP)) {
    state.winner = color
    events.push({ kind: 'win', color })
    state.pendingDice = null
    return { state, events }
  }

  // A 6 grants another roll within the same turn (house rule toggle, default
  // ON). The three-six limit is enforced by the caller when rolling.
  if (!extraTurnOnSix && dice === 6) {
    // Treat as normal end of turn
  }
  return { state, events }
}

/** Whose turn comes next given how the previous move ended. */
export function nextTurnColor(dice: number, movedWith: LudoColor, extraTurnOnSix = true): LudoColor {
  if (extraTurnOnSix && dice === 6) return movedWith
  return movedWith === 'A' ? 'B' : 'A'
}

export { SAFE_CELLS, START_OFFSET }
