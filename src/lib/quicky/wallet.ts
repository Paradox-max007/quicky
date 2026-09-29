// Quicky — UNIFIED WALLET SERVICE (Monetization PRD §6)
//
// The single authoritative path for every balance change made by the
// monetization systems — rewarded ads, real-money purchases, refunds and
// admin adjustments. Rules (PRD §6.1):
//   · Coins and Realm Points are separate integer balances
//   · EVERY change writes an immutable WalletTransaction ledger row
//   · every operation carries a UNIQUE idempotency key — retries are no-ops
//   · balances move ONLY through this service (server-side, never the client)
//   · refunds/reversals write compensating rows, history is never rewritten
//
// Coin credits are atomic with their ledger row inside the caller's Prisma
// transaction. Realm-point credits delegate to the canonical
// awardRealmPoints() (its own transaction + sourceType/sourceId idempotency),
// then record the unified ledger row — both sides are idempotent, so a
// crash-and-retry can never double-credit.

import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { awardRealmPoints } from '@/lib/quicky/realm/realm-point-service'

export type WalletCurrency = 'COINS' | 'REALM_POINTS'

export type WalletMutationMeta = {
  transactionType: 'AD_REWARD' | 'PURCHASE' | 'REFUND' | 'ADMIN_ADJUST' | 'SYSTEM'
  source: 'admob' | 'web_ad' | 'mock' | 'stripe' | 'google_play' | 'admin' | 'system'
  /** GamePurchase.id / RewardAdSession.id / free-form reference. */
  sourceId?: string
  metadata?: Record<string, unknown>
}

export type WalletCreditResult = {
  applied: boolean
  currency: WalletCurrency
  amount: number
  /** Post-credit coin balance (null for realm points). */
  coinBalance: number | null
  /** Post-credit realm cycle points (null for coins). */
  cyclePoints: number | null
}

// ─── Coins ──────────────────────────────────────────────────────────────────

/**
 * Credit coins INSIDE the caller's transaction: balance increment + ledger
 * row are atomic. The unique idempotencyKey makes a retried call a no-op
 * that still reports the (unchanged) balance — safe to retry any time.
 */
export async function creditCoins(
  tx: Prisma.TransactionClient,
  userId: string,
  amount: number,
  idempotencyKey: string,
  meta: WalletMutationMeta
): Promise<WalletCreditResult> {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('invalid_coin_amount')

  // Ledger-first: a duplicate key means this exact credit already landed.
  const dup = await tx.walletTransaction.findUnique({
    where: { idempotencyKey },
    select: { balanceAfter: true },
  })
  if (dup) {
    return { applied: false, currency: 'COINS', amount, coinBalance: dup.balanceAfter, cyclePoints: null }
  }

  const updated = await tx.user.update({
    where: { id: userId },
    data: { coinBalance: { increment: amount } },
    select: { coinBalance: true },
  })
  await tx.walletTransaction.create({
    data: {
      userId,
      currencyType: 'COINS',
      amount,
      transactionType: meta.transactionType,
      source: meta.source,
      sourceId: meta.sourceId ?? null,
      idempotencyKey,
      balanceAfter: updated.coinBalance,
      metadata: meta.metadata ? JSON.stringify(meta.metadata).slice(0, 2000) : null,
    },
  })
  return { applied: true, currency: 'COINS', amount, coinBalance: updated.coinBalance, cyclePoints: null }
}

/**
 * Debit coins (refunds / reversals / admin corrections). Guards the balance
 * never going negative — if funds are insufficient the debit is rejected and
 * the caller decides how to proceed (compensate partially, alert, ...).
 */
export async function debitCoins(
  tx: Prisma.TransactionClient,
  userId: string,
  amount: number,
  idempotencyKey: string,
  meta: WalletMutationMeta
): Promise<WalletCreditResult> {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('invalid_coin_amount')

  const dup = await tx.walletTransaction.findUnique({
    where: { idempotencyKey },
    select: { balanceAfter: true },
  })
  if (dup) {
    return { applied: false, currency: 'COINS', amount: -amount, coinBalance: dup.balanceAfter, cyclePoints: null }
  }

  const updated = await tx.user.updateMany({
    where: { id: userId, coinBalance: { gte: amount } },
    data: { coinBalance: { decrement: amount } },
  })
  if (updated.count === 0) throw new Error('insufficient_coins')

  const u = await tx.user.findUnique({ where: { id: userId }, select: { coinBalance: true } })
  await tx.walletTransaction.create({
    data: {
      userId,
      currencyType: 'COINS',
      amount: -amount,
      transactionType: meta.transactionType,
      source: meta.source,
      sourceId: meta.sourceId ?? null,
      idempotencyKey,
      balanceAfter: u?.coinBalance ?? null,
      metadata: meta.metadata ? JSON.stringify(meta.metadata).slice(0, 2000) : null,
    },
  })
  return { applied: true, currency: 'COINS', amount: -amount, coinBalance: u?.coinBalance ?? null, cyclePoints: null }
}

// ─── Realm points ───────────────────────────────────────────────────────────

/**
 * Credit realm points through the canonical, idempotent awardRealmPoints()
 * (RealmPointLedger + cycle/cohort/lifetime bookkeeping + live HUD push),
 * then record the unified WalletTransaction row. Both stages are idempotent
 * under the same key — a retry mid-crash re-runs safely.
 */
export async function creditRealmPoints(
  userId: string,
  amount: number,
  idempotencyKey: string,
  meta: WalletMutationMeta
): Promise<WalletCreditResult> {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('invalid_point_amount')

  const dup = await db.walletTransaction.findUnique({
    where: { idempotencyKey },
    select: { metadata: true },
  })
  if (dup) {
    const cycle = await currentCyclePoints(userId)
    return { applied: false, currency: 'REALM_POINTS', amount, coinBalance: null, cyclePoints: cycle }
  }

  const res = await awardRealmPoints({
    userId,
    points: amount,
    source: 'BONUS',
    sourceId: idempotencyKey, // awardRealmPoints dedupes on (sourceType, sourceId, userId)
    metadata: { ...meta.metadata, walletSource: meta.source },
  })

  await db.walletTransaction.create({
    data: {
      userId,
      currencyType: 'REALM_POINTS',
      amount,
      transactionType: meta.transactionType,
      source: meta.source,
      sourceId: meta.sourceId ?? idempotencyKey,
      idempotencyKey,
      balanceAfter: res.cyclePoints,
      metadata: JSON.stringify({ ...meta.metadata, realmLevel: res.realmLevel }).slice(0, 2000),
    },
  })
  return { applied: res.awarded, currency: 'REALM_POINTS', amount, coinBalance: null, cyclePoints: res.cyclePoints }
}

async function currentCyclePoints(userId: string): Promise<number | null> {
  const ur = await db.userRealm.findUnique({ where: { userId }, select: { cyclePoints: true } }).catch(() => null)
  return ur?.cyclePoints ?? null
}

// ─── Read model ─────────────────────────────────────────────────────────────

/** The authenticated user's wallet balances (PRD §7 — GET /api/quicky/wallet). */
export async function getWallet(userId: string): Promise<{
  coins: number
  realmPoints: number | null
  lifetimeRealmPoints: number | null
}> {
  const [user, realm] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { coinBalance: true } }),
    db.userRealm.findUnique({ where: { userId }, select: { cyclePoints: true, lifetimeRealmPoints: true } }).catch(() => null),
  ])
  return {
    coins: user?.coinBalance ?? 0,
    realmPoints: realm?.cyclePoints ?? null,
    lifetimeRealmPoints: realm?.lifetimeRealmPoints ?? null,
  }
}
