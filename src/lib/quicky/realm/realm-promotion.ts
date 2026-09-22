// Quicky — REALM PROMOTION RULE (realm PRD §31-§34, §40 + admin-console PRD §14)
//
// THE single canonical promotion rule (PRD §32: "This rule must live in one
// server-side progression service. Do not duplicate it in frontend / API
// route / cron / admin / leaderboard component.") — every consumer
// (settlement, leaderboard hints, admin previews) imports from HERE.

/** Canonical rule: rank ≤ 3 AND cyclePoints ≥ the cycle's threshold. */
export function eligibleForPromotion(rank: number, cyclePoints: number, threshold: number): boolean {
  return rank <= 3 && cyclePoints >= threshold
}

/**
 * The next realm level, or null at the cap. The Apex (15) has no Level 16
 * (PRD §40) — instead, promotion out of The Apex completes the SEASON
 * (admin-console PRD §14): the player rolls into season N+1 and restarts the
 * ladder at realm 1. See realm-seasons.nextAfterPromotion.
 */
export function nextRealmLevel(level: number): number | null {
  return level >= 15 ? null : level + 1
}

/** Points still needed to reach the cycle threshold (never negative). */
export function pointsToThreshold(cyclePoints: number, threshold: number): number {
  return Math.max(0, threshold - cyclePoints)
}
