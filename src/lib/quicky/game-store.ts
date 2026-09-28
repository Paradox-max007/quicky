// Quicky — GAME STORE SERVICE (Game Economy PRD §5-§8, §34-§46, §56, §59)
//
// The server brain behind the Games section's own store (never "Premium" —
// the dating subscription stays a separate system, PRD §71/§72):
//   · Coin packages — admin-configured rows, seeded self-healing (§7/§8)
//   · Crates — REAL-MONEY products with disclosed contents (§37-§44),
//     purchase separated from open (§46)
//   · Cosmetics — bought with COINS (§34/§35, never real money directly §4)
//   · Realm boosts — final-hours config (realm-boost.ts)
//   · Monetization funnel events (§59-§62)
//
// FAULT-SAFE: like the realm system, everything here degrades gracefully if
// the Game Store tables are not migrated yet (payload falls back to empty
// catalogs; purchases fail closed with `store_unavailable`).

import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { startAndCompletePurchase, getPaymentAdapter, type CompletedPurchase } from '@/lib/quicky/payments'
import { awardRealmPoints } from '@/lib/quicky/realm/realm-point-service'
import { getViewerBoost, type RealmBoostSnapshot } from '@/lib/quicky/realm/realm-boost'
import { getClient } from '@/lib/quicky/realtime'
import { COSMETIC_TYPES } from '@/lib/quicky/rewards/catalog'

// ── Constants (parity with the pre-store premium coin perks) ───────────────
export const PREMIUM_COIN_BONUS_PCT = 0.2

// ── Bootstrap (self-healing seed, idempotent) ─────────────────────────────

let bootstrapPromise: Promise<void> | null = null

/** Seed the default catalog exactly once per process (idempotent rows). */
export function ensureGameStoreBootstrap(): Promise<void> {
  bootstrapPromise ??= (async () => {
    try {
      const packCount = await db.gameCoinPackage.count()
      if (packCount === 0) {
        await db.gameCoinPackage.createMany({
          data: [
            { name: 'Starter Pack', coins: 500, bonusCoins: 0, price: 0.99, sortOrder: 1, badge: null },
            { name: 'Small Pack', coins: 1200, bonusCoins: 100, price: 1.99, sortOrder: 2 },
            { name: 'Medium Pack', coins: 3000, bonusCoins: 400, price: 4.99, sortOrder: 3, badge: 'POPULAR' },
            { name: 'Large Pack', coins: 7500, bonusCoins: 1500, price: 9.99, sortOrder: 4 },
            { name: 'Mega Pack', coins: 20000, bonusCoins: 5000, price: 19.99, sortOrder: 5, featured: true, badge: 'BEST VALUE' },
            { name: 'Premium Exclusive I', coins: 12000, bonusCoins: 0, price: 49.99, sortOrder: 6, premiumOnly: true, badge: 'PREMIUM ONLY' },
            { name: 'Premium Exclusive II', coins: 30000, bonusCoins: 5000, price: 99.99, sortOrder: 7, premiumOnly: true, badge: 'BEST VALUE' },
          ],
        })
      }

      const crateCount = await db.crateProduct.count()
      if (crateCount === 0) {
        // Resolve gift/cosmetic references from the LIVE catalogs so the
        // contents are real, disclosed items (PRD §38).
        const gift = await db.gameItem.findFirst({
          where: { category: 'gift', isActive: true },
          orderBy: { coinPrice: 'desc' },
          select: { id: true },
        })
        const cosmetic = await db.reward.findFirst({
          where: { rewardType: { in: COSMETIC_TYPES as string[] }, status: 'ACTIVE' },
          orderBy: { rarity: 'desc' },
          select: { id: true },
        })
        await db.crateProduct.createMany({
          data: [
            {
              name: 'Starter Crate', crateType: 'STARTER', price: 1.99, emoji: '🎁',
              description: 'A gentle start: realm points plus a pile of coins.',
              realmPoints: 100, coins: 250, giftItemId: gift?.id ?? null, giftQuantity: 1, sortOrder: 1,
            },
            {
              name: 'Premium Crate', crateType: 'PREMIUM', price: 4.99, emoji: '💎',
              description: 'Serious realm progression plus coin change.',
              realmPoints: 500, coins: 750, giftItemId: gift?.id ?? null, giftQuantity: 1, sortOrder: 2,
            },
            {
              name: 'Elite Crate', crateType: 'ELITE', price: 14.99, emoji: '👑',
              description: 'The full haul: big realm points, coins, a gift and a cosmetic.',
              realmPoints: 2000, coins: 3000, giftItemId: gift?.id ?? null, giftQuantity: 3,
              cosmeticRewardId: cosmetic?.id ?? null, sortOrder: 3, bonusLabel: 'Cosmetic included',
            },
            {
              name: 'Realm Crate', crateType: 'REALM', price: 4.99, emoji: '🔥',
              description: 'Optimized for Realm progression — guaranteed realm points.',
              realmPoints: 500, coins: 500, giftItemId: gift?.id ?? null, giftQuantity: 1,
              sortOrder: 4, featured: true, bonusLabel: 'Guaranteed ❤️ realm points',
            },
          ],
        })
      }

      // Final-hours boost default: 2× during the last 4 hours of every cycle.
      const boostCount = await db.realmBoostConfig.count()
      if (boostCount === 0) {
        await db.realmBoostConfig.create({ data: { realmLevel: null, hoursBeforeEnd: 4, multiplier: 2, enabled: true } })
      }

      // Cosmetic coin prices (PRD §3/§34): by rarity where the admin has not
      // set one yet — COMMON 500 / RARE 1000 / EPIC 2000 / LEGENDARY 4000.
      const cosmeticTypes = COSMETIC_TYPES as string[]
      const unpriced = await db.reward.findMany({
        where: { rewardType: { in: cosmeticTypes }, priceCoins: null },
        select: { id: true, rarity: true },
      })
      if (unpriced.length > 0) {
        const byRarity: Record<string, number> = { COMMON: 500, RARE: 1000, EPIC: 2000, LEGENDARY: 4000 }
        await Promise.all(
          unpriced.map((r) =>
            db.reward.update({ where: { id: r.id }, data: { priceCoins: byRarity[r.rarity] ?? 500 } }).catch(() => {})
          )
        )
      }
    } catch {
      // Tables missing (pre-migration) — every read path below falls back.
      bootstrapPromise = null
    }
  })()
  return bootstrapPromise
}

// ── Store payload (PRD §6: Coins / Crates / Cosmetics / Featured) ──────────

export type StoreCoinPackage = {
  id: string
  name: string
  coins: number
  bonusCoins: number
  price: number
  currency: string
  badge: string | null
  featured: boolean
  premiumOnly: boolean
}

export type StoreCrateProduct = {
  id: string
  name: string
  description: string | null
  crateType: string
  price: number
  currency: string
  emoji: string
  imageUrl: string | null
  realmPoints: number
  coins: number
  gift: { itemId: string; name: string; emoji: string; quantity: number } | null
  cosmetic: { rewardId: string; name: string; rarity: string } | null
  bonusLabel: string | null
  featured: boolean
}

export type StoreCosmetic = {
  id: string
  rewardType: string
  name: string
  description: string | null
  rarity: string
  priceCoins: number | null
  /** Referenced by any realm reward rule → earnable through realms (PRD §54). */
  realmExclusive: boolean
  owned: boolean
  icon: string
}

export type PendingCrateRow = {
  id: string
  crateProductId: string
  name: string
  emoji: string
  purchasedAt: string
}

export type GameStorePayload = {
  ok: true
  coinBalance: number
  isPremium: boolean
  platform: 'web' | 'android' | 'ios'
  coinPackages: StoreCoinPackage[]
  crates: StoreCrateProduct[]
  cosmetics: StoreCosmetic[]
  pendingCrates: PendingCrateRow[]
  boost: RealmBoostSnapshot
  /** True while the sandbox payment adapter is active (UI labels it, §69). */
  sandbox: boolean
}

const COSMETIC_ICON: Record<string, string> = {
  HAT: '🎩',
  PROFILE_FRAME: '🖼️',
  NAME_DECORATOR: '✨',
  CHAT_BUBBLE: '💬',
}

export async function getGameStorePayload(
  userId: string,
  platform: 'web' | 'android' | 'ios'
): Promise<GameStorePayload> {
  await ensureGameStoreBootstrap()

  const [user, packs, crateRows, rewardRows, ownedCosmetics, realmRuleRefs, pendingCrates, boost] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { coinBalance: true, isPremium: true } }),
    db.gameCoinPackage.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    db.crateProduct.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    db.reward.findMany({
      where: { rewardType: { in: COSMETIC_TYPES as string[] }, status: 'ACTIVE' },
      select: { id: true, rewardType: true, name: true, description: true, rarity: true, priceCoins: true },
      orderBy: [{ rewardType: 'asc' }, { name: 'asc' }],
    }),
    db.userCosmetic.findMany({ where: { userId }, select: { rewardId: true } }),
    db.realmRewardRule.findMany({ where: { isActive: true }, select: { rewardId: true, reward: { select: { status: true } } } }).catch(() => []),
    db.cratePurchase.findMany({
      where: { userId, status: 'OWNED' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true, crateProduct: { select: { id: true, name: true, emoji: true } } },
    }).catch(() => []),
    getViewerBoost(userId).catch(() => null),
  ])

  // Crate contents disclosure (PRD §38/§44): resolve names from live rows.
  type GiftRef = { id: string; name: string; emoji: string }
  type CosmeticRef = { id: string; name: string; rarity: string }
  const giftIds = crateRows.map((c) => c.giftItemId).filter((v): v is string => !!v)
  const cosmeticIds = crateRows.map((c) => c.cosmeticRewardId).filter((v): v is string => !!v)
  const [gifts, cosmetics] = await Promise.all([
    giftIds.length
      ? db.gameItem.findMany({ where: { id: { in: giftIds } }, select: { id: true, name: true, emoji: true } }).catch(() => [] as GiftRef[])
      : Promise.resolve([] as GiftRef[]),
    cosmeticIds.length
      ? db.reward.findMany({ where: { id: { in: cosmeticIds } }, select: { id: true, name: true, rarity: true } }).catch(() => [] as CosmeticRef[])
      : Promise.resolve([] as CosmeticRef[]),
  ])
  const giftById = new Map<string, GiftRef>(gifts.map((g) => [g.id, g]))
  const cosmeticById = new Map<string, CosmeticRef>(cosmetics.map((c) => [c.id, c]))
  const ownedSet = new Set(ownedCosmetics.map((c) => c.rewardId))
  const realmRefSet = new Set(realmRuleRefs.filter((r) => r.reward?.status !== 'DISABLED').map((r) => r.rewardId))

  const { IDLE_BOOST } = await import('@/lib/quicky/realm/realm-boost')

  return {
    ok: true,
    coinBalance: user?.coinBalance ?? 0,
    isPremium: !!user?.isPremium,
    platform,
    coinPackages: packs.map((p) => ({
      id: p.id,
      name: p.name,
      coins: p.coins,
      bonusCoins: p.bonusCoins,
      price: p.price,
      currency: p.currency,
      badge: p.badge,
      featured: p.featured,
      premiumOnly: p.premiumOnly,
    })),
    crates: crateRows.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      crateType: c.crateType,
      price: c.price,
      currency: c.currency,
      emoji: c.emoji,
      imageUrl: c.imageUrl,
      realmPoints: c.realmPoints,
      coins: c.coins,
      gift: c.giftItemId
        ? (() => {
            const g = giftById.get(c.giftItemId)
            return g ? { itemId: g.id, name: g.name, emoji: g.emoji, quantity: c.giftQuantity } : null
          })()
        : null,
      cosmetic: c.cosmeticRewardId
        ? (() => {
            const r = cosmeticById.get(c.cosmeticRewardId)
            return r ? { rewardId: r.id, name: r.name, rarity: r.rarity } : null
          })()
        : null,
      bonusLabel: c.bonusLabel,
      featured: c.featured,
    })),
    cosmetics: rewardRows.map((r) => ({
      id: r.id,
      rewardType: r.rewardType,
      name: r.name,
      description: r.description,
      rarity: r.rarity,
      priceCoins: r.priceCoins,
      realmExclusive: realmRefSet.has(r.id),
      owned: ownedSet.has(r.id),
      icon: COSMETIC_ICON[r.rewardType] ?? '✨',
    })),
    pendingCrates: pendingCrates.map((c) => ({
      id: c.id,
      crateProductId: c.crateProduct.id,
      name: c.crateProduct.name,
      emoji: c.crateProduct.emoji,
      purchasedAt: c.createdAt.toISOString(),
    })),
    boost: boost ?? { ...IDLE_BOOST },
    sandbox: getPaymentAdapter(platform).provider === 'mock',
  }
}

// ── Coin purchase (PRD §9/§13/§14) ────────────────────────────────────────

export type CoinPurchaseResult =
  | ({ ok: true; coinBalance: number; coinsAdded: number; bonusCoins: number; purchaseId: string } & Omit<CompletedPurchase, 'coins' | 'bonusCoins' | 'ok'>)
  | { ok: false; error: 'store_unavailable' | 'invalid_package' | 'premium_only' | 'payment_failed' }

export async function purchaseCoinPackage(
  userId: string,
  packageId: string,
  platform: 'web' | 'android' | 'ios'
): Promise<CoinPurchaseResult> {
  await ensureGameStoreBootstrap()
  const buyer = await db.user.findUnique({ where: { id: userId }, select: { isPremium: true, coinBalance: true } }).catch(() => null)
  if (!buyer) return { ok: false, error: 'store_unavailable' }

  const pack = await db.gameCoinPackage.findUnique({ where: { id: packageId } }).catch(() => null)
  if (!pack || !pack.isActive) return { ok: false, error: 'invalid_package' }
  if (pack.premiumOnly && !buyer.isPremium) return { ok: false, error: 'premium_only' }

  // Legacy premium parity: +20% bonus on standard packs for premium members.
  const premiumBonus = buyer.isPremium && !pack.premiumOnly ? Math.round(pack.coins * PREMIUM_COIN_BONUS_PCT) : 0
  const totalCoins = pack.coins + pack.bonusCoins + premiumBonus

  const purchase = await startAndCompletePurchase(
    {
      userId,
      productId: pack.id,
      productType: 'COIN_PACK',
      currency: pack.currency,
      amount: pack.price,
      coins: pack.coins,
      bonusCoins: pack.bonusCoins + premiumBonus,
      metadata: { packageName: pack.name, baseCoins: pack.coins, packBonus: pack.bonusCoins, premiumBonus },
    },
    platform,
    async (tx: Prisma.TransactionClient) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: { coinBalance: { increment: totalCoins } },
        select: { coinBalance: true },
      })
      await tx.coinLedger.create({
        data: {
          userId,
          delta: totalCoins,
          reason: 'purchase',
          meta: JSON.stringify({ purchaseType: 'COIN_PACK', packageId: pack.id, coins: totalCoins, baseCoins: pack.coins, bonusCoins: pack.bonusCoins, premiumBonus, mock: true }),
        },
      })
      await tx.gameMonetizationEvent
        .create({ data: { userId, type: 'purchase_completed', metadata: JSON.stringify({ productId: pack.id, productType: 'COIN_PACK', coins: totalCoins }) } })
        .catch(() => {})
      return { coinBalance: updated.coinBalance }
    }
  )

  if (!purchase.ok) return { ok: false, error: purchase.error === 'credit_failed' ? 'payment_failed' : 'payment_failed' }
  const fresh = (await db.user.findUnique({ where: { id: userId }, select: { coinBalance: true } }).catch(() => null))?.coinBalance ?? buyer.coinBalance + totalCoins
  broadcastCoinBalance(userId, fresh)
  return {
    ok: true,
    coinBalance: fresh,
    coinsAdded: totalCoins,
    bonusCoins: pack.bonusCoins + premiumBonus,
    purchaseId: purchase.purchaseId,
    provider: purchase.provider,
    providerTransactionId: purchase.providerTransactionId,
    status: purchase.status,
  }
}

/** PRD §52 — the room HUD + every open surface sees the new balance live. */
async function broadcastCoinBalance(userId: string, coinBalance: number) {
  try {
    // SpinRoom statuses are WAITING | STARTING | PLAYING (| CLOSING) — a
    // member with no leftAt is in a live room either way; status only trims
    // closed rooms out of the lookup.
    const membership = await db.spinRoomPlayer.findFirst({
      where: { userId, leftAt: null, room: { status: { in: ['WAITING', 'STARTING', 'PLAYING'] } } },
      orderBy: { joinedAt: 'desc' },
      select: { roomId: true },
    })
    const supabase = getClient()
    if (membership && supabase) {
      void supabase
        .channel(`room:${membership.roomId}`)
        .send({ type: 'broadcast', event: 'balance', payload: { userId, coinBalance } })
        .catch?.(() => {})
    }
  } catch {
    // broadcast is cosmetic — never fail a purchase over it
  }
}

// ── Crate purchase + open (PRD §37-§46) ───────────────────────────────────

export type CratePurchaseResult =
  | { ok: true; cratePurchaseId: string; purchaseId: string; name: string; emoji: string }
  | { ok: false; error: 'store_unavailable' | 'invalid_crate' | 'payment_failed' }

export async function purchaseCrate(
  userId: string,
  crateProductId: string,
  platform: 'web' | 'android' | 'ios'
): Promise<CratePurchaseResult> {
  await ensureGameStoreBootstrap()
  const product = await db.crateProduct.findUnique({ where: { id: crateProductId } }).catch(() => null)
  if (!product || !product.isActive) return { ok: false, error: 'invalid_crate' }

  const purchase = await startAndCompletePurchase(
    {
      userId,
      productId: product.id,
      productType: 'CRATE',
      currency: product.currency,
      amount: product.price,
      metadata: { crateName: product.name, realmPoints: product.realmPoints, coins: product.coins },
    },
    platform,
    async (tx: Prisma.TransactionClient, purchaseId: string) => {
      // Payment verified → entitlement OWNED (open comes later, PRD §46).
      // Linked to the GamePurchase row atomically — a crash can never leave
      // a paid-but-untracked entitlement.
      const cp = await tx.cratePurchase.create({
        data: { userId, crateProductId: product.id, purchaseId, status: 'OWNED' },
        select: { id: true },
      })
      await tx.gameMonetizationEvent
        .create({ data: { userId, type: 'crate_purchase_completed', metadata: JSON.stringify({ crateProductId: product.id }) } })
        .catch(() => {})
      return { cratePurchaseId: cp.id }
    }
  )

  if (!purchase.ok) return { ok: false, error: 'payment_failed' }
  const cratePurchaseId = (purchase as Record<string, unknown>).cratePurchaseId as string
  return { ok: true, cratePurchaseId, purchaseId: purchase.purchaseId, name: product.name, emoji: product.emoji }
}

export type CrateRewardReveal = {
  realmPoints: number
  coins: number
  gift: { itemId: string; name: string; emoji: string; quantity: number } | null
  cosmetic: { rewardId: string; name: string; icon: string } | null
  coinBalance: number
  realmPointsAwarded: boolean
}

export type OpenCrateResult =
  | { ok: true; rewards: CrateRewardReveal }
  | { ok: false; error: 'store_unavailable' | 'not_found' | 'already_opened' }

/**
 * Open an OWNED crate — exactly once (conditional OWNED → OPENED update
 * keys the whole reward grant, PRD §46). Rewards flow through the SAME
 * authoritative services: realm points via awardRealmPoints (source CRATE),
 * coins through the ledger, gifts into inventory, cosmetics into the
 * wardrobe.
 */
export async function openCrate(userId: string, cratePurchaseId: string): Promise<OpenCrateResult> {
  const cp = await db.cratePurchase
    .findUnique({ where: { id: cratePurchaseId }, include: { crateProduct: true } })
    .catch(() => null)
  if (!cp || cp.userId !== userId) return { ok: false, error: 'not_found' }

  // Exactly-once gate: only the row that is still OWNED proceeds.
  const flipped = await db.cratePurchase
    .updateMany({ where: { id: cp.id, status: 'OWNED' }, data: { status: 'OPENED', openedAt: new Date() } })
    .catch(() => ({ count: 0 }))
  if (flipped.count === 0) return { ok: false, error: 'already_opened' }

  const product = cp.crateProduct

  // Resolve display data for the snapshot BEFORE granting.
  const [giftRow, cosmeticRow] = await Promise.all([
    product.giftItemId
      ? db.gameItem.findUnique({ where: { id: product.giftItemId }, select: { id: true, name: true, emoji: true } }).catch(() => null)
      : Promise.resolve(null),
    product.cosmeticRewardId
      ? db.reward.findUnique({ where: { id: product.cosmeticRewardId }, select: { id: true, name: true, rewardType: true } }).catch(() => null)
      : Promise.resolve(null),
  ])

  const rewardSnapshot = {
    realmPoints: product.realmPoints,
    coins: product.coins,
    gift: giftRow ? { itemId: giftRow.id, name: giftRow.name, emoji: giftRow.emoji, quantity: product.giftQuantity } : null,
    cosmetic: cosmeticRow ? { rewardId: cosmeticRow.id, name: cosmeticRow.name, icon: COSMETIC_ICON[cosmeticRow.rewardType] ?? '✨' } : null,
  }

  // ── Grant coins + inventory + cosmetic (ledger + idempotent upserts) ────
  const coinBalance = await db
    .$transaction(async (tx: Prisma.TransactionClient) => {
      let balance: number | null = null
      if (product.coins > 0) {
        const updated = await tx.user.update({
          where: { id: userId },
          data: { coinBalance: { increment: product.coins } },
          select: { coinBalance: true },
        })
        balance = updated.coinBalance
        await tx.coinLedger.create({
          data: {
            userId,
            delta: product.coins,
            reason: 'crate_prize',
            meta: JSON.stringify({ cratePurchaseId: cp.id, crateProductId: product.id, crateName: product.name, mock: true }),
          },
        })
      }
      if (giftRow) {
        await tx.userItem.upsert({
          where: { userId_itemId: { userId, itemId: giftRow.id } },
          create: { userId, itemId: giftRow.id, quantity: product.giftQuantity },
          update: { quantity: { increment: product.giftQuantity } },
        })
      }
      if (cosmeticRow) {
        await tx.userCosmetic
          .upsert({
            where: { userId_rewardId_level: { userId, rewardId: cosmeticRow.id, level: 1 } },
            create: { userId, rewardId: cosmeticRow.id, level: 1, source: 'CRATE' },
            update: {},
          })
          .catch(() => {})
      }
      return balance
    })
    .catch(() => null)

  // ── Realm points through the UNIFIED service (PRD §56) ─────────────────
  const realmAward = product.realmPoints
    ? await awardRealmPoints({ userId, points: product.realmPoints, source: 'CRATE', sourceId: cp.id, metadata: { crateProductId: product.id, crateName: product.name } }).catch(() => null)
    : null

  // Persist the snapshot for the recovery/audit path.
  await db.cratePurchase.update({ where: { id: cp.id }, data: { rewards: JSON.stringify(rewardSnapshot) } }).catch(() => {})
  await db.gameMonetizationEvent
    .create({ data: { userId, type: 'crate_opened', metadata: JSON.stringify({ crateProductId: product.id, cratePurchaseId: cp.id }) } })
    .catch(() => {})

  const finalBalance =
    coinBalance ??
    (await db.user.findUnique({ where: { id: userId }, select: { coinBalance: true } }).catch(() => null))?.coinBalance ??
    0

  return {
    ok: true,
    rewards: {
      ...rewardSnapshot,
      coinBalance: finalBalance,
      realmPointsAwarded: !!realmAward?.awarded,
    },
  }
}

// ── Cosmetic purchase with COINS (PRD §34-§36) ────────────────────────────

export type CosmeticPurchaseResult =
  | { ok: true; coinBalance: number; priceCoins: number }
  | { ok: false; error: 'store_unavailable' | 'invalid_cosmetic' | 'not_purchasable' | 'insufficient_coins' | 'already_owned' }

export async function purchaseCosmetic(userId: string, rewardId: string, level = 1): Promise<CosmeticPurchaseResult> {
  await ensureGameStoreBootstrap()
  const reward = await db.reward.findUnique({ where: { id: rewardId } }).catch(() => null)
  if (!reward || reward.status !== 'ACTIVE') return { ok: false, error: 'invalid_cosmetic' }
  if (!(COSMETIC_TYPES as string[]).includes(reward.rewardType)) return { ok: false, error: 'invalid_cosmetic' }
  if (reward.priceCoins == null || reward.priceCoins <= 0) return { ok: false, error: 'not_purchasable' }

  const existing = await db.userCosmetic.findUnique({ where: { userId_rewardId_level: { userId, rewardId, level } } }).catch(() => null)
  if (existing) return { ok: false, error: 'already_owned' }

  const price = reward.priceCoins
  const result = await db
    .$transaction(async (tx: Prisma.TransactionClient) => {
      // Race-safe conditional decrement — a parallel buy can never go negative.
      const debited = await tx.user.updateMany({
        where: { id: userId, coinBalance: { gte: price } },
        data: { coinBalance: { decrement: price } },
      })
      if (debited.count === 0) throw new Error('insufficient_coins')
      await tx.coinLedger.create({
        data: { userId, delta: -price, reason: 'cosmetic_purchase', meta: JSON.stringify({ rewardId, rewardType: reward.rewardType, name: reward.name, level }) },
      })
      await tx.userCosmetic.create({ data: { userId, rewardId, level, source: 'PURCHASE' } })
      const fresh = await tx.user.findUnique({ where: { id: userId }, select: { coinBalance: true } })
      return fresh?.coinBalance ?? 0
    })
    .catch((e: unknown) => {
      if ((e as Error)?.message === 'insufficient_coins') return null
      throw e
    })
    .catch(() => null)

  if (result == null) return { ok: false, error: 'insufficient_coins' }
  await db.gameMonetizationEvent
    .create({ data: { userId, type: 'cosmetic_purchased', metadata: JSON.stringify({ rewardId, priceCoins: price }) } })
    .catch(() => {})
  broadcastCoinBalance(userId, result)
  return { ok: true, coinBalance: result, priceCoins: price }
}

// ── Purchase recovery (PRD §70) + funnel tracking (§60) ────────────────────

export async function syncPurchases(userId: string) {
  const [purchases, ownedCrates] = await Promise.all([
    db.gamePurchase
      .findMany({ where: { userId, status: { in: ['PENDING', 'PROCESSING'] } }, orderBy: { createdAt: 'desc' }, take: 20 })
      .catch(() => []),
    db.cratePurchase
      .findMany({
        where: { userId, status: 'OWNED' },
        orderBy: { createdAt: 'desc' },
        include: { crateProduct: { select: { id: true, name: true, emoji: true } } },
      })
      .catch(() => []),
  ])
  return {
    pending: purchases.map((p) => ({
      id: p.id,
      productId: p.productId,
      productType: p.productType,
      status: p.status,
      amount: p.amount,
      currency: p.currency,
      createdAt: p.createdAt.toISOString(),
    })),
    ownedCrates: ownedCrates.map((c) => ({
      id: c.id,
      crateProductId: c.crateProduct.id,
      name: c.crateProduct.name,
      emoji: c.crateProduct.emoji,
      purchasedAt: c.createdAt.toISOString(),
    })),
  }
}

/** Fire-and-forget funnel tracking (PRD §60-§62) — never blocks a surface. */
export async function trackMonetizationEvent(
  userId: string | null,
  type: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await db.gameMonetizationEvent
    .create({ data: { userId, type, metadata: metadata ? JSON.stringify(metadata).slice(0, 500) : null } })
    .catch(() => {})
}

// ── Admin: monetization dashboard aggregates (PRD §59) ─────────────────────

export async function getMonetizationStats() {
  const since = new Date(Date.now() - 30 * 24 * 3_600_000)
  const [revenue, purchaseCount, coinsPurchased, coinsSpent, cratesPurchased, cratesOpened, giftsSent, funnel, recent] =
    await Promise.all([
      db.gamePurchase.aggregate({ where: { status: 'COMPLETED' }, _sum: { amount: true } }).catch(() => ({ _sum: { amount: null } })),
      db.gamePurchase.count({ where: { status: 'COMPLETED' } }).catch(() => 0),
      db.coinLedger.aggregate({ where: { reason: 'purchase', delta: { gt: 0 } }, _sum: { delta: true } }).catch(() => ({ _sum: { delta: null } })),
      db.coinLedger.aggregate({ where: { delta: { lt: 0 } }, _sum: { delta: true } }).catch(() => ({ _sum: { delta: null } })),
      db.gamePurchase.count({ where: { productType: 'CRATE', status: 'COMPLETED' } }).catch(() => 0),
      db.cratePurchase.count({ where: { status: 'OPENED' } }).catch(() => 0),
      db.spinRoomGift.count().catch(() => 0),
      db.gameMonetizationEvent.groupBy({ by: ['type'], _count: { type: true }, where: { createdAt: { gte: since } } }).catch(() => []),
      db.gamePurchase
        .findMany({
          where: { status: 'COMPLETED' },
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: { user: { select: { name: true, phone: true } } },
        })
        .catch(() => []),
    ])

  const revenueTotal = revenue._sum.amount ?? 0
  return {
    revenueTotal,
    avgPurchaseValue: purchaseCount > 0 ? revenueTotal / purchaseCount : 0,
    purchaseCount,
    coinsPurchased: coinsPurchased._sum.delta ?? 0,
    coinsSpent: Math.abs(coinsSpent._sum.delta ?? 0),
    cratesPurchased,
    cratesOpened,
    giftsSent,
    funnel: funnel.map((f) => ({ type: f.type, count: f._count.type })),
    recentPurchases: recent.map((p) => ({
      id: p.id,
      user: p.user?.name ?? p.user?.phone ?? '—',
      productType: p.productType,
      amount: p.amount,
      currency: p.currency,
      provider: p.provider,
      status: p.status,
      createdAt: p.createdAt.toISOString(),
    })),
  }
}
