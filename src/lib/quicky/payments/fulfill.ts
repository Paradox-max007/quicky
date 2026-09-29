// Quicky — CATALOG + PURCHASE FULFILLMENT (Monetization PRD §5 / §6 / §8)
//
// The store catalog (GameCoinPackage extended with kind/realmPoints/plan/
// provider ids) is the AUTHORITATIVE product list. Prices live in the
// provider dashboards (Stripe / Play Console); this table maps internal
// products to provider ids and defines WHAT a purchase grants.
//
// fulfillGamePurchase() is the single fulfillment path shared by the Stripe
// webhook and the Google Play verify route:
//   · COIN_PACK          → coins credited through the wallet ledger
//   · REALM_POINTS_PACK  → realm points through awardRealmPoints
//   · SUBSCRIPTION       → existing Subscription model + premiumUntil grant
//                          (PRD §8: integrate, don't duplicate)
// Idempotent: a COMPLETED purchase is a no-op that returns the stored
// outcome; credits carry purchase-scoped wallet idempotency keys.

import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import { creditCoins, creditRealmPoints } from '@/lib/quicky/wallet'

export type StoreProduct = {
  id: string
  name: string
  kind: 'COIN_PACK' | 'REALM_POINTS_PACK' | 'SUBSCRIPTION'
  coins: number
  bonusCoins: number
  realmPoints: number | null
  plan: string | null
  price: number
  currency: string
  badge: string | null
  featured: boolean
  premiumOnly: boolean
  stripePriceId: string | null
  googlePlayProductId: string | null
}

type CatalogRow = {
  id: string
  name: string
  kind: string
  coins: number
  bonusCoins: number
  realmPoints: number | null
  plan: string | null
  price: number
  currency: string
  badge: string | null
  featured: boolean
  premiumOnly: boolean
  stripePriceId: string | null
  googlePlayProductId: string | null
  isActive: boolean
}

function toProduct(row: CatalogRow): StoreProduct {
  return {
    id: row.id,
    name: row.name,
    kind: (row.kind as StoreProduct['kind']) ?? 'COIN_PACK',
    coins: row.coins,
    bonusCoins: row.bonusCoins,
    realmPoints: row.realmPoints,
    plan: row.plan,
    price: row.price,
    currency: row.currency,
    badge: row.badge,
    featured: row.featured,
    premiumOnly: row.premiumOnly,
    stripePriceId: row.stripePriceId,
    googlePlayProductId: row.googlePlayProductId,
  }
}

/** Active catalog (admin-managed; inactive products never sell). */
export async function listActiveProducts(): Promise<StoreProduct[]> {
  const rows = await db.gameCoinPackage.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { price: 'asc' }],
  })
  return rows.map(toProduct)
}

export async function findProduct(productId: string): Promise<StoreProduct | null> {
  const row = await db.gameCoinPackage.findUnique({ where: { id: productId } }).catch(() => null)
  if (!row || !row.isActive) return null
  return toProduct(row)
}

// ─── Subscription grant (PRD §8 — existing entitlement system) ───────────────

function planPeriodEnd(plan: string, from = new Date()): Date {
  const d = new Date(from)
  if (plan === 'weekly') d.setDate(d.getDate() + 7)
  else if (plan === 'monthly') d.setMonth(d.getMonth() + 1)
  else if (plan === 'quarterly') d.setMonth(d.getMonth() + 3)
  else d.setFullYear(d.getFullYear() + 1)
  return d
}

/**
 * Grant/extend premium for a verified subscription purchase. Writes the
 * Subscription row and flips the User premium fields — the SAME model the
 * existing paywall/middleware reads, so entitlement checks are
 * provider-agnostic (PRD §8). Provider provenance + purchase link are kept
 * on the GamePurchase metadata for reconciliation.
 */
async function grantSubscription(
  tx: Prisma.TransactionClient,
  userId: string,
  product: StoreProduct,
  provider: 'stripe' | 'google_play',
  purchaseId: string
): Promise<void> {
  const plan = product.plan ?? 'monthly'
  const now = new Date()
  const expiresAt = planPeriodEnd(plan, now)

  // Supersede any previous active sub (one entitlement per user).
  await tx.subscription.updateMany({
    where: { userId, status: 'active' },
    data: { status: 'cancelled' },
  })
  await tx.subscription.create({
    data: { userId, plan, status: 'active', startedAt: now, expiresAt },
  })
  await tx.user.update({
    where: { id: userId },
    data: { isPremium: true, premiumTier: plan, premiumUntil: expiresAt },
  })
  // Provider reference for audit + RTDN/webhook reconciliation.
  await tx.gamePurchase.update({
    where: { id: purchaseId },
    data: { metadata: JSON.stringify({ plan, provider, linkedSubscription: true }) },
  })
}

// ─── Fulfillment ─────────────────────────────────────────────────────────────

export type FulfillResult =
  | { ok: true; alreadyCompleted: boolean; kind: StoreProduct['kind']; coinBalance: number | null; cyclePoints: number | null }
  | { ok: false; error: string }

/**
 * Credit a catalog product for a purchase and flip it to COMPLETED —
 * atomically for coins/subscriptions (one Prisma transaction), through the
 * canonical realm path for points. Safe to call from webhook retries:
 * a COMPLETED purchase returns its stored outcome without re-crediting
 * (status guard + wallet idempotency keys `purchase:<id>`).
 */
export async function fulfillGamePurchase(
  purchaseId: string,
  provider: 'stripe' | 'google_play',
  providerTransactionId: string
): Promise<FulfillResult> {
  const purchase = await db.gamePurchase.findUnique({ where: { id: purchaseId } })
  if (!purchase) return { ok: false, error: 'purchase_not_found' }

  const product = await findProduct(purchase.productId)
  if (!product) return { ok: false, error: 'product_not_found' }

  if (purchase.status === 'COMPLETED') {
    return { ok: true, alreadyCompleted: true, kind: product.kind, coinBalance: null, cyclePoints: null }
  }
  if (purchase.status === 'REFUNDED' || purchase.status === 'CANCELLED') {
    return { ok: false, error: `purchase_${purchase.status.toLowerCase()}` }
  }

  try {
    if (product.kind === 'REALM_POINTS_PACK' && product.realmPoints) {
      // Realm points: canonical idempotent award, then purchase flip.
      const res = await creditRealmPoints(purchase.userId, product.realmPoints, `purchase:${purchase.id}`, {
        transactionType: 'PURCHASE',
        source: provider,
        sourceId: purchase.id,
        metadata: { productId: product.id, providerTransactionId },
      })
      await db.gamePurchase.update({
        where: { id: purchase.id },
        data: { status: 'COMPLETED', providerTransactionId, completedAt: new Date() },
      })
      return { ok: true, alreadyCompleted: false, kind: 'REALM_POINTS_PACK', coinBalance: null, cyclePoints: res.cyclePoints }
    }

    const result = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      if (product.kind === 'SUBSCRIPTION') {
        await grantSubscription(tx, purchase.userId, product, provider, purchase.id)
        await tx.gamePurchase.update({
          where: { id: purchase.id },
          data: { status: 'COMPLETED', providerTransactionId, completedAt: new Date() },
        })
        return { coinBalance: null as number | null, cyclePoints: null as number | null }
      }

      // COIN_PACK — premium legacy bonus parity with the mock store flow.
      const buyer = await tx.user.findUnique({ where: { id: purchase.userId }, select: { isPremium: true } })
      const premiumBonus = buyer?.isPremium && !product.premiumOnly ? Math.round(product.coins * 0.2) : 0
      const totalCoins = product.coins + product.bonusCoins + premiumBonus
      const credit = await creditCoins(tx, purchase.userId, totalCoins, `purchase:${purchase.id}`, {
        transactionType: 'PURCHASE',
        source: provider,
        sourceId: purchase.id,
        metadata: { productId: product.id, base: product.coins, bonus: product.bonusCoins, premiumBonus, providerTransactionId },
      })
      await tx.gamePurchase.update({
        where: { id: purchase.id },
        data: {
          status: 'COMPLETED',
          providerTransactionId,
          completedAt: new Date(),
          coins: product.coins,
          bonusCoins: product.bonusCoins + premiumBonus,
          metadata: JSON.stringify({ productId: product.id, premiumBonus, providerTransactionId }),
        },
      })
      return { coinBalance: credit.coinBalance, cyclePoints: null as number | null }
    })
    return { ok: true, alreadyCompleted: false, kind: product.kind, ...result }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'fulfill_failed' }
  }
}

/**
 * Reverse a purchase (admin refund / provider charge.refunded): status flip
 * + compensating wallet debit. Never deletes history (PRD §6.1).
 */
export async function refundGamePurchase(
  purchaseId: string,
  refundedBy: 'admin' | 'stripe'
): Promise<FulfillResult> {
  const purchase = await db.gamePurchase.findUnique({ where: { id: purchaseId } })
  if (!purchase) return { ok: false, error: 'purchase_not_found' }
  if (purchase.status !== 'COMPLETED') return { ok: false, error: 'purchase_not_refundable' }

  const product = await findProduct(purchase.productId)
  if (!product) return { ok: false, error: 'product_not_found' }

  if (product.kind === 'REALM_POINTS_PACK' && product.realmPoints) {
    const res = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.walletTransaction.create({
        data: {
          userId: purchase.userId,
          currencyType: 'REALM_POINTS',
          amount: -product.realmPoints!,
          transactionType: 'REFUND',
          source: refundedBy === 'admin' ? 'admin' : 'stripe',
          sourceId: purchase.id,
          idempotencyKey: `refund:${purchase.id}`,
          metadata: JSON.stringify({ refundedBy }),
        },
      })
      await tx.userRealm.updateMany({
        where: { userId: purchase.userId },
        data: { cyclePoints: { decrement: product.realmPoints! }, lifetimeRealmPoints: { decrement: product.realmPoints! } },
      }).catch(() => {})
      await tx.gamePurchase.update({ where: { id: purchase.id }, data: { status: 'REFUNDED' } })
      return true
    }).catch(() => false)
    if (!res) return { ok: false, error: 'refund_failed' }
    return { ok: true, alreadyCompleted: false, kind: product.kind, coinBalance: null, cyclePoints: null }
  }

  if (product.kind === 'SUBSCRIPTION') {
    // Subscription refund: end the entitlement at period logic level.
    await db.subscription.updateMany({
      where: { userId: purchase.userId, status: 'active' },
      data: { status: 'cancelled' },
    })
    await db.user.update({
      where: { id: purchase.userId },
      data: { isPremium: false, premiumTier: null, premiumUntil: null },
    })
    await db.gamePurchase.update({ where: { id: purchase.id }, data: { status: 'REFUNDED' } })
    return { ok: true, alreadyCompleted: false, kind: product.kind, coinBalance: null, cyclePoints: null }
  }

  try {
    const totalCoins = purchase.coins ?? product.coins
    const bonus = purchase.bonusCoins ?? 0
    await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const u = await tx.user.findUnique({ where: { id: purchase.userId }, select: { coinBalance: true } })
      const amount = Math.min(totalCoins + bonus, u?.coinBalance ?? 0)
      if (amount > 0) {
        await tx.user.update({ where: { id: purchase.userId }, data: { coinBalance: { decrement: amount } } })
      }
      await tx.walletTransaction.create({
        data: {
          userId: purchase.userId,
          currencyType: 'COINS',
          amount: -amount,
          transactionType: 'REFUND',
          source: refundedBy === 'admin' ? 'admin' : 'stripe',
          sourceId: purchase.id,
          idempotencyKey: `refund:${purchase.id}`,
          metadata: JSON.stringify({ refundedBy, fullValue: totalCoins + bonus, debited: amount }),
        },
      })
      await tx.gamePurchase.update({ where: { id: purchase.id }, data: { status: 'REFUNDED' } })
    })
    return { ok: true, alreadyCompleted: false, kind: product.kind, coinBalance: null, cyclePoints: null }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'refund_failed' }
  }
}
