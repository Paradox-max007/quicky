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
 * the "new player's turn" reading beat (the name/colour change must be
 * readable before the die starts flying). TURN-ROTATION: this beat arms for
 * EVERY seat change — 2P and 4P alike — so the roll alternates
 * player-to-player; only a rolled 6 keeps the turn (§16).
 * NOTE: this is the MINIMUM wait only — the next roll ALSO honours
 * ROLL_SPACING_MS (below) so the previous die's animation always completes. */
export const TURN_AUTOROLL_DELAY_MS = 1_500
/** §44 REVISED — 30s VISIBLE move window once a dice is pending. When it
 * expires the chance is cancelled/skipped and the game moves forward.
 * (was 45s — shortened per product revision; the visible countdown now also
 * renders NEXT TO the rolled number in the round bar.) */
export const TURN_MOVE_TIMEOUT_MS = 30_000
/** Watchdog fires slightly AFTER the deadline so a last-moment request wins. */
export const WATCHDOG_GRACE_MS = 250
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

/** Client animation timings (Ludo PRD §103; Unified PRD §38/§39 + the
 * animation-sync revision) — the dice is ONE continuous sequence:
 * enter → roll (decelerating tumble) → settle on the server value → hold →
 * exit → THEN tokens move. Presentation only — the server never waits for
 * any of this.
 *
 * ANIMATION-SYNC REVISION (5-second choreography): the sequence was extended
 * from ~3.08s to a full ~5.0s so that on mobile / Capacitor the dice tumble,
 * the landed face, the "{name}: rolled {n}" hint and the 30s move timer all
 * have room to land on EXACTLY the same beat (see DICE_REVEAL_MS below — the
 * single sync anchor the round bar, the token-selectability gate and the
 * server move deadline are all keyed to). */
export const DICE_ENTER_MS = 300
export const DICE_ROLL_MS = 2_600
export const DICE_SETTLE_MS = 600
export const DICE_HOLD_MS = 1_400
export const DICE_EXIT_MS = 350
/** Total dice sequence — exported for QA + tests. */
export const DICE_SEQ_TOTAL_MS = DICE_ENTER_MS + DICE_ROLL_MS + DICE_SETTLE_MS + DICE_HOLD_MS + DICE_EXIT_MS
/**
 * ROLL SPACING (the "turn is not switching" fix) — the minimum gap between
 * two consecutive roll EVENTS, whatever players they belong to. A no-move
 * roll passes the turn INSTANTLY server-side (correct classic Ludo); without
 * this gate the next player's auto-roll landed ~1.75s later — BEFORE the
 * previous roll's dice animation (5.25s enter→exit) had even LANDED, so the
 * sequencer cut every no-move roll mid-flight: the die never settled, the
 * round bar flickered between players, and the only readable rolls were the
 * interactive ones (a 6) — which then CHAIN (§16 extra roll), making it look
 * like ONE player hogs every turn and the rotation never switches. Gating
 * the next roll on the previous sequence's completion makes EVERY roll —
 * including instant passes and third-six cancellations — fully visible on
 * every device, and the seat rotation reads exactly like a real table:
 * roll → land on the number → "no moves, turn passes" → NEXT player.
 * Sized on the shared client choreography: full sequence + a clean gap. */
export const ROLL_SPACING_MS = DICE_SEQ_TOTAL_MS + 250
/**
 * THE SYNC ANCHOR (Unified PRD §41 sync revision): the beat inside the dice
 * sequence at which the die lands on the SERVER value. Exactly on this beat
 * three things flip TOGETHER everywhere:
 *   1. the "You rolled: {n}" round-bar hint appears (sequencer setHint),
 *   2. the coins become selectable (sequencer `revealed`),
 *   3. the visible 30s move timer starts (server sets moveDeadlineAt to
 *      roll + DICE_REVEAL_MS + TURN_MOVE_TIMEOUT_MS so the FULL window is
 *      pick time, and the round bar only shows the countdown from here).
 */
export const DICE_REVEAL_MS = DICE_ENTER_MS + DICE_ROLL_MS + DICE_SETTLE_MS
export const TOKEN_STEP_MS = 180
export const CAPTURE_FX_MS = 900
export const FINISH_FX_MS = 800
