// Quicky — premium subscription (mock paywall) per PRD §6, §10.2
// GET   /api/quicky/premium  -> current premium status + plans
// POST  /api/quicky/premium  { plan } -> subscribe (instant flip)
// POST  /api/quicky/premium  { action: 'cancel' } -> cancel
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { QUICKY } from '@/lib/quicky/constants'

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sub = await db.subscription.findFirst({
    where: { userId: me.id, status: 'active' },
    orderBy: { startedAt: 'desc' },
  })

  return NextResponse.json({
    isPremium: me.isPremium,
    subscription: sub
      ? {
          id: sub.id,
          plan: sub.plan,
          status: sub.status,
          startedAt: sub.startedAt,
          expiresAt: sub.expiresAt,
        }
      : null,
    plans: QUICKY.subscriptionPlans,
    consumables: QUICKY.consumables,
  })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const action = String(body.action ?? 'subscribe')

  if (action === 'cancel') {
    if (!me.isPremium) return NextResponse.json({ error: 'No active subscription' }, { status: 400 })
    await db.subscription.updateMany({
      where: { userId: me.id, status: 'active' },
      data: { status: 'cancelled' },
    })
    await db.user.update({
      where: { id: me.id },
      data: { isPremium: false, premiumTier: null, premiumUntil: null },
    })
    return NextResponse.json({ ok: true, isPremium: false })
  }

  // subscribe
  const plan = String(body.plan ?? '')
  const planDef = QUICKY.subscriptionPlans.find((p) => p.id === plan)
  if (!planDef) return NextResponse.json({ error: 'Unknown plan' }, { status: 400 })

  // Compute expiry
  const now = new Date()
  const expiresAt = new Date(now)
  if (plan === 'weekly') expiresAt.setDate(expiresAt.getDate() + 7)
  else if (plan === 'monthly') expiresAt.setMonth(expiresAt.getMonth() + 1)
  else if (plan === 'quarterly') expiresAt.setMonth(expiresAt.getMonth() + 3)
  else if (plan === 'annual') expiresAt.setFullYear(expiresAt.getFullYear() + 1)

  // Cancel any existing active sub
  await db.subscription.updateMany({
    where: { userId: me.id, status: 'active' },
    data: { status: 'cancelled' },
  })

  await db.subscription.create({
    data: {
      userId: me.id,
      plan,
      status: 'active',
      startedAt: now,
      expiresAt,
    },
  })
  const updated = await db.user.update({
    where: { id: me.id },
    data: { isPremium: true, premiumTier: 'premium', premiumUntil: expiresAt },
  })

  return NextResponse.json({
    ok: true,
    isPremium: updated.isPremium,
    expiresAt,
  })
}
