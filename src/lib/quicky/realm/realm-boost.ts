// Quicky — REALM FINAL-HOURS BOOST (Game Economy PRD §22-§30, §64-§66)
//
// Every realm cycle automatically receives a final-hours multiplier event:
// the boost activates at `cycleEnd − hoursBeforeEnd` and ends at `cycleEnd`.
//   · Default config row (realmLevel NULL) applies to every realm; a
//     per-realm row overrides it (PRD §65 — "Realm 5 → 4×").
//   · The multiplier is resolved from the SERVER clock ONLY (§27) — the
//     client can never request or fake it (§28).
//   · It is never randomized (§24): the active value is displayed before
//     the user spends (gift sheet header / store banner / leaderboard).
//
// This module is pure resolution (reads only) so planRealmAward can call it
// inside the pre-transaction phase; the award itself stays in
// realm-points.ts.

import { db } from '@/lib/db'

export type RealmBoostSnapshot = {
  active: boolean
  multiplier: number
  /** Hours before the cycle end at which the boost activates (config). */
  hoursBeforeEnd: number
  /** ISO string of the moment the boost ends (= the cycle end). */
  endsAt: string | null
  /** ISO string of the moment the boost started (end − hours). */
  startsAt: string | null
  /** The realm level this resolution was for (null = default config). */
  realmLevel: number | null
}

export const IDLE_BOOST: RealmBoostSnapshot = {
  active: false,
  multiplier: 1,
  hoursBeforeEnd: 4,
  endsAt: null,
  startsAt: null,
  realmLevel: null,
}

type BoostConfigRow = { realmLevel: number | null; hoursBeforeEnd: number; multiplier: number; enabled: boolean }

let configCache: { at: number; rows: BoostConfigRow[] } | null = null
const CONFIG_CACHE_MS = 15_000

async function getBoostConfigs(): Promise<BoostConfigRow[]> {
  const cached = configCache
  if (cached && Date.now() - cached.at < CONFIG_CACHE_MS) return cached.rows
  const rows = (await db.realmBoostConfig
    .findMany({ select: { realmLevel: true, hoursBeforeEnd: true, multiplier: true, enabled: true } })
    .catch(() => [])) as BoostConfigRow[]
  configCache = { at: Date.now(), rows }
  return rows
}

/** Invalidate the config cache (admin edits a boost config → next read is fresh). */
export function invalidateBoostConfigCache(): void {
  configCache = null
}

function resolveConfig(rows: BoostConfigRow[], realmLevel: number | null): BoostConfigRow {
  const specific = realmLevel != null ? rows.find((r) => r.realmLevel === realmLevel) : undefined
  const fallback = rows.find((r) => r.realmLevel === null)
  return (
    specific ??
    fallback ?? {
      realmLevel: null,
      hoursBeforeEnd: 4,
      multiplier: 2,
      enabled: true,
    }
  )
}

/**
 * Resolve the boost for ONE realm level using that level's ACTIVE cycle end
 * (cycles are per-realm-level, so the window is uniform for every member of
 * the level — PRD §22). Server time only.
 */
export async function getBoostForLevel(realmLevel: number | null): Promise<RealmBoostSnapshot> {
  const rows = await getBoostConfigs()
  const cfg = resolveConfig(rows, realmLevel)
  if (!cfg.enabled || cfg.multiplier <= 1) return { ...IDLE_BOOST, realmLevel }

  let cycleEnd: Date | null = null
  if (realmLevel != null) {
    const cycle = await db.realmCycle
      .findFirst({
        where: { realmLevel, status: 'ACTIVE', endAt: { gt: new Date() } },
        orderBy: { endAt: 'asc' },
        select: { endAt: true },
      })
      .catch(() => null)
    cycleEnd = cycle?.endAt ?? null
  }
  if (!cycleEnd) return { ...IDLE_BOOST, realmLevel }

  const now = Date.now()
  const endMs = cycleEnd.getTime()
  const windowMs = Math.max(0, cfg.hoursBeforeEnd) * 3_600_000
  const startMs = endMs - windowMs
  const active = now >= startMs && now < endMs
  return {
    active,
    multiplier: active ? cfg.multiplier : 1,
    hoursBeforeEnd: cfg.hoursBeforeEnd,
    endsAt: active ? cycleEnd.toISOString() : null,
    startsAt: active ? new Date(startMs).toISOString() : null,
    realmLevel,
  }
}

/** The viewer's own boost (their current realm + cycle) — banner feeds. */
export async function getViewerBoost(userId: string): Promise<RealmBoostSnapshot> {
  const ur = await db.userRealm.findUnique({ where: { userId }, select: { realmLevel: true } }).catch(() => null)
  if (!ur) return { ...IDLE_BOOST }
  return getBoostForLevel(ur.realmLevel)
}

/**
 * The multiplier a GIFT from this sender earns right now: scheduled event ×
 * final-hours boost (PRD §17 + §22). Returns the combined value plus the
 * breakdown for the ledger metadata so audits stay honest.
 */
export async function resolveGiftBoost(
  senderRealmLevel: number | null,
  eventMultiplier: number
): Promise<{ multiplier: number; boost: RealmBoostSnapshot }> {
  const boost = await getBoostForLevel(senderRealmLevel)
  return { multiplier: Math.max(1, eventMultiplier) * boost.multiplier, boost }
}

/** Admin upsert helper (also used by the admin route). */
export async function upsertBoostConfig(input: {
  realmLevel: number | null
  hoursBeforeEnd?: number
  multiplier?: number
  enabled?: boolean
}) {
  const hours =
    input.hoursBeforeEnd != null ? Math.min(48, Math.max(0.5, Number(input.hoursBeforeEnd) || 4)) : undefined
  const multiplier =
    input.multiplier != null ? Math.min(100, Math.max(1, Math.floor(Number(input.multiplier)) || 2)) : undefined
  const data: Record<string, unknown> = {}
  if (hours != null) data.hoursBeforeEnd = hours
  if (multiplier != null) data.multiplier = multiplier
  if (input.enabled != null) data.enabled = !!input.enabled
  // Prisma's unique-where cannot look up a NULL realmLevel (the default row),
  // so the upsert is findFirst + update/create. Admin-only, rare writes —
  // the tiny race is harmless (a duplicate default row is collapsed by the
  // reader's first-match resolution).
  const existing = await db.realmBoostConfig.findFirst({ where: { realmLevel: input.realmLevel }, select: { id: true } })
  const row = existing
    ? await db.realmBoostConfig.update({ where: { id: existing.id }, data })
    : await db.realmBoostConfig.create({
        data: {
          realmLevel: input.realmLevel,
          hoursBeforeEnd: hours ?? 4,
          multiplier: multiplier ?? 2,
          enabled: input.enabled ?? true,
        },
      })
  invalidateBoostConfigCache()
  return row
}
