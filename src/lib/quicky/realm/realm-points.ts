// Quicky — REALM POINTS SERVICE (realm PRD §6-§8, §19-§21, §47-§48, §63-§64, §74)
//
// ONE canonical award path used by the gift transaction:
//   senderPoints     = quantity × recipientCount × multiplier   (§7/§8)
//   receiverPoints   = quantity × multiplier                    (per recipient)
//   self-gift        = sender + receiver allocations BOTH to the same user
//                      (10 × 2 × 2 = 40, §7/§48 — never reduced to +20)
// Coins are NEVER multiplied (§74) — only Realm Points.
//
// Concurrency (§63/§64): all counters move via atomic `increment` SQL
// inside the SAME short gift transaction — concurrent gifts can only ever
// sum correctly (100 + 10 + 20 = 130, never a lost update).
//
// Idempotency (§20): the gift event id keys the ledger (unique
// [sourceId, sourceType, userId]); `skipDuplicates` + count-guarded
// increments mean a retried request (Capacitor reconnect, double tap,
// mobile network retry) can never double-award.

import type { Prisma } from '@prisma/client'
import { getActiveGiftMultiplier } from './gift-multiplier'
import { ensureRealmParticipation, type RealmParticipation } from './realm-cycle'
import { getOrCreateActiveSeason, seasonEventBoost, awardSeasonPoints } from '@/lib/quicky/season'

export type RealmAwardPlan = {
  giftEventId: string
  multiplier: number
  eventId: string | null
  eventName: string | null
  expiresAt: Date | null
  senderId: string
  /** Recipients that actually have realm participation (active realm). */
  recipientIds: string[]
  quantity: number
  senderPoints: number
  receiverPointsEach: number
  participants: Map<string, RealmParticipation>
  /** Monthly-season award context (crate-pass PRD): the active season + the
   *  running season-event boost — resolved BEFORE the transaction. */
  season: { id: string; name: string } | null
  seasonBoost: number
}

export type RealmAwardResult = {
  senderPoints: number
  receiverPointsEach: number
  multiplier: number
  /** false when the ledger already had this gift event (idempotent retry). */
  awarded: boolean
}

/**
 * Resolve everything the award needs BEFORE the financial transaction:
 * the multiplier (server time + active event, §18/§49) and the
 * participation (cycle + cohort) of sender + recipients. Pure DB reads /
 * non-financial writes — nothing here touches coins.
 */
export async function planRealmAward(
  senderId: string,
  recipientIds: string[],
  quantity: number,
  giftEventId?: string | null
): Promise<RealmAwardPlan> {
  const active = await getActiveGiftMultiplier()
  const participants = await ensureRealmParticipation([senderId, ...recipientIds])
  // Monthly season (crate-pass PRD) — resolve once, pre-transaction; the
  // season points themselves are awarded INSIDE the gift transaction.
  const seasonRow = await getOrCreateActiveSeason().catch(() => null)
  const seasonBoost = seasonRow ? await seasonEventBoost(seasonRow.id).catch(() => 1) : 1

  // Only users with an active realm participate in point earning.
  const activeRecipients = recipientIds.filter((id) => participants.has(id))
  const multiplier = active.multiplier

  // §8 — the canonical formula (per gift unit; coins untouched §74).
  const senderPoints = quantity * activeRecipients.length * multiplier
  const receiverPointsEach = quantity * multiplier

  return {
    giftEventId: giftEventId || crypto.randomUUID(),
    multiplier,
    eventId: active.eventId,
    eventName: active.eventName,
    expiresAt: active.expiresAt,
    senderId,
    recipientIds: activeRecipients,
    quantity,
    senderPoints,
    receiverPointsEach,
    participants,
    season: seasonRow ? { id: seasonRow.id, name: seasonRow.name } : null,
    seasonBoost,
  }
}

/** Has this gift event already been awarded? (§20 fast idempotency check) */
export async function giftEventAlreadyAwarded(giftEventId: string): Promise<boolean> {
  const { db } = await import('@/lib/db')
  const count = await db.realmPointLedger.count({ where: { sourceId: giftEventId } }).catch(() => 0)
  return count > 0
}

/**
 * Apply the award INSIDE the gift transaction (§19): immutable ledger rows
 * (skipDuplicates) + atomic counter increments, count-guarded so a retry
 * writes nothing. `tx` is the open Prisma transaction client.
 */
export async function applyRealmAward(
  tx: Prisma.TransactionClient,
  plan: RealmAwardPlan,
  metadata: Record<string, unknown>
): Promise<RealmAwardResult> {
  const meta = JSON.stringify(metadata).slice(0, 2000)
  const awarded = plan.multiplier >= 1 && (plan.senderPoints > 0 || plan.receiverPointsEach > 0)

  // ── 1. Ledger rows (immutable audit trail, §21) ─────────────────────────
  let sentCreated = 0
  let receivedCreated = 0
  if (awarded) {
    const senderP = plan.participants.get(plan.senderId)
    if (senderP && plan.senderPoints > 0) {
      const res = await tx.realmPointLedger.createMany({
        data: [
          {
            userId: plan.senderId,
            cycleId: senderP.cycleId,
            realmLevel: senderP.realmLevel,
            sourceType: 'GIFT_SENT',
            sourceId: plan.giftEventId,
            basePoints: plan.quantity * plan.recipientIds.length,
            multiplier: plan.multiplier,
            awardedPoints: plan.senderPoints,
            metadata: meta,
          },
        ],
        skipDuplicates: true,
      })
      sentCreated = res.count
    }

    const recvRows = plan.recipientIds
      .map((userId) => {
        const p = plan.participants.get(userId)!
        return {
          userId,
          cycleId: p.cycleId,
          realmLevel: p.realmLevel,
          sourceType: 'GIFT_RECEIVED',
          sourceId: plan.giftEventId,
          basePoints: plan.quantity,
          multiplier: plan.multiplier,
          awardedPoints: plan.receiverPointsEach,
          metadata: meta,
        }
      })
      .filter((r) => r.awardedPoints > 0)
    if (recvRows.length > 0) {
      const res = await tx.realmPointLedger.createMany({ data: recvRows, skipDuplicates: true })
      receivedCreated = res.count
    }
  }

  const isNew = sentCreated > 0 || receivedCreated > 0

  // ── 2. Atomic counter increments (§63/§64 — sum-only updates) ───────────
  if (isNew) {
    const now = new Date()

    // Sender (GIFT_SENT allocation) — only if the row was newly written.
    if (sentCreated > 0 && plan.senderPoints > 0) {
      const sp = plan.participants.get(plan.senderId)!
      await tx.userRealm.updateMany({
        where: { userId: plan.senderId, currentCycleId: sp.cycleId },
        data: { cyclePoints: { increment: plan.senderPoints }, lifetimeRealmPoints: { increment: plan.senderPoints } },
      })
      await tx.realmCohortMember.updateMany({
        where: { cohortId: sp.cohortId, userId: plan.senderId },
        data: { cyclePoints: { increment: plan.senderPoints } },
      })
    }

    // Recipients (GIFT_RECEIVED allocation) — grouped per cycle + cohort so
    // the common single-cohort case stays O(1) round-trips.
    if (receivedCreated > 0 && plan.receiverPointsEach > 0) {
      const byCycle = new Map<string, string[]>()
      const byCohort = new Map<string, string[]>()
      for (const userId of plan.recipientIds) {
        const p = plan.participants.get(userId)!
        if (userId === plan.senderId && sentCreated > 0) {
          // Self-gift: the sender row was already incremented for the SENT
          // allocation; the RECEIVED allocation is added separately below.
        }
        byCycle.set(p.cycleId, [...(byCycle.get(p.cycleId) ?? []), userId])
        byCohort.set(p.cohortId, [...(byCohort.get(p.cohortId) ?? []), userId])
      }
      for (const [cycleId, userIds] of byCycle) {
        await tx.userRealm.updateMany({
          where: { userId: { in: userIds }, currentCycleId: cycleId },
          data: { cyclePoints: { increment: plan.receiverPointsEach }, lifetimeRealmPoints: { increment: plan.receiverPointsEach } },
        })
      }
      for (const [cohortId, userIds] of byCohort) {
        await tx.realmCohortMember.updateMany({
          where: { cohortId, userId: { in: userIds } },
          data: { cyclePoints: { increment: plan.receiverPointsEach } },
        })
      }
    }

    // ── 3. Tie-breaker bookkeeping (§92) ──────────────────────────────────
    // First time each affected member crosses THIS cycle's threshold.
    const touched = new Map<string, { cohortId: string; threshold: number }>()
    for (const userId of [plan.senderId, ...plan.recipientIds]) {
      const p = plan.participants.get(userId)
      if (!p) continue
      touched.set(p.cohortId, { cohortId: p.cohortId, threshold: p.threshold })
    }
    const affectedIds = [plan.senderId, ...plan.recipientIds]
    for (const { cohortId, threshold } of touched.values()) {
      if (!threshold) continue
      await tx.realmCohortMember.updateMany({
        where: { cohortId, userId: { in: affectedIds }, thresholdReachedAt: null, cyclePoints: { gte: threshold } },
        data: { thresholdReachedAt: now },
      })
    }

    // ── 4. Monthly SEASON points (crate-pass PRD — the ❤ room chip) ──────
    // Same award moment, same transaction: sender + every recipient earn
    // season points equal to their realm allocation, boosted by any RUNNING
    // season event. A retried gift is already guarded by `isNew` above.
    const seasonEntries = [
      ...(plan.senderPoints > 0 ? [{ userId: plan.senderId, points: plan.senderPoints }] : []),
      ...plan.recipientIds
        .filter((id) => plan.receiverPointsEach > 0)
        .map((id) => ({ userId: id, points: plan.receiverPointsEach })),
    ]
    await awardSeasonPoints(tx, plan.season, plan.seasonBoost, seasonEntries)
  }

  return {
    senderPoints: plan.senderPoints,
    receiverPointsEach: plan.receiverPointsEach,
    multiplier: plan.multiplier,
    awarded: isNew,
  }
}
