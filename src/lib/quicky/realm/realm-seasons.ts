// Quicky — SEASONS (admin-console PRD §7/§14)
//
// Seasons sit ABOVE the 15-realm ladder: a player completes every realm of
// their season (promotion out of The Apex) → seasonNumber + 1, ladder restarts
// at realm 1 (§14.1). Each season can override realm NAMES, so different
// seasons can show different realm names (§20) — the ladder engine, cycles,
// cohorts, thresholds and settlement logic are untouched.

import { db } from '@/lib/db'

export type SeasonInfo = {
  seasonNumber: number
  name: string
  description: string | null
}

/** The ACTIVE season row for a number, or null. */
export async function getSeason(seasonNumber: number) {
  if (!Number.isInteger(seasonNumber) || seasonNumber < 1) return null
  return db.realmSeason.findUnique({ where: { seasonNumber } }).catch(() => null)
}

/** Effective realm display name: the season override wins, else the ladder name. */
export function realmDisplayName(ladderName: string, season: { realmNameOverrides: string | null } | null, level: number): string {
  if (!season?.realmNameOverrides) return ladderName
  try {
    const map = JSON.parse(season.realmNameOverrides) as Record<string, string>
    const override = map[String(level)]
    return typeof override === 'string' && override.trim() ? override.trim() : ladderName
  } catch {
    return ladderName
  }
}

/** Validate + serialize admin realm-name overrides { level: name }. */
export function validateRealmNameOverrides(input: unknown): { ok: true; json: string | null } | { ok: false; message: string } {
  if (input == null) return { ok: true, json: null }
  if (typeof input !== 'object') return { ok: false, message: 'Realm name overrides must be an object.' }
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const level = Number(k)
    if (!Number.isInteger(level) || level < 1 || level > 15) return { ok: false, message: 'Realm override keys must be levels 1-15.' }
    const name = String(v ?? '').trim()
    if (!name) continue // empty string → remove the override
    out[String(level)] = name.slice(0, 40)
  }
  return { ok: true, json: Object.keys(out).length ? JSON.stringify(out) : null }
}

/**
 * The season rollover rule (§14.1): promotion out of the FINAL realm (The
 * Apex, level 15) completes the season — next season, realm 1. Returns the
 * next (realmLevel, seasonNumber) after a promotion, null when impossible.
 */
export function nextAfterPromotion(realmLevel: number, seasonNumber: number): { realmLevel: number; seasonNumber: number } | null {
  if (!Number.isInteger(realmLevel) || realmLevel < 1) return null
  if (realmLevel >= 15) return { realmLevel: 1, seasonNumber: Math.max(1, seasonNumber) + 1 }
  return { realmLevel: realmLevel + 1, seasonNumber: Math.max(1, seasonNumber) }
}

/** Bootstrap the default Season 1 when absent (idempotent, cheap). */
export async function ensureSeasonBootstrap(): Promise<void> {
  const existing = await db.realmSeason.findUnique({ where: { seasonNumber: 1 } }).catch(() => null)
  if (!existing) {
    await db.realmSeason
      .create({ data: { seasonNumber: 1, name: 'Season of Dawn', description: 'The first Quicky season — climb all 15 realms to complete it.' } })
      .catch(() => {})
  }
}
