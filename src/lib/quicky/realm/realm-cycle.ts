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
import { eligibleForPromotion, nextRealmLevel } from './realm-promotion'
import { parseRewardsConfig, grantRewardItems } from './realm-rewards'

/** PRD §27/§29 — target cohort size. */
export const COHORT_SIZE = 7
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
    cycle = await db.realmCycle
      .create({
        data: {
          realmLevel: level,
          startAt,
          endAt,
          status: 'ACTIVE',
          // §26/§39 — snapshots at creation.
          threshold: def.promotionThreshold,
          rewardSnapshot: def.rewards,
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

  for (const cohort of cohorts) {
    const members = await db.realmCohortMember.findMany({ where: { cohortId: cohort.id } })

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

      const canPromoteFromThisRealm = nextRealmLevel(cycle.realmLevel) !== null
      const promoted = canPromoteFromThisRealm && eligibleForPromotion(rank, member.cyclePoints, cycle.threshold)

      // §58 — a result row for EVERY member (rank always; rewards only for
      // top-3). Unique [userId, cycleId] → settlement can't double-grant.
      const place = rank === 1 ? 'first' : rank === 2 ? 'second' : rank === 3 ? 'third' : null
      const items = place ? rewardSnapshot[place] : []
      if (rank <= 3 || promoted) {
        const rewardsJson = JSON.stringify(items ?? [])
        await db.realmRewardClaim
          .upsert({
            where: { userId_cycleId: { userId: member.userId, cycleId } },
            create: { userId: member.userId, cycleId, cohortId: cohort.id, rank, promoted, rewards: rewardsJson },
            update: {},
          })
          .catch(() => {})
        // §59/§82 — rewards flow into the EXISTING inventory (UserItem).
        if (items && items.length > 0) {
          await grantRewardItems(member.userId, items)
        }
      }

      // Reset the user's live state: promoted → level up; everyone → fresh
      // 0-point slate + no cycle (next participation assigns the new one).
      const data: Prisma.UserRealmUpdateInput = { cyclePoints: 0, currentCycleId: null, cohortId: null }
      if (promoted) data.realmLevel = cycle.realmLevel + 1
      await db.userRealm
        .updateMany({ where: { userId: member.userId }, data: data as Prisma.UserRealmUpdateManyMutationInput })
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
