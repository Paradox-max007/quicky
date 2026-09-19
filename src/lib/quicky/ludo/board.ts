// Quicky — LUDO BOARD GEOMETRY (Ludo PRD §8/§9/§10/§22)
//
// The classic four-home Ludo board on a 15×15 logical grid:
//
//   ┌───────────┬───────────┐
//   │   RED     │   GREEN   │   rows 0-5   (yards)
//   ├───────────┼───────────┤
//   │   TRACK (cross arms + middle lines)  │
//   ├───────────┼───────────┤
//   │   BLUE    │  YELLOW   │   rows 9-14  (yards)
//   └───────────┴───────────┘
//
// RED top-left → GREEN top-right → YELLOW bottom-right → BLUE bottom-left.
// Turn order RED→GREEN→YELLOW→BLUE (seat order) is CLOCKWISE, matching the
// ring direction below. Pure math only — the renderer scales {row,col} to
// any board size (PRD §9: never hardcode px, aspect-ratio 1/1).

import type { LudoColor } from './types'
import { BOARD_SIZE, FINISH_STEP, HOME_ENTRY, RING_SIZE, START_OFFSET } from './constants'

export type Cell = { row: number; col: number }

// ── The 52-cell main ring (clockwise, index 0 = RED start) ──────────────────
// Built by walking the cross: left arm top line → up the left side of the
// top arm → top arm tip → down its right side → right arm top line → …
function buildRing(): Cell[] {
  const ring: Cell[] = []
  const push = (row: number, col: number) => ring.push({ row, col })
  // RED start region: row 6, cols 1..5 (moving right toward center)
  for (let col = 1; col <= 5; col++) push(6, col)
  // Up the left column of the top arm: rows 5..0, col 6
  for (let row = 5; row >= 0; row--) push(row, 6)
  // Top arm tip (green entry approach cell)
  push(0, 7)
  // Down the right column of the top arm: rows 0..5, col 8
  for (let row = 0; row <= 5; row++) push(row, 8)
  // GREEN start region: row 6, cols 9..14 (moving right)
  for (let col = 9; col <= 14; col++) push(6, col)
  // Right arm tip
  push(7, 14)
  // Back along the bottom line of the right arm: row 8, cols 14..9
  for (let col = 14; col >= 9; col--) push(8, col)
  // YELLOW start region: col 8, rows 9..14 (moving down)
  for (let row = 9; row <= 14; row++) push(row, 8)
  // Bottom arm tip
  push(14, 7)
  // Up the right column of the bottom arm: rows 14..9, col 6
  for (let row = 14; row >= 9; row--) push(row, 6)
  // BLUE start region: row 8, cols 5..0 (moving left)
  for (let col = 5; col >= 0; col--) push(8, col)
  // Left arm tip
  push(7, 0)
  // Close the loop back to the RED corner cell
  push(6, 0)
  return ring
}

export const RING: readonly Cell[] = buildRing()

// ── Home paths (5 colored cells per color, toward the center) ───────────────
// Each color enters its home path from the ring cell 50 steps after its
// start (i.e. the arm tip facing its own yard side), then walks the colored
// middle line toward the center triangle.
export const HOME_PATHS: Record<LudoColor, readonly Cell[]> = {
  // RED: enters from the left arm tip (7,0) → walks right toward center
  red: [ { row: 7, col: 1 }, { row: 7, col: 2 }, { row: 7, col: 3 }, { row: 7, col: 4 }, { row: 7, col: 5 } ],
  // GREEN: enters from the top arm tip (0,7) → walks down toward center
  green: [ { row: 1, col: 7 }, { row: 2, col: 7 }, { row: 3, col: 7 }, { row: 4, col: 7 }, { row: 5, col: 7 } ],
  // YELLOW: enters from the right arm tip (7,14) → walks left toward center
  yellow: [ { row: 7, col: 13 }, { row: 7, col: 12 }, { row: 7, col: 11 }, { row: 7, col: 10 }, { row: 7, col: 9 } ],
  // BLUE: enters from the bottom arm tip (14,7) → walks up toward center
  blue: [ { row: 13, col: 7 }, { row: 12, col: 7 }, { row: 11, col: 7 }, { row: 10, col: 7 }, { row: 9, col: 7 } ],
}

/** Ring step s (0..50) of `color` → shared ring cell, or null off-track. */
export function trackCellForStep(color: LudoColor, step: number): Cell | null {
  if (step < 0 || step >= HOME_ENTRY) return null
  return RING[(START_OFFSET[color] + step) % RING_SIZE]
}

/** Home-path step s (51..55) → colored cell, or null. */
export function homeCellForStep(color: LudoColor, step: number): Cell | null {
  if (step < HOME_ENTRY || step >= FINISH_STEP) return null
  return HOME_PATHS[color][step - HOME_ENTRY] ?? null
}

/** Ring index of the cell a `color` token on step 0..50 occupies. */
export function ringIndexForStep(color: LudoColor, step: number): number | null {
  if (step < 0 || step >= HOME_ENTRY) return null
  return (START_OFFSET[color] + step) % RING_SIZE
}

/**
 * Cell + in-cell offset for ANY token position — the single coordinate
 * source for the renderer (PRD §9: everything derived from the grid).
 * Yard/finished slots are fractional positions inside their blocks so the
 * renderer can place stacked tokens precisely.
 */
export type TokenPlacement =
  | { kind: 'yard'; row: number; col: number }
  | { kind: 'track' | 'home'; row: number; col: number }
  | { kind: 'finished'; row: number; col: number }

/** Yard block origin (top-left cell) per color. */
export const YARD_ORIGIN: Record<LudoColor, Cell> = {
  red: { row: 0, col: 0 },
  green: { row: 0, col: 9 },
  yellow: { row: 9, col: 9 },
  blue: { row: 9, col: 0 },
}

/** The 4 yard slots (2×2 inside the 6×6 yard block), in cell units. */
export const YARD_SLOTS: readonly { row: number; col: number }[] = [
  { row: 1.5, col: 1.5 },
  { row: 1.5, col: 3.5 },
  { row: 3.5, col: 1.5 },
  { row: 3.5, col: 3.5 },
]

/** Center-block finished slot layout — COLOR-SPECIFIC (Unified PRD fix).
 *
 * The old shared FINISHED_SLOTS put EVERY color's finished tokens on the
 * same four center spots: a finished RED token and a finished BLUE token
 * stacked directly on top of each other and became unreadable. Now each
 * color's four tokens gather in a tight 2×2 mini-cluster inside the
 * quadrant of the center block its HOME PATH enters from (red west ·
 * green north · yellow east · blue south), so finished piles of different
 * colors sit in their own corner of the triangle and never collide.
 *
 * Slot coordinates are token-center units (same convention as YARD_SLOTS);
 * the renderer scales {row,col} to any board size. */
function finishedCluster(cx: number, cy: number): { row: number; col: number }[] {
  const d = 0.22 // half the 0.44-cell cluster pitch
  return [
    { row: cy - d, col: cx - d },
    { row: cy - d, col: cx + d },
    { row: cy + d, col: cx - d },
    { row: cy + d, col: cx + d },
  ]
}

export const FINISHED_SLOTS: Record<LudoColor, readonly { row: number; col: number }[]> = {
  // RED home path walks row 7 west → east → the red pile sits left-of-center.
  red: finishedCluster(6.92, 7.5),
  // GREEN home path walks col 7 north → south → the green pile sits above center.
  green: finishedCluster(7.5, 6.92),
  // YELLOW home path walks row 7 east → west → the yellow pile sits right-of-center.
  yellow: finishedCluster(8.08, 7.5),
  // BLUE home path walks col 7 south → north → the blue pile sits below center.
  blue: finishedCluster(7.5, 8.08),
}

export function tokenPlacement(color: LudoColor, tokenIndex: number, position: number): TokenPlacement {
  if (position < 0) {
    const origin = YARD_ORIGIN[color]
    const slot = YARD_SLOTS[tokenIndex % YARD_SLOTS.length]
    return { kind: 'yard', row: origin.row + slot.row, col: origin.col + slot.col }
  }
  if (position >= FINISH_STEP) {
    const slots = FINISHED_SLOTS[color]
    const slot = slots[tokenIndex % slots.length]
    return { kind: 'finished', row: slot.row, col: slot.col }
  }
  const track = trackCellForStep(color, position)
  if (track) return { kind: 'track', row: track.row, col: track.col }
  const home = homeCellForStep(color, position)
  if (home) return { kind: 'home', row: home.row, col: home.col }
  // Unreachable (position validated by rules.ts) — park at center.
  return { kind: 'finished', row: 7.25, col: 7.25 }
}

// ── Static cell classification for rendering ────────────────────────────────
export type LudoCellKind =
  | 'empty'
  | 'track'
  | 'safe'
  | 'start'
  | 'home_path'
  | 'yard'
  | 'center'

export function cellStartColor(row: number, col: number): LudoColor | null {
  for (const c of Object.keys(START_OFFSET) as LudoColor[]) {
    const cell = RING[START_OFFSET[c]]
    if (cell.row === row && cell.col === col) return c
  }
  return null
}

export function homePathColorAt(row: number, col: number): LudoColor | null {
  for (const c of Object.keys(HOME_PATHS) as LudoColor[]) {
    if (HOME_PATHS[c].some((cell) => cell.row === row && cell.col === col)) return c
  }
  return null
}

/** Is (row,col) part of the shared ring? */
export function isRingCell(row: number, col: number): boolean {
  return RING.some((c) => c.row === row && c.col === col)
}

/** The board's cross-track cells (ring + home paths), for cheap lookups. */
export function buildCellIndex(): Map<string, { kind: LudoCellKind; color: LudoColor | null; ringIndex: number | null }> {
  const map = new Map<string, { kind: LudoCellKind; color: LudoColor | null; ringIndex: number | null }>()
  RING.forEach((cell, idx) => {
    map.set(`${cell.row},${cell.col}`, { kind: 'track', color: null, ringIndex: idx })
  })
  for (const c of Object.keys(HOME_PATHS) as LudoColor[]) {
    for (const cell of HOME_PATHS[c]) {
      map.set(`${cell.row},${cell.col}`, { kind: 'home_path', color: c, ringIndex: null })
    }
  }
  return map
}

export const CENTER_CELLS: readonly Cell[] = (() => {
  const cells: Cell[] = []
  for (let row = 6; row <= 8; row++) {
    for (let col = 6; col <= 8; col++) cells.push({ row, col })
  }
  return cells
})()

export const YARD_CELLS: readonly Cell[] = (() => {
  const cells: Cell[] = []
  for (const c of Object.keys(YARD_ORIGIN) as LudoColor[]) {
    const o = YARD_ORIGIN[c]
    for (let row = o.row; row < o.row + 6; row++) {
      for (let col = o.col; col < o.col + 6; col++) cells.push({ row, col })
    }
  }
  return cells
})()

/** Guard used by tests: ring must be exactly the classic 52 cells. */
export function assertBoardIntegrity(): void {
  if (RING.length !== RING_SIZE) throw new Error(`ring size ${RING.length} != ${RING_SIZE}`)
  const seen = new Set<string>()
  for (const c of RING) {
    const key = `${c.row},${c.col}`
    if (seen.has(key)) throw new Error(`duplicate ring cell ${key}`)
    seen.add(key)
    if (c.row < 0 || c.row >= BOARD_SIZE || c.col < 0 || c.col >= BOARD_SIZE) {
      throw new Error(`ring cell out of board: ${key}`)
    }
  }
  for (const c of Object.keys(HOME_PATHS) as LudoColor[]) {
    if (HOME_PATHS[c].length !== 5) throw new Error(`home path ${c} length != 5`)
  }
}
