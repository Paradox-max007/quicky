// Quicky — LUDO MOVEMENT (Ludo PRD §18/§19/§53/§54)
//
// Pure helpers that turn an authoritative server transition ("token moved
// from 10 → 15") into the client-side animation path ("10 → 11 → 12 → 13 →
// 14 → 15", 150-220ms per square with ease-out + subtle bounce — §19).
// The server NEVER stores animation frames (§77); this file is client-side
// presentation logic over shared board geometry.

import { FINISH_STEP } from './constants'
import { tokenPlacement, type TokenPlacement } from './board'
import type { LudoColor } from './types'

/**
 * The list of positions a token passes through for a validated move.
 * Yard exit → single hop to the start square (§13). Track/home moves step
 * through EVERY square (§18 — never teleport). Finished moves end at the
 * center placement.
 */
export function movementPath(color: LudoColor, tokenIndex: number, from: number, to: number): TokenPlacement[] {
  if (to < from) return [tokenPlacement(color, tokenIndex, to)]
  const path: TokenPlacement[] = []
  if (from < 0) {
    // Yard exit: one bounce onto the start square.
    path.push(tokenPlacement(color, tokenIndex, 0))
    return path
  }
  for (let step = from + 1; step <= to; step++) {
    path.push(tokenPlacement(color, tokenIndex, step))
  }
  return path
}

/**
 * Number of visible hops (drives the per-step timing budget: total anim =
 * hops × TOKEN_STEP_MS, clamped by the reduced-motion policy on the client).
 */
export function hopCount(from: number, to: number): number {
  if (from < 0) return 1
  return Math.max(1, to - from)
}

/**
 * True when the move crosses from the shared track into the colored home
 * path (clients add a tiny sparkle on the turn-in step — §24).
 */
export function entersHomePath(from: number, to: number): boolean {
  return from < FINISH_STEP && from <= 50 && to > 50
}
