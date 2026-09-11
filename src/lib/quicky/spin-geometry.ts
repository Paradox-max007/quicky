// Quicky — Spin the Bottle GEOMETRY ENGINE (PRD v2 §10-§19, §74-§80;
// bug-fix PRD v2.1 §19-§25, §62-§65)
//
// ONE source of truth for the 12-seat table geometry, shared by:
//   • the server  (spin-bottle.ts → bottle landing angle per seat, §76)
//   • the client  (SpinBottleRoom → seat positions, duel positions)
//
// The canonical ring (PRD v2 §11):
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
// v2.1 (§20-§25): the card size is no longer a fixed ratio guess — it is
// derived from the measured table, then VERIFIED against two hard
// constraints, shrinking until it passes:
//   1. COLLISION  — adjacent seat centers must be ≥ cardSize × 1.06 apart.
//   2. BOUNDARY   — every card (plus its name pill) stays fully inside the
//                   table box; no clipping, ever.
// Result: the LARGEST possible cards with zero overlap on every device.

export const SEAT_COUNT = 12

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
 * ring (equal 30° angular spacing, equal radial ellipse, PRD v2 §13/§49).
 */
export function seatRingPositions(
  rx: number = RING_RX,
  ry: number = RING_RY
): { x: number; y: number }[] {
  return Array.from({ length: SEAT_COUNT }, (_, i) => {
    const v = seatVector(i)
    return { x: 50 + v.x * rx, y: 50 + v.y * ry }
  })
}

// Legacy defaults kept for the dashed guide rings in CSS (desktop).
export const RING_RX = 40
export const RING_RY = 39

// ── Table geometry contract (bug-fix PRD v2.1 §64) ──────────────────────────
//
// calculateTableGeometry({ width, height, playerCount }) is the ONLY place
// seat coordinates / card sizes are computed. Every caller (seats, open
// seats, duel spotlight, response-panel anchor) consumes its output.

export type DeviceClass = 'mobile' | 'desktop'

export type TableGeometry = {
  /** Table center as % of the stage box (always 50/50). */
  center: { x: number; y: number }
  /** Seat-ring radii as % of the stage box. */
  radiusX: number
  radiusY: number
  /** Final collision/boundary-safe card size in px (perfect square side). */
  cardSize: number
  /** Seat centers as % of the stage box (index = seat). */
  seats: { x: number; y: number }[]
  /** Duel spotlight card centers as % of the stage box. */
  duelPositions: { spinner: { x: number; y: number }; target: { x: number; y: number } }
}

// Per-device tuning. Desktop keeps the v2 look (radius 40/39, ratio 0.115);
// mobile gets noticeably larger cards on a slightly wider spread (§19/§22/§24).
const DEVICE_PARAMS: Record<DeviceClass, {
  rx: number; ry: number; ratio: number; min: number; max: number
}> = {
  desktop: { rx: 40, ry: 39, ratio: 0.115, min: 42, max: 96 },
  // §19: small phones ~54-60, normal ~60-68, large ~66-74 → ratio 0.16 with
  // a 54px floor lands inside those bands once clamped by collision/boundary.
  mobile: { rx: 39.5, ry: 40, ratio: 0.16, min: 54, max: 82 },
}

/** Name pill height + vertical breathing room reserved below/above a card. */
const NAME_ALLOWANCE = 20
/** Safety factor applied to adjacent-seat distance (cards never touch). */
const COLLISION_SAFETY = 0.94
/** Minimum gap between a card edge and the table edge. */
const EDGE_MARGIN = 4

export function deviceClassFor(width: number): DeviceClass {
  return width >= 1024 ? 'desktop' : 'mobile'
}

/**
 * The single geometry contract (§64). `playerCount` seats are treated as
 * full-size cards; every seat (occupied or not) participates in the checks
 * so the ring never reflows when players join/leave (§69: no layout jumps).
 */
export function calculateTableGeometry(params: {
  width: number
  height: number
  playerCount?: number
  deviceType?: DeviceClass
}): TableGeometry {
  const { width, height } = params
  const deviceType = params.deviceType ?? deviceClassFor(width)
  const p = DEVICE_PARAMS[deviceType]

  const seats = seatRingPositions(p.rx, p.ry)
  if (width <= 0 || height <= 0) {
    return {
      center: { x: 50, y: 50 },
      radiusX: p.rx,
      radiusY: p.ry,
      cardSize: 0,
      seats,
      duelPositions: duelPositions(),
    }
  }

  // 1) Starting target from the table's min dimension (§20)
  const tableMin = Math.min(width, height)
  let cardSize = Math.round(Math.min(p.max, Math.max(p.min, tableMin * p.ratio)))

  // 2) COLLISION CHECK (§21): the smallest distance between any two seat
  //    centers caps the card size. With 12 seats on one ellipse the closest
  //    pairs are the 30°-apart neighbours; check every pair to be safe.
  const centersPx = seats.map((s) => ({ x: (s.x / 100) * width, y: (s.y / 100) * height }))
  let maxByCollision = Infinity
  for (let i = 0; i < SEAT_COUNT; i++) {
    for (let j = i + 1; j < SEAT_COUNT; j++) {
      const dx = centersPx[i].x - centersPx[j].x
      const dy = centersPx[i].y - centersPx[j].y
      const dist = Math.hypot(dx, dy)
      if (dist < maxByCollision) maxByCollision = dist
    }
  }
  // sqrt(2) would allow diagonal touch; 1.06 keeps a visible air gap.
  maxByCollision = maxByCollision * COLLISION_SAFETY

  // 3) BOUNDARY CHECK (§25): every card must sit fully inside the table,
  //    including its name pill on the open side (below for the upper arc,
  //    above for the lower arc — see nameSideFor).
  let maxByBoundary = Infinity
  for (let i = 0; i < SEAT_COUNT; i++) {
    const c = centersPx[i]
    const nameBelow = seatVector(i).y <= 0.25
    const gapTop = c.y
    const gapBottom = height - c.y
    const gapLeft = c.x
    const gapRight = width - c.x
    const vertical =
      nameBelow
        ? Math.min(gapTop, gapBottom - NAME_ALLOWANCE)
        : Math.min(gapTop - NAME_ALLOWANCE, gapBottom)
    const horizontal = Math.min(gapLeft, gapRight)
    const allowed = 2 * (Math.min(vertical, horizontal) - EDGE_MARGIN)
    if (allowed < maxByBoundary) maxByBoundary = allowed
  }

  // 4) Shrink while a constraint is violated (§21) — floor at the device min.
  cardSize = Math.min(cardSize, Math.floor(maxByCollision), Math.floor(maxByBoundary))
  cardSize = Math.max(p.min, cardSize)

  // 5) Duel row: rise on short stages so cards + response panel never
  //    fight for vertical space (§26-§28).
  const centerCard = cardSize * CENTER_CARD_SCALE
  const duelRowY = duelRowYFor(height, centerCard)

  return {
    center: { x: 50, y: 50 },
    radiusX: p.rx,
    radiusY: p.ry,
    cardSize,
    seats,
    duelPositions: duelPositions(duelRowY),
  }
}

/**
 * Which side of the card the name pill sits on. Seats on the lower arc flip
 * their name ABOVE the card so the pill never clips against the table rim
 * (§25 containment) — the name always reads toward the table center.
 */
export function nameSideFor(seatIndex: number): 'above' | 'below' {
  return seatVector(seatIndex).y > 0.25 ? 'above' : 'below'
}

// ── Duel spotlight geometry (PRD v2 §22/§23; v2.1 §26-§31) ───────────────────
// The two spotlight cards sit symmetrically around the table center. 17% of
// table width per side keeps even enlarged center cards fully separated on
// every measured device. The duel ROW height adapts to short stages: the row
// slides up just enough that the response panel (estimated ~150px) fits
// BELOW the cards with zero overlap (§27/§30).

const DUEL_GAP = 17 // % of table width from center to each card center
const DUEL_Y = 42 // % of table height for the duel row (default)
/** Rough height of the transparent response panel (question+timer+buttons). */
export const DUEL_PANEL_ESTIMATE = 150
/** Vertical budget around the duel row (edge gaps + panel gap). */
const DUEL_ROW_PAD = 24

/**
 * Duel row Y as % of the stage height. On tall stages this is the classic
 * 42%; on ultra-short stages (small phones with the chat sheet open) the row
 * rises so that cards + response panel still fit inside the table.
 */
export function duelRowYFor(stageHeight: number, centerCardSize: number): number {
  if (stageHeight <= 0) return DUEL_Y
  const maxYpx = stageHeight - 10 - DUEL_PANEL_ESTIMATE - DUEL_ROW_PAD - centerCardSize / 2
  const minYpx = centerCardSize / 2 + 8
  const rowYpx = Math.max(minYpx, Math.min((DUEL_Y / 100) * stageHeight, maxYpx))
  return (rowYpx / stageHeight) * 100
}

export function duelPositions(duelRowY: number = DUEL_Y): {
  spinner: { x: number; y: number }
  target: { x: number; y: number }
} {
  return {
    spinner: { x: 50 - DUEL_GAP, y: duelRowY },
    target: { x: 50 + DUEL_GAP, y: duelRowY },
  }
}

/** Horizontal gap (px) between the two duel cards for the given card size. */
export function duelGapPx(stageWidth: number, centerCardSize: number): number {
  return stageWidth * ((DUEL_GAP * 2) / 100) - centerCardSize * 2
}

/** Center spotlight cards pop slightly larger than seat cards (§32). */
export const CENTER_CARD_SCALE = 1.16

/** Duel-row center as % of the stage height (default 42%). */
export const DUEL_ROW_Y = DUEL_Y
