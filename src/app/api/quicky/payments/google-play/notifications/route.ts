// Quicky — GOOGLE PLAY REAL-TIME DEVELOPER NOTIFICATIONS (Monetization PRD §5.3 / §7)
// POST /api/quicky/payments/google-play/notifications
//
// Play (via Pub/Sub push) delivers subscription lifecycle events here:
// renewals, cancellations, expirations and revocations. Entitlement state
// must reflect the VERIFIED subscription status (PRD §8) — a one-time
// purchase never grants permanent premium.
//
// Auth: Pub/Sub push carries `Authorization: Bearer <token>`; we compare
// against GOOGLE_PLAY_NOTIFICATIONS_TOKEN (rotate it with the Pub/Sub push
// config). Events are deduped through PaymentEvent by message id.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

type RtdnEnvelope = {
  message?: { data?: string; messageId?: string; publishTime?: string }
  subscription?: string
}

type RtdnPayload = {
  version?: string
  packageName?: string
  eventTimeMillis?: string
  subscriptionNotification?: {
    notificationType?: number // 1 RECOVERED, 2 RENEWED, 3 CANCELED, 4 PURCHASED, 5 ON_HOLD, 6 IN_GRACE_PERIOD, 7 RESTARTED, 12 REVOKED, 13 EXPIRED
    purchaseToken?: string
    subscriptionId?: string
  }
  voidedPurchaseNotification?: {
    purchaseToken?: string
    orderId?: string
  }
}

// notificationType enum (Google Play RTDN)
const SUB = {
  RECOVERED: 1,
  RENEWED: 2,
  CANCELED: 3,
  PURCHASED: 4,
  ON_HOLD: 5,
  IN_GRACE_PERIOD: 6,
  RESTARTED: 7,
  REVOKED: 12,
  EXPIRED: 13,
} as const

async function recordNotificationOnce(providerEventId: string, eventType: string): Promise<boolean> {
  try {
    await db.paymentEvent.create({
      data: { provider: 'google_play', providerEventId, eventType, status: 'PROCESSED' },
    })
    return true
  } catch {
    return false // duplicate delivery
  }
}

export async function POST(req: NextRequest) {
  const expected = process.env.GOOGLE_PLAY_NOTIFICATIONS_TOKEN
  const auth = req.headers.get('authorization') ?? ''
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let envelope: RtdnEnvelope
  try {
    envelope = (await req.json()) as RtdnEnvelope
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  let payload: RtdnPayload = {}
  try {
    payload = envelope.message?.data ? JSON.parse(Buffer.from(envelope.message.data, 'base64').toString('utf8')) : {}
  } catch {
    return NextResponse.json({ error: 'invalid_data' }, { status: 400 })
  }

  const messageId = envelope.message?.messageId ?? `${envelope.message?.publishTime ?? ''}:${payload.subscriptionNotification?.purchaseToken ?? ''}:${payload.eventTimeMillis ?? ''}`
  const eventType = payload.subscriptionNotification
    ? `subscription_${payload.subscriptionNotification.notificationType}`
    : payload.voidedPurchaseNotification
      ? 'voided_purchase'
      : 'unknown'

  if (!(await recordNotificationOnce(messageId, eventType))) {
    return NextResponse.json({ ok: true, duplicate: true })
  }

  const token = payload.subscriptionNotification?.purchaseToken ?? payload.voidedPurchaseNotification?.purchaseToken
  if (!token) return NextResponse.json({ ok: true, ignored: 'no_token' })

  // The purchase row for this token is our entitlement anchor.
  const purchase = await db.gamePurchase.findUnique({
    where: { provider_providerTransactionId: { provider: 'google_play', providerTransactionId: token } },
  })
  if (!purchase) return NextResponse.json({ ok: true, ignored: 'purchase_not_found' })

  if (payload.voidedPurchaseNotification) {
    await db.gamePurchase.update({ where: { id: purchase.id }, data: { status: 'REFUNDED' } }).catch(() => {})
    await endEntitlement(purchase.userId)
    return NextResponse.json({ ok: true })
  }

  const type = payload.subscriptionNotification?.notificationType
  switch (type) {
    case SUB.RENEWED:
    case SUB.RECOVERED:
    case SUB.RESTARTED:
    case SUB.PURCHASED: {
      // (Re)grant per the product's plan period — RTDN confirms Google's view.
      const pack = await db.gameCoinPackage.findUnique({ where: { id: purchase.productId } }).catch(() => null)
      const plan = pack?.plan ?? 'monthly'
      const d = new Date()
      if (plan === 'weekly') d.setDate(d.getDate() + 7)
      else if (plan === 'monthly') d.setMonth(d.getMonth() + 1)
      else if (plan === 'quarterly') d.setMonth(d.getMonth() + 3)
      else d.setFullYear(d.getFullYear() + 1)
      await db.subscription.updateMany({
        where: { userId: purchase.userId, status: 'active' },
        data: { expiresAt: d },
      }).catch(() => {})
      await db.user.update({
        where: { id: purchase.userId },
        data: { isPremium: true, premiumTier: plan, premiumUntil: d },
      }).catch(() => {})
      return NextResponse.json({ ok: true })
    }
    case SUB.CANCELED:
      // Access continues until expiry — flag only.
      return NextResponse.json({ ok: true, ignored: 'cancel_at_period_end' })
    case SUB.EXPIRED:
    case SUB.REVOKED:
    case SUB.ON_HOLD:
      await endEntitlement(purchase.userId)
      return NextResponse.json({ ok: true })
    default:
      return NextResponse.json({ ok: true, ignored: `type_${type}` })
  }
}

async function endEntitlement(userId: string): Promise<void> {
  await db.subscription.updateMany({
    where: { userId, status: 'active' },
    data: { status: 'expired' },
  }).catch(() => {})
  await db.user.update({
    where: { id: userId },
    data: { isPremium: false, premiumTier: null, premiumUntil: null },
  }).catch(() => {})
}
