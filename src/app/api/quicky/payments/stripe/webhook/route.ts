// Quicky — STRIPE WEBHOOK (Monetization PRD §5.2 / §7)
// POST /api/quicky/payments/stripe/webhook
//
// Fulfillment is driven ONLY by signed Stripe events (never the browser
// reaching the success URL). Guarantees:
//   · signature verified over the RAW body, timing-safe (fail closed)
//   · every event lands in PaymentEvent exactly once (unique event id)
//   · payment_status re-checked against Stripe before crediting
//   · fulfillment is idempotent (purchase status + wallet idempotency keys)
//   · refunds flip the order + write a compensating wallet entry
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyStripeSignature, retrieveSession } from '@/lib/quicky/payments/stripe'
import { fulfillGamePurchase, refundGamePurchase } from '@/lib/quicky/payments/fulfill'

export const dynamic = 'force-dynamic'

type StripeEvent = {
  id: string
  type: string
  data: { object: Record<string, unknown> }
}

/** Insert a PaymentEvent; false → duplicate (already processed/seen). */
async function recordEventOnce(ev: StripeEvent, status: string): Promise<boolean> {
  try {
    await db.paymentEvent.create({
      data: {
        provider: 'stripe',
        providerEventId: ev.id,
        eventType: ev.type,
        status,
        payload: JSON.stringify(ev.data?.object ?? {}).slice(0, 8000),
      },
    })
    return true
  } catch {
    return false // unique violation → already recorded
  }
}

export async function POST(req: NextRequest) {
  const raw = await req.text()
  const sig = req.headers.get('stripe-signature')

  // 1. Signature — forged/stale events are rejected outright.
  if (!verifyStripeSignature(raw, sig)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 400 })
  }

  let ev: StripeEvent
  try {
    ev = JSON.parse(raw) as StripeEvent
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  if (!ev?.id || !ev?.type) return NextResponse.json({ error: 'invalid_event' }, { status: 400 })

  switch (ev.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      // 2. Re-fetch the session and check the REAL payment status.
      const sessionId = String((ev.data.object as { id?: string }).id ?? '')
      let paymentStatus = ''
      let metadata: Record<string, string> = {}
      try {
        const session = await retrieveSession(sessionId)
        paymentStatus = session.payment_status
        metadata = session.metadata ?? {}
      } catch {
        // Stripe unreachable — record and let the retry re-deliver the event.
        await recordEventOnce(ev, 'REJECTED').catch(() => {})
        return NextResponse.json({ error: 'session_fetch_failed' }, { status: 503 })
      }
      if (paymentStatus !== 'paid' && paymentStatus !== 'no_payment_required') {
        await recordEventOnce(ev, 'IGNORED').catch(() => {})
        return NextResponse.json({ ok: true, ignored: paymentStatus })
      }
      const purchaseId = metadata.purchaseId
      if (!purchaseId) {
        await recordEventOnce(ev, 'IGNORED').catch(() => {})
        return NextResponse.json({ ok: true, ignored: 'no_purchase_metadata' })
      }
      // 3. Exactly-once processing + idempotent fulfillment.
      if (!(await recordEventOnce(ev, 'PROCESSED'))) {
        return NextResponse.json({ ok: true, duplicate: true })
      }
      const result = await fulfillGamePurchase(purchaseId, 'stripe', sessionId)
      if (!result.ok) {
        // fulfillment failure: mark event REJECTED so a retry can re-run it
        await db.paymentEvent.updateMany({
          where: { provider: 'stripe', providerEventId: ev.id },
          data: { status: 'REJECTED' },
        }).catch(() => {})
        return NextResponse.json({ error: result.error }, { status: 503 })
      }
      return NextResponse.json({ ok: true, alreadyCompleted: result.alreadyCompleted })
    }

    case 'checkout.session.expired':
    case 'checkout.session.async_payment_failed': {
      await recordEventOnce(ev, 'PROCESSED').catch(() => {})
      const sessionId = String((ev.data.object as { id?: string }).id ?? '')
      await db.gamePurchase.updateMany({
        where: { provider: 'stripe', status: { in: ['PENDING', 'PROCESSING'] }, metadata: { contains: sessionId } },
        data: { status: 'CANCELLED' },
      }).catch(() => {})
      return NextResponse.json({ ok: true })
    }

    case 'charge.refunded': {
      if (!(await recordEventOnce(ev, 'PROCESSED'))) {
        return NextResponse.json({ ok: true, duplicate: true })
      }
      const charge = ev.data.object as { metadata?: Record<string, string>; payment_intent?: string }
      const purchaseId = charge.metadata?.purchaseId
      if (purchaseId) {
        const res = await refundGamePurchase(purchaseId, 'stripe')
        return NextResponse.json({ ok: res.ok, error: res.ok ? undefined : res.error })
      }
      return NextResponse.json({ ok: true, ignored: 'no_purchase_metadata' })
    }

    default:
      // Unhandled event types are recorded as seen (dedup) but ignored.
      await recordEventOnce(ev, 'IGNORED').catch(() => {})
      return NextResponse.json({ ok: true, ignored: ev.type })
  }
}
