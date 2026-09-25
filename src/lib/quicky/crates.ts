// Quicky — CRATES SERVICE (crate-pass PRD — the purchasable "realm pass")
//
// A crate is a 100-level prize track opened from the 👑 room chip:
//   · "Get Crate" (unlock)  — coins, admin-configured price on Crate
//   · Level advance         — CRATE POINTS (won by promoting out of realms:
//                             RealmDefinition.cratePoints per level) OR buying
//                             levels/packs with coins (per-level admin price)
//   · Every reached level unlocks its configured PRIZE exactly once
//     (CrateLevelGrant unique key = idempotency)
//
// currentLevel = min(levelCount, cratePoints + boughtLevels). Crate points
// accumulate on a LOCKED crate too — they apply the instant it is unlocked
// (buying the pass after winning realms instantly pops the earned levels).
//
// Which crate receives realm-win points: the user's unlocked pass if any
// (first by sortOrder), else the FIRST active crate (the featured one).

import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'

export const CRATE_LEVELS_DEFAULT = 100
export const CRATE_UNLOCK_PRICE_DEFAULT = 500
export const CRATE_LEVEL_PRICE_DEFAULT = 100
export const CRATE_MILESTONES = [10, 25, 50, 100] as const

/** Standard packs offered on the crate-details screen (levels each). */
export const CRATE_PACKS = [1, 5, 10, 25] as const

type AnyDb = Prisma.TransactionClient

let bootstrapCheckedAt = 0
const BOOTSTRAP_TTL_MS = 60_000

/**
 * Idempotently ensure at least one ACTIVE crate exists (seed: 100 levels,
 * coin prizes — small every level, bigger at milestones — default prices).
 * Admins own everything afterwards through the console.
 */
export async function ensureCrateBootstrap(): Promise<void> {
  const now = Date.now()
  if (now - bootstrapCheckedAt < BOOTSTRAP_TTL_MS) return
  bootstrapCheckedAt = now

  const count = await db.crate.count({ where: { isActive: true } }).catch(() => 0)
  if (count > 0) return

  const crate = await db.crate
    .create({
      data: {
        name: 'Realm Crate',
        description: 'The monthly realm pass — win realms to climb 100 prize levels.',
        priceCoins: CRATE_UNLOCK_PRICE_DEFAULT,
        levelCount: CRATE_LEVELS_DEFAULT,
        isActive: true,
        sortOrder: 0,
      },
    })
    .catch(() => null)
  if (!crate) return

  await db.crateLevel
    .createMany({
      data: Array.from({ length: CRATE_LEVELS_DEFAULT }, (_, i) => {
        const level = i + 1
        const milestone = CRATE_MILESTONES.includes(level as (typeof CRATE_MILESTONES)[number])
        return {
          crateId: crate.id,
          level,
          prizeType: 'COINS',
          prizeName: milestone ? `Milestone ${level} Coin Drop` : 'Coin Drop',
          prizeEmoji: '🪙',
          quantity: milestone ? 250 : 20,
          priceCoins: CRATE_LEVEL_PRICE_DEFAULT,
        }
      }),
      skipDuplicates: true,
    })
    .catch(() => {})
}

/** The active crates in display order. */
async function activeCrates() {
  return db.crate.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } })
}

/** The crate that receives realm-win crate points for this user. */
export async function resolvePointsCrate(userId: string): Promise<{ id: string; levelCount: number } | null> {
  await ensureCrateBootstrap()
  const crates = await activeCrates()
  if (crates.length === 0) return null
  const mine = await db.userCrate
    .findMany({
      where: { userId, crateId: { in: crates.map((c) => c.id) }, unlockedAt: { not: null } },
      select: { crateId: true },
    })
    .catch(() => [] as { crateId: string }[])
  const unlocked = crates.find((c) => mine.some((m) => m.crateId === c.id))
  const target = unlocked ?? crates[0]
  return { id: target.id, levelCount: target.levelCount }
}

// ─── Prize granting (idempotent per level) ──────────────────────────────────

async function grantLevelPrize(client: AnyDb, userId: string, level: { prizeType: string; itemId: string | null; prizeName: string | null; prizeEmoji: string | null; quantity: number }): Promise<void> {
  const qty = Math.max(1, Math.floor(level.quantity) || 1)
  if (level.prizeType === 'COINS') {
    await client.user
      .update({ where: { id: userId }, data: { coinBalance: { increment: qty } } })
      .catch(() => {})
    await client.coinLedger
      .create({
        data: {
          userId,
          delta: qty,
          reason: 'crate_prize',
          meta: JSON.stringify({ prizeName: level.prizeName ?? 'Crate prize' }),
        },
      })
      .catch(() => {})
    return
  }
  // GIFT — through the EXISTING inventory (UserItem upsert + increment).
  if (!level.itemId) return
  const exists = await client.gameItem.findUnique({ where: { id: level.itemId }, select: { id: true } }).catch(() => null)
  if (!exists) return
  await client.userItem
    .upsert({
      where: { userId_itemId: { userId, itemId: level.itemId } },
      create: { userId, itemId: level.itemId, quantity: qty },
      update: { quantity: { increment: qty } },
    })
    .catch(() => {})
}

/**
 * Recompute the reached level for a UserCrate row and grant every NEWLY
 * reached level's prize (idempotent via CrateLevelGrant). `source` labels the
 * trigger for the ledger. Returns the new currentLevel.
 */
async function syncCrateProgress(
  client: AnyDb,
  userCrate: { userId: string; crateId: string; cratePoints: number; boughtLevels: number; currentLevel: number },
  crate: { levelCount: number },
  source: 'WON' | 'BOUGHT'
): Promise<number> {
  const reached = Math.min(crate.levelCount, Math.max(0, userCrate.cratePoints) + Math.max(0, userCrate.boughtLevels))
  if (reached <= userCrate.currentLevel) return userCrate.currentLevel

  const levels = await client.crateLevel
    .findMany({
      where: { crateId: userCrate.crateId, level: { gt: userCrate.currentLevel, lte: reached } },
      orderBy: { level: 'asc' },
    })
    .catch(() => [])

  for (const lv of levels) {
    // Create-first: the unique key makes the prize grant exactly-once.
    const created = await client.crateLevelGrant
      .create({ data: { userId: userCrate.userId, crateId: userCrate.crateId, level: lv.level, source } })
      .then(() => true)
      .catch(() => false)
    if (created) await grantLevelPrize(client, userCrate.userId, lv)
  }

  await client.userCrate
    .update({
      where: { userId_crateId: { userId: userCrate.userId, crateId: userCrate.crateId } },
      data: { currentLevel: reached },
    })
    .catch(() => {})
  return reached
}

// ─── Realm-win hook (called from cycle settlement) ─────────────────────────

/**
 * Award crate points for WINNING a realm (promotion at settlement). Points
 * land on the user's crate (see resolvePointsCrate); levels advance instantly
 * when the crate is unlocked. Fire-and-forget safe — settlement never breaks.
 */
export async function awardCratePoints(userId: string, points: number): Promise<void> {
  const amount = Math.floor(points)
  if (amount <= 0) return
  try {
    await ensureCrateBootstrap()
    const target = await resolvePointsCrate(userId)
    if (!target) return
    const uc = await db.userCrate.upsert({
      where: { userId_crateId: { userId, crateId: target.id } },
      create: { userId, crateId: target.id, cratePoints: amount },
      update: { cratePoints: { increment: amount } },
    })
    if (uc.unlockedAt) {
      await syncCrateProgress(db, { ...uc, cratePoints: uc.cratePoints }, target, 'WON')
    }
  } catch {
    // never break settlement
  }
}

// ─── Viewer catalog / detail ────────────────────────────────────────────────

export type CrateCatalogRow = {
  id: string
  name: string
  description: string | null
  imageUrl: string | null
  priceCoins: number
  levelCount: number
  unlocked: boolean
  currentLevel: number
  cratePoints: number
  /** The crate realm-win points feed (the featured/current pass). */
  isPointsTarget: boolean
}

export async function getCrateCatalog(userId: string): Promise<CrateCatalogRow[]> {
  await ensureCrateBootstrap()
  const crates = await activeCrates()
  if (crates.length === 0) return []
  const mine = await db.userCrate
    .findMany({ where: { userId, crateId: { in: crates.map((c) => c.id) } } })
    .catch(() => [] as Awaited<ReturnType<typeof db.userCrate.findMany>>)
  const byCrate = new Map(mine.map((m) => [m.crateId, m] as const))
  const pointsTarget = await resolvePointsCrate(userId)

  return crates.map((c) => {
    const uc = byCrate.get(c.id)
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      imageUrl: c.imageUrl,
      priceCoins: c.priceCoins,
      levelCount: c.levelCount,
      unlocked: !!uc?.unlockedAt,
      currentLevel: uc?.currentLevel ?? 0,
      cratePoints: uc?.cratePoints ?? 0,
      isPointsTarget: pointsTarget?.id === c.id,
    }
  })
}

export type CrateLevelRow = {
  level: number
  prizeType: string
  prizeName: string | null
  prizeEmoji: string | null
  quantity: number
  priceCoins: number
  reached: boolean
}

export type CratePackRow = { levels: number; priceCoins: number; label: string; affordable: boolean }

export type CrateDetail = {
  crate: CrateCatalogRow
  levels: CrateLevelRow[]
  packs: CratePackRow[]
}

export async function getCrateDetail(userId: string, crateId: string): Promise<CrateDetail | null> {
  await ensureCrateBootstrap()
  const crate = await db.crate.findUnique({ where: { id: crateId } })
  if (!crate || !crate.isActive) return null

  const [levels, uc, balance] = await Promise.all([
    db.crateLevel.findMany({ where: { crateId }, orderBy: { level: 'asc' } }),
    db.userCrate.findUnique({ where: { userId_crateId: { userId, crateId } } }).catch(() => null),
    db.user.findUnique({ where: { id: userId }, select: { coinBalance: true } }).catch(() => null),
  ])

  const unlocked = !!uc?.unlockedAt
  const currentLevel = uc?.currentLevel ?? 0
  const pointsTarget = await resolvePointsCrate(userId)
  const catalogRow: CrateCatalogRow = {
    id: crate.id,
    name: crate.name,
    description: crate.description,
    imageUrl: crate.imageUrl,
    priceCoins: crate.priceCoins,
    levelCount: crate.levelCount,
    unlocked,
    currentLevel,
    cratePoints: uc?.cratePoints ?? 0,
    isPointsTarget: pointsTarget?.id === crate.id,
  }

  const balanceCoins = balance?.coinBalance ?? 0
  // Resolve GIFT prize display (name/emoji) from the live catalog — admin
  // rows may carry only the itemId.
  const giftIds = levels.filter((lv) => lv.prizeType !== 'COINS' && lv.itemId).map((lv) => lv.itemId as string)
  const giftItems = giftIds.length
    ? await db.gameItem
        .findMany({ where: { id: { in: giftIds } }, select: { id: true, name: true, emoji: true, iconType: true, iconValue: true } })
        .catch(() => [] as Awaited<ReturnType<typeof db.gameItem.findMany>>)
    : []
  const itemById = new Map(giftItems.map((g) => [g.id, g] as const))
  const levelRows: CrateLevelRow[] = levels.map((lv) => {
    const gift = lv.prizeType !== 'COINS' && lv.itemId ? itemById.get(lv.itemId) : undefined
    return {
      level: lv.level,
      prizeType: lv.prizeType,
      prizeName: lv.prizeName ?? gift?.name ?? (lv.prizeType === 'COINS' ? 'Coin Drop' : 'Gift'),
      prizeEmoji: lv.prizeEmoji ?? gift?.emoji ?? (lv.prizeType === 'COINS' ? '🪙' : '🎁'),
      quantity: lv.quantity,
      priceCoins: lv.priceCoins,
      reached: lv.level <= currentLevel,
    }
  })

  // Packs: N levels starting at currentLevel+1 — price = the SUM of those
  // levels' configured prices (transparent, admin-owned through level prices).
  const packs: CratePackRow[] = CRATE_PACKS.filter((n) => n >= 1).map((n) => {
    const slice = levels.filter((lv) => lv.level > currentLevel && lv.level <= currentLevel + n)
    const price = slice.reduce((sum, lv) => sum + Math.max(0, lv.priceCoins), 0)
    return {
      levels: n,
      priceCoins: price,
      label: n === 1 ? 'Single level' : `${n} levels`,
      affordable: unlocked && slice.length > 0 && balanceCoins >= price,
    }
  })

  return { crate: catalogRow, levels: levelRows, packs }
}

// ─── Purchases (transactional, race-safe coin deduction) ───────────────────

export type PurchaseResult =
  | { ok: true; coinBalance: number; currentLevel: number; unlocked: boolean; newLevels: number[] }
  | { ok: false; error: 'not_found' | 'already_unlocked' | 'insufficient_coins' | 'crate_locked' | 'no_levels_left'; coinBalance?: number }

/**
 * "Get Crate" — unlock the crate with coins. Any crate points accumulated
 * while locked apply immediately (earned levels + prizes pop on unlock).
 */
export async function purchaseCrate(userId: string, crateId: string): Promise<PurchaseResult> {
  await ensureCrateBootstrap()
  const crate = await db.crate.findUnique({ where: { id: crateId } })
  if (!crate || !crate.isActive) return { ok: false, error: 'not_found' }

  const existing = await db.userCrate.findUnique({ where: { userId_crateId: { userId, crateId } } })
  if (existing?.unlockedAt) return { ok: false, error: 'already_unlocked' }

  const price = Math.max(0, crate.priceCoins)
  const user = await db.user.findUnique({ where: { id: userId }, select: { coinBalance: true } })
  if ((user?.coinBalance ?? 0) < price) {
    return { ok: false, error: 'insufficient_coins', coinBalance: user?.coinBalance ?? 0 }
  }

  const result = await db
    .$transaction(async (tx) => {
      // Race-safe conditional decrement (mirrors the gift send flow).
      const spent = await tx.user.updateMany({
        where: { id: userId, coinBalance: { gte: price } },
        data: { coinBalance: { decrement: price } },
      })
      if (spent.count === 0) return { insufficient: true as const }

      await tx.coinLedger.create({
        data: { userId, delta: -price, reason: 'crate_unlock', meta: JSON.stringify({ crateId, crateName: crate.name }) },
      })

      const uc = await tx.userCrate.upsert({
        where: { userId_crateId: { userId, crateId } },
        create: { userId, crateId, unlockedAt: new Date() },
        update: { unlockedAt: new Date() },
      })
      const newLevel = await syncCrateProgress(tx, uc, crate, 'WON')
      const fresh = await tx.user.findUnique({ where: { id: userId }, select: { coinBalance: true } })
      const grants = await tx.crateLevelGrant.findMany({
        where: { userId, crateId, level: { lte: newLevel } },
        select: { level: true },
      })
      return { insufficient: false as const, balance: fresh?.coinBalance ?? 0, newLevel, granted: grants.map((g) => g.level) }
    })
    .catch(() => null)

  if (!result) return { ok: false, error: 'not_found' }
  if (result.insufficient) return { ok: false, error: 'insufficient_coins' }
  return { ok: true, coinBalance: result.balance, currentLevel: result.newLevel, unlocked: true, newLevels: result.granted }
}

/**
 * Buy N levels with coins (only once the crate is unlocked). Price = the sum
 * of the next N locked levels' configured prices.
 */
export async function buyCrateLevels(userId: string, crateId: string, count: number): Promise<PurchaseResult> {
  await ensureCrateBootstrap()
  const crate = await db.crate.findUnique({ where: { id: crateId } })
  if (!crate || !crate.isActive) return { ok: false, error: 'not_found' }

  const existing = await db.userCrate.findUnique({ where: { userId_crateId: { userId, crateId } } })
  if (!existing?.unlockedAt) return { ok: false, error: 'crate_locked' }

  const n = Math.floor(count)
  if (n < 1) return { ok: false, error: 'no_levels_left' }

  const levels = await db.crateLevel.findMany({
    where: { crateId, level: { gt: existing.currentLevel, lte: existing.currentLevel + n } },
    orderBy: { level: 'asc' },
  })
  if (levels.length === 0) return { ok: false, error: 'no_levels_left' }

  const price = levels.reduce((sum, lv) => sum + Math.max(0, lv.priceCoins), 0)
  const user = await db.user.findUnique({ where: { id: userId }, select: { coinBalance: true } })
  if ((user?.coinBalance ?? 0) < price) {
    return { ok: false, error: 'insufficient_coins', coinBalance: user?.coinBalance ?? 0 }
  }

  const result = await db
    .$transaction(async (tx) => {
      const spent = await tx.user.updateMany({
        where: { id: userId, coinBalance: { gte: price } },
        data: { coinBalance: { decrement: price } },
      })
      if (spent.count === 0) return { insufficient: true as const }

      await tx.coinLedger.create({
        data: { userId, delta: -price, reason: 'crate_levels', meta: JSON.stringify({ crateId, levels: levels.length }) },
      })

      const uc = await tx.userCrate.update({
        where: { userId_crateId: { userId, crateId } },
        data: { boughtLevels: { increment: levels.length } },
      })
      const newLevel = await syncCrateProgress(tx, uc, crate, 'BOUGHT')
      const fresh = await tx.user.findUnique({ where: { id: userId }, select: { coinBalance: true } })
      const grants = await tx.crateLevelGrant.findMany({
        where: { userId, crateId, level: { lte: newLevel } },
        select: { level: true },
      })
      return { insufficient: false as const, balance: fresh?.coinBalance ?? 0, newLevel, granted: grants.map((g) => g.level) }
    })
    .catch(() => null)

  if (!result) return { ok: false, error: 'not_found' }
  if (result.insufficient) return { ok: false, error: 'insufficient_coins' }
  return { ok: true, coinBalance: result.balance, currentLevel: result.newLevel, unlocked: true, newLevels: result.granted }
}
