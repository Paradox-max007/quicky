// Quicky — REALM CYCLE SERVICE (realm PRD §5, §22, §27-§30, §36, §65, §80)
//
// One 3-day competitive period per realm level. Cycles are created LAZILY
// the first time a player at that level participates (gift send / realm
// status fetch) — each cycle SNAPSHOTS the admin's threshold + reward
// config at creation (§26/§39: later admin edits never rewrite history).
//
// Cohorts (§27-§30): players from the SAME realm level only, ≤7 members,
// assigned server-side randomly among open cohorts. Rank/promotion
// comparisons never cross cohorts (§29).
//
// Settlement (§36/§65/§80): an idempotent lazy backend job. The
// SCHEDULED→SETTLING conditional update acts as the lock; member finalRank
// writes only happen where finalRank IS NULL; reward claims are
// unique-keyed; a crashed SETTLING run is recovered after 10 minutes.

import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import { ensureRealmBootstrap } from './realm-config'
import { eligibleForPromotion } from './realm-promotion'
import { parseRewardsConfig, grantRewardItems, parseConsolationCoins } from './realm-rewards'
import { nextAfterPromotion } from './realm-seasons'
import { createPendingGrants, type GrantSpec } from '@/lib/quicky/rewards/catalog'
import { getClient } from '@/lib/quicky/realtime'

/** PRD §27/§29 — target cohort size. 8 seats: places 1-3 promote, places
 *  4-8 receive the admin-configured consolation coin gift (try-hard card). */
export const COHORT_SIZE = 8
/** A SETTLING cycle older than this is treated as crashed and re-processed. */
const SETTLING_RECOVERY_MS = 10 * 60_000

export type RealmParticipation = {
  userId: string
  realmLevel: number
  cycleId: string
  cohortId: string
  threshold: number
}

type CycleCache = { at: number; cycles: Map<number, { id: string; threshold: number }> }
let cycleCache: CycleCache | null = null
const CYCLE_CACHE_MS = 30_000

/** Admin-console PRD §10 — catalog block inside a cycle rewardSnapshot JSON. */
export type CatalogSnapshot = { first: GrantSpec[]; second: GrantSpec[]; third: GrantSpec[] }
const EMPTY_CATALOG: CatalogSnapshot = { first: [], second: [], third: [] }

function parseCatalogSnapshot(json: string | null | undefined): CatalogSnapshot {
  if (!json) return EMPTY_CATALOG
  try {
    const raw = JSON.parse(json) as { catalog?: Partial<Record<'first' | 'second' | 'third', GrantSpec[]>> }
    const clean = (list: GrantSpec[] | undefined): GrantSpec[] =>
      Array.isArray(list)
        ? list
            .filter((s) => s && typeof s.rewardId === 'string' && Number.isInteger(Number(s.quantity)) && Number(s.quantity) > 0)
            .map((s) => ({ rewardId: String(s.rewardId), level: Math.min(3, Math.max(1, Math.floor(Number(s.level) || 1))), quantity: Math.floor(Number(s.quantity)) }))
        : []
    return { first: clean(raw.catalog?.first), second: clean(raw.catalog?.second), third: clean(raw.catalog?.third) }
  } catch {
    return EMPTY_CATALOG
  }
}

/**
 * Merge the legacy item-rewards JSON with the catalog block snapshot so a
 * cycle creation preserves BOTH (§26/§39 — admin edits after creation never
 * rewrite a running cycle).
 */
async function buildCycleRewardSnapshot(level: number, legacyJson: string | null): Promise<string | null> {
  const rules = await db.realmRewardRule.findMany({ where: { realmLevel: level, isActive: true } }).catch(() => [])
  if (rules.length === 0) return legacyJson
  const spec = (position: number) =>
    rules
      .filter((r) => r.position === position)
      .map((r) => ({ rewardId: r.rewardId, level: r.level, quantity: r.quantity }))
  let base: Record<string, unknown> = {}
  if (legacyJson) {
    try {
      base = JSON.parse(legacyJson) as Record<string, unknown>
    } catch {
      base = {}
    }
  }
  return JSON.stringify({
    ...base,
    catalog: { first: spec(1), second: spec(2), third: spec(3) },
  })
}

/** Instant nudge for online users: a PENDING grant exists (popup opens). */
function notifyRewardsPending(userId: string): void {
  const supabase = getClient()
  if (!supabase) return
  void supabase
    .channel(`realm:${userId}`)
    .send({ type: 'broadcast', event: 'rewards_pending', payload: { userId } })
    .catch(() => {})
}

/** Active (endAt > now) cycle for a level, creating + snapshotting if absent. */
async function getOrCreateActiveCycle(level: number, def: { promotionThreshold: number; cycleDurationDays: number; rewards: string | null }): Promise<{ id: string; threshold: number }> {
  const now = new Date()

  if (cycleCache && Date.now() - cycleCache.at < CYCLE_CACHE_MS) {
    const hit = cycleCache.cycles.get(level)
    if (hit) return hit
  }

  let cycle = await db.realmCycle.findFirst({
    where: { realmLevel: level, status: 'ACTIVE', endAt: { gt: now } },
    orderBy: { endAt: 'asc' },
  })

  if (!cycle) {
    const durationDays = Math.max(1, def.cycleDurationDays || 3)
    const startAt = new Date()
    const endAt = new Date(startAt.getTime() + durationDays * 24 * 60 * 60 * 1000)
    // §26/§39 — snapshots at creation (legacy items + catalog rules merged).
    const rewardSnapshot = await buildCycleRewardSnapshot(level, def.rewards)
    cycle = await db.realmCycle
      .create({
        data: {
          realmLevel: level,
          startAt,
          endAt,
          status: 'ACTIVE',
          threshold: def.promotionThreshold,
          rewardSnapshot,
          durationDays,
        },
      })
      .catch(async () => {
        // unique(realmLevel, startAt) race → reuse the concurrent row.
        return db.realmCycle.findFirstOrThrow({ where: { realmLevel: level, status: 'ACTIVE', endAt: { gt: new Date() } }, orderBy: { endAt: 'asc' } })
      })
  }

  if (!cycleCache || Date.now() - cycleCache.at >= CYCLE_CACHE_MS) {
    cycleCache = { at: Date.now(), cycles: new Map() }
  }
  const entry = { id: cycle.id, threshold: cycle.threshold }
  cycleCache.cycles.set(level, entry)
  return entry
}

/**
 * Random open cohort for a cycle (§28-§29): server-side assignment among
 * cohorts with < 7 members; a fresh cohort is created when all are full.
 */
async function assignCohort(cycleId: string, realmLevel: number, userId: string): Promise<string> {
  // Cohort ids for this cycle + how many members each has (one grouped query).
  const cohorts = await db.realmCohort.findMany({ where: { cycleId, isFinalized: false }, select: { id: true } })
  if (cohorts.length > 0) {
    const counts = await db.realmCohortMember.groupBy({
      by: ['cohortId'],
      where: { cohortId: { in: cohorts.map((c) => c.id) } },
      _count: { _all: true },
    })
    const countBy = new Map(counts.map((c) => [c.cohortId, c._count._all]))
    const open = cohorts.filter((c) => (countBy.get(c.id) ?? 0) < COHORT_SIZE)
    if (open.length > 0) {
      // §28 — randomization happens on the server.
      const pick = open[Math.floor(Math.random() * open.length)]
      await db.realmCohortMember.upsert({
        where: { cohortId_userId: { cohortId: pick.id, userId } },
        create: { cohortId: pick.id, userId },
        update: {},
      })
      return pick.id
    }
  }
  const cohort = await db.realmCohort.create({ data: { cycleId, realmLevel } })
  await db.realmCohortMember.create({ data: { cohortId: cohort.id, userId } }).catch(() => {})
  return cohort.id
}

/**
 * Ensure every given user has a UserRealm row + a seat in the CURRENT
 * active cycle/cohort for their realm level. Runs BEFORE any gift
 * transaction (plain reads/writes — nothing financial). Stale assignments
 * (cycle completed while the user was away) are re-pointed at the fresh
 * cycle with cyclePoints reset — settlement already zeroed them, this just
 * guarantees it.
 */
export async function ensureRealmParticipation(userIds: string[]): Promise<Map<string, RealmParticipation>> {
  const ids = Array.from(new Set(userIds.filter(Boolean)))
  const out = new Map<string, RealmParticipation>()
  if (ids.length === 0) return out

  await ensureRealmBootstrap()

  let rows = await db.userRealm.findMany({ where: { userId: { in: ids } } })
  const have = new Set(rows.map((r) => r.userId))
  const missing = ids.filter((id) => !have.has(id))
  if (missing.length > 0) {
    await db.userRealm
      .createMany({ data: missing.map((userId) => ({ userId, realmLevel: 1 })), skipDuplicates: true })
      .catch(() => {})
    rows = await db.userRealm.findMany({ where: { userId: { in: ids } } })
  }

  // Definitions for the levels involved (cycle snapshots come from here).
  const levels = Array.from(new Set(rows.map((r) => r.realmLevel)))
  const defs = await db.realmDefinition.findMany({ where: { level: { in: levels } } })
  const defBy = new Map(defs.map((d) => [d.level, d]))

  for (const ur of rows) {
    const def = defBy.get(ur.realmLevel)
    if (!def || !def.isActive) continue
    const cycle = await getOrCreateActiveCycle(ur.realmLevel, def)

    let cohortId = ur.cohortId ?? null
    let points = ur.cyclePoints
    const stale = !ur.currentCycleId || ur.currentCycleId !== cycle.id

    if (stale) {
      // Verify the cohort actually belongs to the fresh cycle (else assign).
      const cohortOk =
        cohortId &&
        (await db.realmCohort.findFirst({ where: { id: cohortId, cycleId: cycle.id, isFinalized: false }, select: { id: true } }))
      if (!cohortOk) {
        cohortId = await assignCohort(cycle.id, ur.realmLevel, ur.userId)
      }
      points = 0
      await db.userRealm.update({
        where: { userId: ur.userId },
        data: { currentCycleId: cycle.id, cohortId, cyclePoints: 0 },
      })
    }

    out.set(ur.userId, { userId: ur.userId, realmLevel: ur.realmLevel, cycleId: cycle.id, cohortId: cohortId as string, threshold: cycle.threshold })
  }
  return out
}

// ─── SETTLEMENT (§36/§65) ───────────────────────────────────────────────────

/**
 * Settle every ACTIVE cycle whose endAt has passed (+ crashed SETTLING
 * runs older than 10 minutes). Idempotent — safe to call from ANY request.
 * Returns the number of cycles settled this call.
 */
export async function settleDueCycles(): Promise<number> {
  const now = new Date()
  const recoveryCutoff = new Date(now.getTime() - SETTLING_RECOVERY_MS)
  const due = await db.realmCycle.findMany({
    where: {
      OR: [
        { status: 'ACTIVE', endAt: { lte: now } },
        { status: 'SETTLING', endAt: { lt: recoveryCutoff } },
      ],
    },
    orderBy: { endAt: 'asc' },
    take: 25,
  })
  let settled = 0
  for (const cycle of due) {
    const ok = await settleOneCycle(cycle.id).catch(() => false)
    if (ok) settled++
  }
  return settled
}

/**
 * Settle ONE cycle. Locking: the conditional ACTIVE→SETTLING updateMany —
 * if it changes 0 rows the cycle is either already settled (final guard
 * below) or being settled by another worker right now (return false).
 */
export async function settleOneCycle(cycleId: string): Promise<boolean> {
  const cycle = await db.realmCycle.findUnique({ where: { id: cycleId } })
  if (!cycle) return false
  if (cycle.status === 'COMPLETED') return false

  if (cycle.status === 'ACTIVE') {
    const lock = await db.realmCycle.updateMany({ where: { id: cycleId, status: 'ACTIVE' }, data: { status: 'SETTLING' } })
    if (lock.count === 0) return false
  } else if (cycle.status !== 'SETTLING') {
    return false
  }

  const cohorts = await db.realmCohort.findMany({ where: { cycleId }, select: { id: true } })
  const rewardSnapshot = parseRewardsConfig(cycle.rewardSnapshot)
  // Consolation coins for places 4-8: cycle SNAPSHOT first (§26/§39 — admin
  // edits never rewrite a running cycle), the live realm definition as the
  // fallback for cycles created before the consolation system existed.
  const defRow = await db.realmDefinition.findUnique({ where: { level: cycle.realmLevel }, select: { rewards: true } }).catch(() => null)
  const consolation = parseConsolationCoins(cycle.rewardSnapshot) ?? parseConsolationCoins(defRow?.rewards ?? null)
  // Admin-console PRD §10 — catalog-based rewards assigned per position,
  // SNAPSHOTTED into the cycle at creation ("catalog" block in the JSON):
  //   { "catalog": { "first": [{rewardId, level, quantity}], ... } }
  const catalogRules = parseCatalogSnapshot(cycle.rewardSnapshot)
  const rewardsByLevel = await db.realmRewardRule.findMany({
    where: { realmLevel: cycle.realmLevel, isActive: true },
  }).catch(() => [])

  for (const cohort of cohorts) {
    const members = await db.realmCohortMember.findMany({ where: { cohortId: cohort.id } })
    // Admin-console PRD §14 — per-member season number for the rollover.
    const userRealms = await db.userRealm
      .findMany({ where: { userId: { in: members.map((m) => m.userId) } }, select: { userId: true, seasonNumber: true } })
      .catch(() => [] as { userId: string; seasonNumber: number }[])
    const userRealmByUserId = new Map<string, { userId: string; seasonNumber: number }>(userRealms.map((r) => [r.userId, r] as const))

    // §92 — deterministic ordering: points desc, then earlier
    // threshold-crossing, then earlier join, then stable id.
    const ranked = [...members].sort((a, b) => {
      if (b.cyclePoints !== a.cyclePoints) return b.cyclePoints - a.cyclePoints
      const at = a.thresholdReachedAt?.getTime() ?? Number.MAX_SAFE_INTEGER
      const bt = b.thresholdReachedAt?.getTime() ?? Number.MAX_SAFE_INTEGER
      if (at !== bt) return at - bt
      if (a.joinedAt.getTime() !== b.joinedAt.getTime()) return a.joinedAt.getTime() - b.joinedAt.getTime()
      return a.id < b.id ? -1 : 1
    })

    for (let i = 0; i < ranked.length; i++) {
      const member = ranked[i]
      const rank = i + 1
      // Idempotent final-rank write (only where still NULL).
      await db.realmCohortMember.updateMany({ where: { id: member.id, finalRank: null }, data: { finalRank: rank } }).catch(() => {})

      // Promotion at ANY level — out of The Apex (15) it becomes the SEASON
      // rollover (admin-console PRD §14: seasonNumber+1, ladder restart).
      const promoted = eligibleForPromotion(rank, member.cyclePoints, cycle.threshold)

      // §58 — a result row for EVERY member (rank always; rewards only for
      // top-3). Unique [userId, cycleId] → settlement can't double-grant.
      const place = rank === 1 ? 'first' : rank === 2 ? 'second' : rank === 3 ? 'third' : null
      const items = place ? rewardSnapshot[place] : []
      // Admin-console PRD §10/§12 — catalog rewards for this place: resolved
      // from the cycle snapshot first (§26/§39 — later admin edits never
      // rewrite a running cycle), with the live rules as the source when the
      // cycle predates the catalog system.
      const catalogSpecs: GrantSpec[] = place
        ? catalogRules[place]?.length
          ? catalogRules[place]
          : rewardsByLevel
              .filter((r) => r.position === rank)
              .map((r) => ({ rewardId: r.rewardId, level: r.level, quantity: r.quantity }))
        : []
      if (rank <= 3 || promoted) {
        const rewardsJson = JSON.stringify([
          ...(items ?? []).map((it) => ({ itemId: it.itemId, quantity: it.quantity })),
          ...catalogSpecs.map((spec) => ({ ...spec, rewardCatalog: true })),
        ])
        await db.realmRewardClaim
          .upsert({
            where: { userId_cycleId: { userId: member.userId, cycleId } },
            create: { userId: member.userId, cycleId, cohortId: cohort.id, rank, promoted, rewards: rewardsJson },
            update: {},
          })
          .catch(() => {})
        // §59/§82 — LEGACY item rewards keep flowing into the EXISTING
        // inventory (UserItem) directly (back-compat for live cycles).
        if (items && items.length > 0) {
          await grantRewardItems(member.userId, items)
        }
        // Admin-console PRD §12 — catalog rewards become PENDING grants
        // collected through the reward popup (online + offline users alike).
        if (catalogSpecs.length > 0) {
          const created = await createPendingGrants(member.userId, cycleId, cycle.realmLevel, catalogSpecs)
          if (created > 0) notifyRewardsPending(member.userId)
        }
      } else if (rank >= 4) {
        // Places 4-8 — the "try hard next time" card: an admin-configured
        // consolation coin gift per place (e.g. 4th=50 … 8th=5). The claim row
        // is create-only (unique userId+cycleId) so a re-settled crashed run
        // can never double-credit the coins.
        const coins = consolation ? consolation[String(rank) as '4' | '5' | '6' | '7' | '8'] ?? 0 : 0
        const created = await db.realmRewardClaim
          .create({
            data: {
              userId: member.userId,
              cycleId,
              cohortId: cohort.id,
              rank,
              promoted: false,
              rewards: JSON.stringify(coins > 0 ? [{ rewardId: 'consolation_coins', name: 'Consolation Coins', icon: '🪙', quantity: coins }] : []),
            },
          })
          .then(() => true)
          .catch(() => false)
        if (created && coins > 0) {
          await db.user
            .update({ where: { id: member.userId }, data: { coinBalance: { increment: coins } } })
            .catch(() => {})
        }
      }

      // Reset the user's live state: promoted → level up (or SEASON ROLLOVER
      // out of The Apex, admin-console PRD §14); everyone → fresh 0-point
      // slate + no cycle (next participation assigns the new one).
      const data: Prisma.UserRealmUpdateManyMutationInput = { cyclePoints: 0, currentCycleId: null, cohortId: null }
      if (promoted) {
        const urRow = userRealmByUserId.get(member.userId)
        const next = nextAfterPromotion(cycle.realmLevel, urRow?.seasonNumber ?? 1)
        if (next) {
          data.realmLevel = next.realmLevel
          data.seasonNumber = next.seasonNumber
        } else {
          data.realmLevel = cycle.realmLevel + 1
        }
      }
      await db.userRealm
        .updateMany({ where: { userId: member.userId }, data })
        .catch(() => {})
    }

    await db.realmCohort.updateMany({ where: { id: cohort.id, isFinalized: false }, data: { isFinalized: true } }).catch(() => {})
  }

  await db.realmCycle
    .update({ where: { id: cycleId }, data: { status: 'COMPLETED', settledAt: new Date(), completedAt: new Date() } })
    .catch(() => {})
  cycleCache = null
  return true
}
