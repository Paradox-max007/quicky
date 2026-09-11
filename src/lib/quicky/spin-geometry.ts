// Quicky — Spin the Bottle GEOMETRY ENGINE (PRD §10-§19, §74-§80)
//
// ONE source of truth for the 12-seat table geometry, shared by:
//   • the server  (spin-bottle.ts → bottle landing angle per seat, §76)
//   • the client  (SpinBottleRoom → seat positions, duel positions)
//
// The canonical ring (PRD §11):
//
//                    0
//             11           1
//          10                 2
//        9                     3
//          8                   4
//             7             5
//                    6
//
// Every seat sits on the SAME ellipse at EXACTLY 30° spacing:
//   angle_i = -π/2 + i · (2π / 12)          (screen coords, y grows downward;
//                                            -π/2 = straight up)
//   x_i = 50 + cos(angle_i) · RX            (percent of table width)
//   y_i = 50 + sin(angle_i) · RY            (percent of table height)
//
// No hand-authored per-seat percentages anywhere (PRD §48) — the same math
// produces a correct ring on a 320px phone and a 4K monitor, and the bottle's
// landing angle is mathematically the SAME ray as the target seat (§76-§77).

export const SEAT_COUNT = 12

// Seat-ring ellipse as a percentage of the stage (table) box. These MUST stay
// in sync with the dashed guide rings in spin-bottle-room.css
// (.sbr-ring-outer is sized 80% × 78% → rx 40 / ry 39).
export const RING_RX = 40
export const RING_RY = 39

/** Canonical angle (radians) of a seat, measured from table center. */
export function seatAngle(seatIndex: number): number {
  return -Math.PI / 2 + seatIndex * ((Math.PI * 2) / SEAT_COUNT)
}

/** Unit direction vector (screen coords) of a seat's ray from table center. */
export function seatVector(seatIndex: number): { x: number; y: number } {
  const a = seatAngle(seatIndex)
  return { x: Math.cos(a), y: Math.sin(a) }
}

/**
 * The 12 seat centers as percentages of the table box — a true 12-position
 * ring (equal 30° angular spacing, equal radial ellipse, PRD §13/§49).
 */
export function seatRingPositions(): { x: number; y: number }[] {
  return Array.from({ length: SEAT_COUNT }, (_, i) => {
    const v = seatVector(i)
    return { x: 50 + v.x * RING_RX, y: 50 + v.y * RING_RY }
  })
}

// ── Duel spotlight geometry (PRD §22/§23) ────────────────────────────────────
// The two spotlight cards sit symmetrically around the table center at a
// fixed fraction of the table — never hard-coded pixel/percent positions.
// The response panel renders BETWEEN the cards (desktop) or below them
// (mobile) via CSS anchors.

const DUEL_GAP = 17 // % of table width from center to each card center
const DUEL_Y = 42 // % of table height for the duel row

export function duelPositions(): {
  spinner: { x: number; y: number }
  target: { x: number; y: number }
} {
  return {
    spinner: { x: 50 - DUEL_GAP, y: DUEL_Y },
    target: { x: 50 + DUEL_GAP, y: DUEL_Y },
  }
}

// ── Card sizing (PRD §15-§18) ────────────────────────────────────────────────
// seatSize derives from the MEASURED TABLE (not the viewport): cards scale
// with the actual table box, so the same geometry survives every viewport.

const SEAT_SIZE_RATIO = 0.115 // seatSize = min(tableW, tableH) × 0.115
const SEAT_SIZE_MIN = 42
const SEAT_SIZE_MAX = 96

export function seatSizeFor(tableWidth: number, tableHeight: number): number {
  const tableMin = Math.min(tableWidth, tableHeight)
  if (tableMin <= 0) return 0
  return Math.round(
    Math.min(SEAT_SIZE_MAX, Math.max(SEAT_SIZE_MIN, tableMin * SEAT_SIZE_RATIO))
  )
}
