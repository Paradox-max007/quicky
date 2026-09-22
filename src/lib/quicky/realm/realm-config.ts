// Quicky — REALM CONFIG (realm PRD §3/§25/§85)
//
// The 15-tier realm hierarchy. Stored as admin/configuration DATA
// (RealmDefinition rows) — never hardcoded in UI components. The defaults
// below are the one-time seed; the admin panel owns every value afterwards
// (thresholds, cycle durations, per-place rewards, active/inactive).
//
// The Apex (15) is the final realm — no promotion beyond it (PRD §40).

import { db } from '@/lib/db'

export type RealmDefault = {
  level: number
  name: string
  description: string
  promotionThreshold: number
  cycleDurationDays: number
}

export const REALM_DEFAULTS: RealmDefault[] = [
  { level: 1, name: 'The Abyss', description: 'The absolute bottom; unranked, forgotten, or outcast layer.', promotionThreshold: 100, cycleDurationDays: 3 },
  { level: 2, name: 'The Dregs', description: 'Lowest recognized status; manual labor, survival, and basic subsistence.', promotionThreshold: 250, cycleDurationDays: 3 },
  { level: 3, name: 'The Fringe', description: 'The outer border; individuals on the edge of societal inclusion.', promotionThreshold: 500, cycleDurationDays: 3 },
  { level: 4, name: 'The Threshold', description: 'Entry-level status; initiates, novices, and new entrants seeking footing.', promotionThreshold: 750, cycleDurationDays: 3 },
  { level: 5, name: 'The Bedrock', description: 'The working foundation; steady, reliable, but low-status contributors.', promotionThreshold: 1000, cycleDurationDays: 3 },
  { level: 6, name: 'The Commonalty', description: 'Standard civilian status; average citizens and general working class.', promotionThreshold: 1500, cycleDurationDays: 3 },
  { level: 7, name: 'The Guild Rank', description: 'Skilled practitioners, tradespeople, and established specialists.', promotionThreshold: 2000, cycleDurationDays: 3 },
  { level: 8, name: 'The Meridian', description: 'The exact middle tier; the balancing point between lower and upper society.', promotionThreshold: 2500, cycleDurationDays: 3 },
  { level: 9, name: 'The Ascendant', description: 'Rising talent and prosperous individuals on the track to high status.', promotionThreshold: 3000, cycleDurationDays: 3 },
  { level: 10, name: 'The Dominion', description: 'Established power, influential factions, and upper-middle elites.', promotionThreshold: 4000, cycleDurationDays: 3 },
  { level: 11, name: 'The Echelon', description: 'Proven leaders, high ranking officials, and major nobility or executives.', promotionThreshold: 5000, cycleDurationDays: 3 },
  { level: 12, name: 'The Eminent', description: 'Renowned figureheads whose influence dictates regional policy or culture.', promotionThreshold: 6000, cycleDurationDays: 3 },
  { level: 13, name: 'The Sovereign Realm', description: 'Ruling bodies, monarchs, or top-tier executives with supreme command.', promotionThreshold: 7500, cycleDurationDays: 3 },
  { level: 14, name: 'The Prime', description: 'Legendary figures who define the era; almost completely untouchable status.', promotionThreshold: 9000, cycleDurationDays: 3 },
  { level: 15, name: 'The Apex', description: 'The pinnacle; absolute authority, supreme mastery, or God-tier status.', promotionThreshold: 0, cycleDurationDays: 3 },
]

export const REALM_LEVEL_MIN = 1
export const REALM_LEVEL_MAX = 15

let bootstrapCheckedAt = 0
const BOOTSTRAP_TTL_MS = 60_000

/**
 * Idempotently ensure the 15 RealmDefinition rows exist (seed on first
 * touch; afterwards a 60s in-process cache skips the count query). Safe to
 * call from every realm route — the seeding itself is conflict-guarded.
 */
export async function ensureRealmBootstrap(): Promise<void> {
  const now = Date.now()
  if (now - bootstrapCheckedAt < BOOTSTRAP_TTL_MS) return
  bootstrapCheckedAt = now

  const count = await db.realmDefinition.count().catch(() => 0)
  if (count >= REALM_DEFAULTS.length) return

  for (const r of REALM_DEFAULTS) {
    await db.realmDefinition
      .upsert({
        where: { level: r.level },
        create: { level: r.level, name: r.name, description: r.description, promotionThreshold: r.promotionThreshold, cycleDurationDays: r.cycleDurationDays },
        update: {},
      })
      .catch(() => {})
  }
}
