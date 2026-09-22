// Quicky — ACTIVE EVENTS (realm PRD §61)
// GET /api/quicky/events/active
// The config-driven event feed the room event banner consumes: the active
// gift multiplier (high priority, PRD §17) + the viewer's realm cycle
// countdown. Lazily settles due cycles so nothing stale is ever shown (§80).
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { getActiveGiftMultiplier } from '@/lib/quicky/realm/gift-multiplier'
import { settleDueCycles } from '@/lib/quicky/realm/realm-cycle'

export async function GET(_req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  await settleDueCycles().catch(() => {})
  const active = await getActiveGiftMultiplier()

  // The viewer's realm cycle end (banner rotation entry, PRD §17).
  let realmCycleEndsAt: string | null = null
  let realmLevel: number | null = null
  const { db } = await import('@/lib/db')
  const ur = await db.userRealm.findUnique({ where: { userId: me.id } }).catch(() => null)
  if (ur?.currentCycleId) {
    const cycle = await db.realmCycle.findUnique({ where: { id: ur.currentCycleId }, select: { endAt: true } }).catch(() => null)
    if (cycle && cycle.endAt.getTime() > Date.now()) {
      realmCycleEndsAt = cycle.endAt.toISOString()
      realmLevel = ur.realmLevel
    }
  }

  return NextResponse.json({
    multiplier: active.multiplier,
    multiplierEvent: active.eventId
      ? {
          id: active.eventId,
          name: active.eventName,
          multiplier: active.multiplier,
          startsAt: (active.startsAt as Date).toISOString(),
          expiresAt: (active.expiresAt as Date).toISOString(),
        }
      : null,
    realmCycle: realmCycleEndsAt ? { endsAt: realmCycleEndsAt, realmLevel } : null,
  })
}
