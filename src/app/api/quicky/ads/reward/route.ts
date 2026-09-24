// Quicky — REWARDED AD GRANT
// POST /api/quicky/ads/reward
//
// Called by the client the moment a rewarded ad FINISHES playing (the modal
// plays the ad first, then collects). The SERVER decides the reward so the
// client can never forge amounts:
//   · kind   — COINS or POINTS, random order (50/50)
//   · amount — random 1-1000
// COINS land on User.coinBalance; POINTS go through the canonical realm-point
// path (ledger row + cycle/cohort/lifetime increments, same as gift points).
//
// Anti-farm cooldown: one rewarded-ad grant per 60s per user (checked against
// the newest AdRewardEvent row).
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { ensureRealmParticipation } from '@/lib/quicky/realm/realm-cycle'

const COOLDOWN_MS = 60_000
const MIN_AMOUNT = 1
const MAX_AMOUNT = 1000

export async function POST(_req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Cooldown — the newest granted reward gates the next one.
  const last = await db.adRewardEvent.findFirst({
    where: { userId: me.id },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  if (last && Date.now() - last.createdAt.getTime() < COOLDOWN_MS) {
    return NextResponse.json(
      { error: 'cooldown', retryAfterMs: COOLDOWN_MS - (Date.now() - last.createdAt.getTime()) },
      { status: 429 }
    )
  }

  // Server-generated reward: random kind, random 1-1000 amount.
  const kind: 'COINS' | 'POINTS' = Math.random() < 0.5 ? 'COINS' : 'POINTS'
  const amount = MIN_AMOUNT + Math.floor(Math.random() * MAX_AMOUNT)

  let coinBalance: number | null = null
  let cyclePoints: number | null = null

  if (kind === 'POINTS') {
    // Realm points — only when the user has an ACTIVE realm/cycle seat;
    // otherwise the ad degrades to coins (the reward is never lost).
    const participation = await ensureRealmParticipation([me.id]).catch(() => new Map())
    const p = participation.get(me.id)
    if (!p) {
      // fall through to coins below
    } else {
      await db.realmPointLedger.create({
        data: {
          userId: me.id,
          cycleId: p.cycleId,
          realmLevel: p.realmLevel,
          sourceType: 'AD_REWARD',
          sourceId: `ad_${crypto.randomUUID()}`,
          basePoints: amount,
          multiplier: 1,
          awardedPoints: amount,
          metadata: JSON.stringify({ source: 'rewarded_ad' }),
        },
      })
      await db.userRealm.updateMany({
        where: { userId: me.id, currentCycleId: p.cycleId },
        data: { cyclePoints: { increment: amount }, lifetimeRealmPoints: { increment: amount } },
      })
      await db.realmCohortMember.updateMany({
        where: { cohortId: p.cohortId, userId: me.id },
        data: { cyclePoints: { increment: amount } },
      })
      if (p.threshold > 0) {
        await db.realmCohortMember.updateMany({
          where: { cohortId: p.cohortId, userId: me.id, thresholdReachedAt: null, cyclePoints: { gte: p.threshold } },
          data: { thresholdReachedAt: new Date() },
        })
      }
      const ur = await db.userRealm.findUnique({ where: { userId: me.id }, select: { cyclePoints: true } })
      cyclePoints = ur?.cyclePoints ?? null
    }
  }

  const creditedAsCoins = kind === 'COINS' || cyclePoints === null
  if (creditedAsCoins) {
    const updated = await db.user.update({
      where: { id: me.id },
      data: { coinBalance: { increment: amount } },
      select: { coinBalance: true },
    })
    coinBalance = updated.coinBalance
  }

  await db.adRewardEvent.create({
    data: { userId: me.id, kind: creditedAsCoins ? 'COINS' : 'POINTS', amount },
  })

  return NextResponse.json({
    ok: true,
    kind: creditedAsCoins ? 'COINS' : 'POINTS',
    amount,
    coinBalance,
    cyclePoints,
  })
}
