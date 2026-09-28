// Quicky — UNIFIED REALM POINT SERVICE (Game Economy PRD §56-§58)
//
// ONE canonical entry point for every NON-GIFT realm point award:
//   awardRealmPoints({ source: 'CRATE' | 'EVENT' | 'BONUS' | 'ADMIN', ... })
// The gift path stays in realm-points.ts (it must share the gift
// transaction); everything else — crate rewards, event grants, admin
// adjustments — flows through HERE so no route ever invents its own
// calculation (PRD §57: "all routes eventually call awardRealmPoints()").
//
// Guarantees (PRD §67):
//   · server-only math, atomic counter increments
//   · immutable RealmPointLedger rows (sourceType + sourceId idempotency)
//   · participation + threshold tie-breaker bookkeeping
//   · optional Supabase push so the realm HUD moves the moment a crate
//     grants points (§56: crates update points/leaderboard/threshold
//     through the SAME authoritative progression path).

import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { ensureRealmParticipation } from './realm-cycle'
import { awardSeasonPoints, getOrCreateActiveSeason, seasonEventBoost } from '@/lib/quicky/season'
import { getClient } from '@/lib/quicky/realtime'

export type RealmPointSource = 'CRATE' | 'EVENT' | 'BONUS' | 'ADMIN'

export type AwardRealmPointsInput = {
  userId: string
  points: number
  source: RealmPointSource
  /** Idempotency key (e.g. the CratePurchase id) — retried calls never double-award. */
  sourceId: string
  metadata?: Record<string, unknown>
}

export type AwardRealmPointsResult = {
  awarded: boolean
  points: number
  cyclePoints: number
  realmLevel: number | null
}

/**
 * Award realm points to ONE user outside the gift flow. Crates call this
 * with source 'CRATE' (PRD §41: cash → crate → realm points → leaderboard);
 * admin adjustments with 'ADMIN'. A negative adjustment is supported for
 * admin corrections (ledger row only, never below-cycle accounting).
 */
export async function awardRealmPoints(input: AwardRealmPointsInput): Promise<AwardRealmPointsResult> {
  const points = Math.trunc(input.points)
  if (points === 0) {
    const ur = await db.userRealm.findUnique({ where: { userId: input.userId }, select: { cyclePoints: true } }).catch(() => null)
    return { awarded: false, points: 0, cyclePoints: ur?.cyclePoints ?? 0, realmLevel: null }
  }

  const participants = await ensureRealmParticipation([input.userId])
  const me = participants.get(input.userId)
  if (!me) {
    // No active realm (level inactive / realm system absent) → no award.
    return { awarded: false, points: 0, cyclePoints: 0, realmLevel: null }
  }

  const seasonRow = await getOrCreateActiveSeason().catch(() => null)
  const seasonBoost = seasonRow ? await seasonEventBoost(seasonRow.id).catch(() => 1) : 1

  const meta = JSON.stringify({ ...(input.metadata ?? {}), source: input.source }).slice(0, 2000)

  const result = await db
    .$transaction(async (tx: Prisma.TransactionClient) => {
      // Idempotency: the unique [sourceId, sourceType, userId] index +
      // skipDuplicates make a retried crate-open a no-op.
      const created = await tx.realmPointLedger.createMany({
        data: [
          {
            userId: input.userId,
            cycleId: me.cycleId,
            realmLevel: me.realmLevel,
            sourceType: input.source,
            sourceId: input.sourceId,
            basePoints: Math.abs(points),
            multiplier: 1,
            awardedPoints: points,
            metadata: meta,
          },
        ],
        skipDuplicates: true,
      })
      if (created.count === 0) return { awarded: false, cyclePoints: -1 as number }

      await tx.userRealm.updateMany({
        where: { userId: input.userId, currentCycleId: me.cycleId },
        data: {
          cyclePoints: { increment: points },
          lifetimeRealmPoints: { increment: points },
        },
      })
      await tx.realmCohortMember.updateMany({
        where: { cohortId: me.cohortId, userId: input.userId },
        data: { cyclePoints: { increment: points } },
      })
      // Tie-breaker: first time this member crosses the threshold (§92).
      if (me.threshold > 0 && points > 0) {
        await tx.realmCohortMember.updateMany({
          where: {
            cohortId: me.cohortId,
            userId: input.userId,
            thresholdReachedAt: null,
            cyclePoints: { gte: me.threshold },
          },
          data: { thresholdReachedAt: new Date() },
        })
      }
      // Season points ride along (crate grants count for the ❤ chip too).
      if (points > 0) {
        await awardSeasonPoints(tx, seasonRow, seasonBoost, [{ userId: input.userId, points }])
      }
      const fresh = await tx.userRealm.findUnique({
        where: { userId: input.userId },
        select: { cyclePoints: true },
      })
      return { awarded: true, cyclePoints: fresh?.cyclePoints ?? 0 }
    })
    .catch(() => null)

  const awarded = result?.awarded ?? false
  const cyclePoints = result && result.cyclePoints >= 0 ? result.cyclePoints : (await currentCyclePoints(input.userId))

  // §45-style live push: the realm HUD + threshold bar move instantly.
  if (awarded && points > 0) {
    const supabase = getClient()
    void supabase
      ?.channel(`realm:${input.userId}`)
      .send({
        type: 'broadcast',
        event: 'realm_points_updated',
        payload: { userId: input.userId, awardedPoints: points, newCyclePoints: cyclePoints, source: input.source.toLowerCase() },
      })
      .catch?.(() => {})
  }

  return { awarded, points: awarded ? points : 0, cyclePoints, realmLevel: me.realmLevel }
}

async function currentCyclePoints(userId: string): Promise<number> {
  const ur = await db.userRealm.findUnique({ where: { userId }, select: { cyclePoints: true } }).catch(() => null)
  return ur?.cyclePoints ?? 0
}
