// Quicky — GOOGLE PLAY PURCHASE VERIFICATION (Monetization PRD §5.3 / §7)
// POST /api/quicky/payments/google-play/verify  { productId, purchaseToken }
//
// The Android client completes the Play billing flow and sends the purchase
// token here. The server independently verifies it with the Google Play
// Developer API (purchase state, product match), then:
//   consumable (COIN_PACK / REALM_POINTS_PACK) → credit + CONSUME (buyable again)
//   SUBSCRIPTION                              → grant + acknowledge
// Replay of the same token never double-credits: the unique
// (provider, providerTransactionId) constraint on GamePurchase + wallet
// idempotency keys make it a no-op.
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { findProduct, fulfillGamePurchase } from '@/lib/quicky/payments/fulfill'
import {
  googlePlayEnabled,
  verifyProductPurchase,
  consumeProductPurchase,
  verifySubscriptionPurchase,
  acknowledgeSubscription,
} from '@/lib/quicky/payments/google-play'
import { rateLimit } from '@/lib/quicky/rate-limit'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!rateLimit('payments:gplay-verify', me.id, 20, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }
  if (!googlePlayEnabled()) {
    return NextResponse.json({ error: 'google_play_not_configured' }, { status: 503 })
  }

  const body = await req.json().catch(() => null)
  const productId = String(body?.productId ?? '')
  const purchaseToken = String(body?.purchaseToken ?? '')
  if (!productId || !purchaseToken) {
    return NextResponse.json({ error: 'invalid_purchase' }, { status: 400 })
  }

  // Map the Play product id back to OUR catalog entry (Play id → internal id).
  const pack = await db.gameCoinPackage.findFirst({
    where: { googlePlayProductId: productId, isActive: true },
  })
  if (!pack) return NextResponse.json({ error: 'invalid_product' }, { status: 400 })
  const product = await findProduct(pack.id)
  if (!product) return NextResponse.json({ error: 'invalid_product' }, { status: 400 })

  // Idempotency: an existing COMPLETED purchase for this token is a no-op.
  const existing = await db.gamePurchase.findUnique({
    where: { provider_providerTransactionId: { provider: 'google_play', providerTransactionId: purchaseToken } },
  })
  if (existing && existing.status === 'COMPLETED') {
    return NextResponse.json({ ok: true, alreadyCompleted: true, kind: product.kind })
  }

  // Create/refresh the order row (PENDING) before verification.
  const purchase =
    existing ??
    (await db.gamePurchase.create({
      data: {
        userId: me.id,
        productId: product.id,
        productType: product.kind,
        provider: 'google_play',
        currency: product.currency,
        amount: product.price,
        status: 'PENDING',
        metadata: JSON.stringify({ platform: 'android', googlePlayProductId: productId }),
      },
      select: { id: true },
    }))

  // ── Verify with Google ──────────────────────────────────────────────────
  if (product.kind === 'SUBSCRIPTION') {
    const sub = await verifySubscriptionPurchase(purchaseToken)
    if ('error' in sub) {
      await db.gamePurchase.update({ where: { id: purchase.id }, data: { status: 'FAILED' } }).catch(() => {})
      return NextResponse.json({ error: `verify_failed: ${sub.error}` }, { status: 402 })
    }
    if (sub.subscriptionState !== 'SUBSCRIPTION_STATE_ACTIVE') {
      // Pending/cancelled/expired at Google → no credit until it is ACTIVE.
      return NextResponse.json({ error: `subscription_${sub.subscriptionState ?? 'unknown'}`, status: 'PENDING' }, { status: 402 })
    }
  } else {
    const verified = await verifyProductPurchase(productId, purchaseToken)
    if ('error' in verified) {
      await db.gamePurchase.update({ where: { id: purchase.id }, data: { status: 'FAILED' } }).catch(() => {})
      return NextResponse.json({ error: `verify_failed: ${verified.error}` }, { status: 402 })
    }
  }

  // ── Fulfill (credit + COMPLETED) ────────────────────────────────────────
  const result = await fulfillGamePurchase(purchase.id, 'google_play', purchaseToken)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 503 })

  // ── Acknowledge / consume so Play does not refund the purchase ──────────
  if (product.kind === 'SUBSCRIPTION') {
    await acknowledgeSubscription(purchaseToken).catch(() => {})
  } else {
    await consumeProductPurchase(productId, purchaseToken).catch(() => {})
  }

  return NextResponse.json({
    ok: true,
    alreadyCompleted: result.alreadyCompleted,
    kind: product.kind,
    coinBalance: result.coinBalance,
    cyclePoints: result.cyclePoints,
  })
}
