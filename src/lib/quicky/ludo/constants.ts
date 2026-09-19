// Quicky — LUDO CONSTANTS (Ludo PRD §5/§6/§7/§22/§103)
//
// Pure constants for the classic 4-player Ludo game. The BOARD_SIZE 15×15
// grid, ring length and step encoding are shared by the server engine, the
// client board renderer and the tests (PRD §85 — one rule source).

import type { LudoColor, LudoSeat } from './types'

/**
 * Ludo PRD §9 — standard 15×15 logical Ludo grid. Every square is
 * addressable as { row, col }; the board renders responsively from this
 * (aspect-ratio 1/1 — never a hardcoded pixel size).
 */
export const BOARD_SIZE = 15

/** Shared main-track cells around the cross (classic Ludo ring). */
export const RING_SIZE = 52

/**
 * Step encoding (see types.ts):
 *   -1 yard · 0..50 shared track · 51..55 home path · 56 finished.
 * A token therefore travels 51 ring steps, 5 home-path cells, then center.
 */
export const HOME_ENTRY = 51
export const FINISH_STEP = 56

/**
 * Ludo PRD §6/§58 — seat → color is fixed and DETERMINISTIC:
 *   seat 0 → RED, seat 1 → GREEN, seat 2 → YELLOW, seat 3 → BLUE.
 * Turn order follows the same ring: RED → GREEN → YELLOW → BLUE (§58),
 * which is clockwise on the board.
 */
export const SEAT_COLORS: readonly LudoColor[] = ['red', 'green', 'yellow', 'blue']

export function colorForSeat(seat: number): LudoColor {
  return SEAT_COLORS[((seat % 4) + 4) % 4]
}

export function seatForColor(color: LudoColor): LudoSeat {
  return SEAT_COLORS.indexOf(color) as LudoSeat
}

/** Ring start offset per color (RED 0, GREEN 13, YELLOW 26, BLUE 39). */
export const START_OFFSET: Record<LudoColor, number> = {
  red: 0,
  green: 13,
  yellow: 26,
  blue: 39,
}

/**
 * Ludo PRD §22 — SAFE squares: the four colored start cells + the four star
 * cells 8 steps ahead of each start (classic star positions). Tokens on safe
 * squares can never be captured. Rendered subtly (small shield glow).
 */
export const SAFE_RING_CELLS: readonly number[] = [0, 8, 13, 21, 26, 34, 39, 47]

export function isSafeRingCell(ringIndex: number): boolean {
  return SAFE_RING_CELLS.includes(((ringIndex % RING_SIZE) + RING_SIZE) % RING_SIZE)
}

// ── Tuning (server-authoritative timings; Ludo PRD §42/§103) ────────────────
/** §14 REVISED — the dice are a SERVER ACTION: there is no roll button. The
 * server auto-rolls for the active player this long after the turn arms —
 * long enough for the turn change to read and the PREVIOUS dice animation
 * to leave the table, then the dice fly (ROUND-4 multiplayer PRD §16). */
export const TURN_AUTOROLL_DELAY_MS = 2_200
/** §44 REVISED — 45s VISIBLE move window once a dice is pending. When it
 * expires the chance is cancelled/skipped and the game moves forward. */
export const TURN_MOVE_TIMEOUT_MS = 45_000
/** Watchdog fires slightly AFTER the deadline so a last-moment request wins. */
export const WATCHDOG_GRACE_MS = 900
/** STARTING → PLAYING countdown (Ludo PRD §56: ~1.5s visual + join window). */
export const START_COUNTDOWN_MS = 3_000
/** Ludo PRD §5 — exactly 4 players max, 2 min. Not 6. Not 8. Not 12. */
export const LUDO_MAX_PLAYERS = 4
export const LUDO_MIN_PLAYERS = 2
export const TOKENS_PER_PLAYER = 4
/** Three consecutive sixes → third cancelled, turn passes (Ludo PRD §17). */
export const SIX_STREAK_LIMIT = 3
/** Missed-chance center popup (no backdrop) — client display window. */
export const CHANCE_MISSED_MS = 1_900

/** Point awards through the EXISTING Quicky progression (Ludo PRD §75). */
export const LUDO_POINTS_WIN = 10
export const LUDO_POINTS_PER_TOKEN = 2
export const LUDO_POINTS_PER_CAPTURE = 1

/** Client animation timings (Ludo PRD §103; ROUND-4 multiplayer PRD §16–§21
 * — the dice is ONE continuous sequence: enter → roll (decelerating face
 * changes) → settle → hold the server value → exit → THEN tokens move).
 * Presentation only — the server never waits for any of this. */
export const DICE_ENTER_MS = 240
export const DICE_ROLL_MS = 1_600
export const DICE_SETTLE_MS = 340
export const DICE_HOLD_MS = 560
export const DICE_EXIT_MS = 340
/** Total dice sequence — exported for QA + tests. */
export const DICE_SEQ_TOTAL_MS = DICE_ENTER_MS + DICE_ROLL_MS + DICE_SETTLE_MS + DICE_HOLD_MS + DICE_EXIT_MS
export const TOKEN_STEP_MS = 180
export const CAPTURE_FX_MS = 900
export const FINISH_FX_MS = 800
