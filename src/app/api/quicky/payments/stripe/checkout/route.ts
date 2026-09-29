// Quicky — STRIPE CHECKOUT SESSION CREATION (Monetization PRD §5.2 / §7)
// POST /api/quicky/payments/stripe/checkout  { productId }
//
// Server-only flow: validate the product against the catalog, create a
// PENDING GamePurchase (our order record), then a Stripe Checkout Session
// whose metadata carries the purchase + user id. Fulfillment happens ONLY in
// the signed webhook — reaching the success URL grants nothing (PRD §5.2).
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { findProduct } from '@/lib/quicky/payments/fulfill'
import { createCheckoutSession, stripeEnabled } from '@/lib/quicky/payments/stripe'
import { rateLimit } from '@/lib/quicky/rate-limit'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!rateLimit('payments:checkout', me.id, 10, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }
  if (!stripeEnabled()) {
    return NextResponse.json({ error: 'stripe_not_configured' }, { status: 503 })
  }

  const body = await req.json().catch(() => null)
  const productId = String(body?.productId ?? '')
  const product = await findProduct(productId)
  if (!product) return NextResponse.json({ error: 'invalid_product' }, { status: 400 })
  if (!product.stripePriceId) {
    return NextResponse.json({ error: 'product_missing_stripe_price' }, { status: 400 })
  }

  // Order record first — traceable from the moment checkout starts.
  const purchase = await db.gamePurchase.create({
    data: {
      userId: me.id,
      productId: product.id,
      productType: product.kind,
      provider: 'stripe',
      currency: product.currency,
      amount: product.price,
      status: 'PENDING',
      metadata: JSON.stringify({ platform: 'web', productName: product.name }),
    },
    select: { id: true },
  })

  const origin = req.nextUrl.origin
  try {
    const session = await createCheckoutSession({
      priceId: product.stripePriceId,
      mode: product.kind === 'SUBSCRIPTION' ? 'subscription' : 'payment',
      successUrl: `${origin}/?purchase=${purchase.id}&status=success`,
      cancelUrl: `${origin}/?purchase=${purchase.id}&status=cancelled`,
      clientReferenceId: me.id,
      metadata: { purchaseId: purchase.id, userId: me.id, productId: product.id },
    })
    await db.gamePurchase.update({
      where: { id: purchase.id },
      data: { status: 'PROCESSING', metadata: JSON.stringify({ platform: 'web', stripeSessionId: session.id }) },
    })
    return NextResponse.json({ url: session.url, purchaseId: purchase.id })
  } catch (e) {
    await db.gamePurchase
      .update({ where: { id: purchase.id }, data: { status: 'FAILED' } })
      .catch(() => {})
    return NextResponse.json(
      { error: 'checkout_failed', message: e instanceof Error ? e.message : undefined },
      { status: 502 }
    )
  }
}
