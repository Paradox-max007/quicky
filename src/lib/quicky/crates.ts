// Quicky — CRATES SERVICE (crate-tracks PRD — the battle-pass "crate room")
//
// A crate is a 100-level BATTLE-PASS prize track opened from the 👑 room chip.
// Every level carries TWO aligned prizes:
//   · FREE track  — collectible by WINNING REALMS alone (crate points climb
//                   the levels; no purchase needed)
//   · CRATE track — pops only after the crate pack is bought ("Get Crate");
//                   realm wins then collect BOTH tracks' reached prizes
//
// Level advance: CRATE POINTS earned per realm PLACEMENT (1st-8th, each
// realm's per-place amounts admin-configured — see DEFAULT_CRATE_PLACE_POINTS)
// measured against each level's admin-set cumulative thresholdPoints, or
// buying levels/packs with coins (per-level admin price).
//
// currentLevel is the MONOTONIC reached-level marker: the highest level whose
// thresholdPoints ≤ cratePoints (buys advance the marker directly). Every
// reached level's FREE prize grants exactly once (CrateLevelGrant unique key
// userId+crateId+level+track); CRATE-track prizes for reached levels pop the
// instant the pack is bought.
//
// Which crate receives realm-win points: the user's unlocked pass if any
// (first by sortOrder), else the FIRST active crate (the featured one).

import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'

export const CRATE_LEVELS_DEFAULT = 100
export const CRATE_UNLOCK_PRICE_DEFAULT = 500
export const CRATE_LEVEL_PRICE_DEFAULT = 100
export const CRATE_MILESTONES = [10, 25, 50, 100] as const
/** Default CUMULATIVE threshold: level N needs N × this many crate points. */
export const CRATE_THRESHOLD_STEP_DEFAULT = 20

/** Standard packs offered on the crate-details screen (levels each). */
export const CRATE_PACKS = [1, 5, 10, 25] as const

/**
 * Default crate points per realm PLACEMENT (1st-8th) when a cycle settles —
 * every ranked player earns their place's points. Per-realm overrides live
 * in RealmDefinition.cratePointsByPlace (admin-owned).
 */
export const DEFAULT_CRATE_PLACE_POINTS: Record<string, number> = {
  '1': 100, '2': 80, '3': 60, '4': 40, '5': 25, '6': 15, '7': 10, '8': 5,
}

/** Parse a RealmDefinition.cratePointsByPlace JSON (invalid → null). */
export function parseCratePointsByPlace(json: string | null | undefined): Record<string, number> | null {
  if (!json) return null
  try {
    const raw = JSON.parse(json) as Record<string, unknown>
    const out: Record<string, number> = {}
    for (let place = 1; place <= 8; place++) {
      const v = Number(raw[String(place)])
      if (Number.isInteger(v) && v >= 0 && v <= 100_000) out[String(place)] = v
    }
    return Object.keys(out).length > 0 ? out : null
  } catch {
    return null
  }
}

/** Crate points for a settlement place (per-realm table → global default). */
export function cratePointsForPlace(
  byPlace: Record<string, number> | null,
  place: number,
  legacyFlat: number,
): number {
  if (byPlace && byPlace[String(place)] !== undefined) return byPlace[String(place)]
  return DEFAULT_CRATE_PLACE_POINTS[String(place)] ?? Math.max(0, legacyFlat)
}

type AnyDb = Prisma.TransactionClient

let bootstrapCheckedAt = 0
const BOOTSTRAP_TTL_MS = 60_000

/**
 * Idempotently ensure at least one ACTIVE crate exists (seed: 100 levels,
 * free + crate coin prizes with milestone bumps, N×20 thresholds, default
 * prices). Admins own everything afterwards through the console.
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
        description: 'The battle pass — win realms to climb 100 levels of free + crate prizes.',
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
          thresholdPoints: level * CRATE_THRESHOLD_STEP_DEFAULT,
          freePrizeType: 'COINS',
          freePrizeName: milestone ? 'Milestone Free Coins' : 'Free Coins',
          freePrizeEmoji: '🪙',
          freeQuantity: milestone ? 60 : 10,
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

// ─── Level math (thresholds) ────────────────────────────────────────────────

type LevelThresholdRow = { level: number; thresholdPoints: number }

/**
 * The highest level whose CUMULATIVE threshold the crate points already
 * cover (0 when below level 1's threshold). Levels are sorted ascending;
 * thresholds are treated as non-decreasing (admin edits are trusted).
 */
export function pointsLevelFor(cratePoints: number, levels: LevelThresholdRow[]): number {
  const points = Math.max(0, Math.floor(cratePoints) || 0)
  let reached = 0
  for (const lv of levels) {
    const t = Math.max(0, Math.floor(lv.thresholdPoints) || 0)
    if (points >= t) reached = Math.max(reached, lv.level)
    else break
  }
  return reached
}

// ─── Prize granting (idempotent per level, per track) ──────────────────────

type PrizeSpec = { prizeType: string; itemId: string | null; prizeName: string | null; prizeEmoji: string | null; quantity: number }

async function grantPrize(client: AnyDb, userId: string, prize: PrizeSpec, ledgerReason: string): Promise<void> {
  const qty = Math.max(1, Math.floor(prize.quantity) || 1)
  if (prize.prizeType === 'COINS') {
    await client.user
      .update({ where: { id: userId }, data: { coinBalance: { increment: qty } } })
      .catch(() => {})
    await client.coinLedger
      .create({
        data: {
          userId,
          delta: qty,
          reason: ledgerReason,
          meta: JSON.stringify({ prizeName: prize.prizeName ?? 'Crate prize' }),
        },
      })
      .catch(() => {})
    return
  }
  // GIFT — through the EXISTING inventory (UserItem upsert + increment).
  if (!prize.itemId) return
  const exists = await client.gameItem.findUnique({ where: { id: prize.itemId }, select: { id: true } }).catch(() => null)
  if (!exists) return
  await client.userItem
    .upsert({
      where: { userId_itemId: { userId, itemId: prize.itemId } },
      create: { userId, itemId: prize.itemId, quantity: qty },
      update: { quantity: { increment: qty } },
    })
    .catch(() => {})
}

type SyncUserCrate = {
  userId: string
  crateId: string
  unlockedAt: Date | null
  cratePoints: number
  boughtLevels: number
  currentLevel: number
}

type SyncCrate = { levelCount: number }

/**
 * Recompute the reached level and grant every missing prize for reached
 * levels:
 *   · FREE track  — always (locked or not)
 *   · CRATE track — only when the crate is unlocked (the "pop" on unlock
 *                   covers all previously reached levels)
 * `source` labels the trigger for the ledger; `opts.targetLevel` forces a
 * higher target (level buys). currentLevel NEVER regresses. Returns the
 * (possibly new) current level.
 */
async function syncCrateProgress(
  client: AnyDb,
  userCrate: SyncUserCrate,
  crate: SyncCrate,
  source: 'WON' | 'BOUGHT' | 'UNLOCK',
  opts?: { targetLevel?: number },
): Promise<number> {
  const levels = await client.crateLevel
    .findMany({
      where: { crateId: userCrate.crateId },
      select: { level: true, thresholdPoints: true, prizeType: true, itemId: true, prizeName: true, prizeEmoji: true, quantity: true, freePrizeType: true, freeItemId: true, freePrizeName: true, freePrizeEmoji: true, freeQuantity: true },
      orderBy: { level: 'asc' },
    })
    .catch(() => [] as Awaited<ReturnType<typeof client.crateLevel.findMany>>)

  const pointsLevel = pointsLevelFor(userCrate.cratePoints, levels)
  const target = Math.min(Math.max(crate.levelCount, 1), Math.max(pointsLevel, userCrate.currentLevel, opts?.targetLevel ?? 0))
  if (target <= 0) return userCrate.currentLevel

  // Existing grants (both tracks) — the unique key keeps each prize
  // exactly-once even when this runs concurrently.
  const grants = await client.crateLevelGrant
    .findMany({ where: { userId: userCrate.userId, crateId: userCrate.crateId }, select: { level: true, track: true } })
    .catch(() => [] as { level: number; track: string }[])
  const grantedFree = new Set(grants.filter((g) => g.track !== 'CRATE').map((g) => g.level))
  const grantedCrate = new Set(grants.filter((g) => g.track === 'CRATE').map((g) => g.level))

  for (const lv of levels) {
    if (lv.level > target) break
    if (!grantedFree.has(lv.level)) {
      const created = await client.crateLevelGrant
        .create({ data: { userId: userCrate.userId, crateId: userCrate.crateId, level: lv.level, track: 'FREE', source } })
        .then(() => true)
        .catch(() => false)
      if (created) {
        await grantPrize(client, userCrate.userId, { prizeType: lv.freePrizeType, itemId: lv.freeItemId, prizeName: lv.freePrizeName, prizeEmoji: lv.freePrizeEmoji, quantity: lv.freeQuantity }, 'crate_free_prize')
      }
    }
    if (userCrate.unlockedAt && !grantedCrate.has(lv.level)) {
      const created = await client.crateLevelGrant
        .create({ data: { userId: userCrate.userId, crateId: userCrate.crateId, level: lv.level, track: 'CRATE', source } })
        .then(() => true)
        .catch(() => false)
      if (created) {
        await grantPrize(client, userCrate.userId, { prizeType: lv.prizeType, itemId: lv.itemId, prizeName: lv.prizeName, prizeEmoji: lv.prizeEmoji, quantity: lv.quantity }, 'crate_prize')
      }
    }
  }

  if (target > userCrate.currentLevel) {
    await client.userCrate
      .update({
        where: { userId_crateId: { userId: userCrate.userId, crateId: userCrate.crateId } },
        data: { currentLevel: target },
      })
      .catch(() => {})
  }
  return Math.max(target, userCrate.currentLevel)
}

// ─── Realm-win hook (called from cycle settlement) ─────────────────────────

/**
 * Award crate points for a realm placement (every ranked 1st-8th player at
 * settlement). Points land on the user's crate; the FREE track's prizes pop
 * immediately, CRATE-track prizes pop when the pack is bought. Fire-and-forget
 * safe — settlement never breaks.
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
    await syncCrateProgress(db, { ...uc, cratePoints: uc.cratePoints }, target, 'WON')
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
  /** Cumulative crate points needed to reach this level. */
  thresholdPoints: number
  prizeType: string
  prizeName: string | null
  prizeEmoji: string | null
  quantity: number
  priceCoins: number
  reached: boolean
  freeCollected: boolean
  crateCollected: boolean
  freePrizeType: string
  freePrizeName: string | null
  freePrizeEmoji: string | null
  freeQuantity: number
}

export type CratePackRow = { levels: number; priceCoins: number; label: string; affordable: boolean }

export type CrateDetail = {
  crate: CrateCatalogRow & {
    /** Threshold of the NEXT level (null when the track is complete). */
    nextThreshold: number | null
    /** Crate points still needed for the next level (null when complete). */
    pointsToNext: number | null
  }
  levels: CrateLevelRow[]
  packs: CratePackRow[]
}

/** Best-effort lazy backfill: grant missing prizes for already-reached levels. */
async function backfillReachedTracks(userId: string, crateId: string): Promise<void> {
  const [uc, crate] = await Promise.all([
    db.userCrate.findUnique({ where: { userId_crateId: { userId, crateId } } }).catch(() => null),
    db.crate.findUnique({ where: { id: crateId }, select: { levelCount: true } }).catch(() => null),
  ])
  if (!uc || !crate) return
  await syncCrateProgress(db, uc, crate, 'WON').catch(() => {})
}

export async function getCrateDetail(userId: string, crateId: string): Promise<CrateDetail | null> {
  await ensureCrateBootstrap()
  const crate = await db.crate.findUnique({ where: { id: crateId } })
  if (!crate || !crate.isActive) return null

  const [levels, ucRead, balance, pointsTarget] = await Promise.all([
    db.crateLevel.findMany({ where: { crateId }, orderBy: { level: 'asc' } }),
    db.userCrate.findUnique({ where: { userId_crateId: { userId, crateId } } }).catch(() => null),
    db.user.findUnique({ where: { id: userId }, select: { coinBalance: true } }).catch(() => null),
    resolvePointsCrate(userId),
  ])
  let uc = ucRead

  // Heal any missing grants for already-reached levels (e.g. rows created
  // before the dual-track system) — idempotent, never throws outward. The
  // row is then RE-READ: the heal may have advanced currentLevel / created
  // grants that the payload below must reflect.
  if (uc && (uc.currentLevel > 0 || uc.cratePoints > 0)) {
    await backfillReachedTracks(userId, crateId)
    const fresh = await db.userCrate.findUnique({ where: { userId_crateId: { userId, crateId } } }).catch(() => null)
    if (fresh) uc = fresh
  }

  const unlocked = !!uc?.unlockedAt
  const currentLevel = Math.max(uc?.currentLevel ?? 0, 0)
  const cratePoints = uc?.cratePoints ?? 0

  const catalogRow: CrateCatalogRow & { nextThreshold: number | null; pointsToNext: number | null } = {
    id: crate.id,
    name: crate.name,
    description: crate.description,
    imageUrl: crate.imageUrl,
    priceCoins: crate.priceCoins,
    levelCount: crate.levelCount,
    unlocked,
    currentLevel,
    cratePoints,
    isPointsTarget: pointsTarget?.id === crate.id,
    nextThreshold: null,
    pointsToNext: null,
  }

  const grants = await db.crateLevelGrant
    .findMany({ where: { userId, crateId }, select: { level: true, track: true } })
    .catch(() => [] as { level: number; track: string }[])
  const grantedFree = new Set(grants.filter((g) => g.track !== 'CRATE').map((g) => g.level))
  const grantedCrate = new Set(grants.filter((g) => g.track === 'CRATE').map((g) => g.level))

  const balanceCoins = balance?.coinBalance ?? 0
  // Resolve GIFT prize display (name/emoji) from the live catalog — admin
  // rows may carry only the itemId.
  const giftIds = [
    ...levels.filter((lv) => lv.prizeType !== 'COINS' && lv.itemId).map((lv) => lv.itemId as string),
    ...levels.filter((lv) => lv.freePrizeType !== 'COINS' && lv.freeItemId).map((lv) => lv.freeItemId as string),
  ]
  const giftItems = giftIds.length
    ? await db.gameItem
        .findMany({ where: { id: { in: giftIds } }, select: { id: true, name: true, emoji: true, iconType: true, iconValue: true } })
        .catch(() => [] as Awaited<ReturnType<typeof db.gameItem.findMany>>)
    : []
  const itemById = new Map(giftItems.map((g) => [g.id, g] as const))

  const levelRows: CrateLevelRow[] = levels.map((lv) => {
    const gift = lv.prizeType !== 'COINS' && lv.itemId ? itemById.get(lv.itemId) : undefined
    const freeGift = lv.freePrizeType !== 'COINS' && lv.freeItemId ? itemById.get(lv.freeItemId) : undefined
    const reached = lv.level <= currentLevel
    return {
      level: lv.level,
      thresholdPoints: Math.max(0, lv.thresholdPoints),
      prizeType: lv.prizeType,
      prizeName: lv.prizeName ?? gift?.name ?? (lv.prizeType === 'COINS' ? 'Coin Drop' : 'Gift'),
      prizeEmoji: lv.prizeEmoji ?? gift?.emoji ?? (lv.prizeType === 'COINS' ? '🪙' : '🎁'),
      quantity: lv.quantity,
      priceCoins: lv.priceCoins,
      reached,
      freeCollected: reached || grantedFree.has(lv.level),
      crateCollected: reached && unlocked,
      freePrizeType: lv.freePrizeType,
      freePrizeName: lv.freePrizeName ?? freeGift?.name ?? (lv.freePrizeType === 'COINS' ? 'Free Coins' : 'Gift'),
      freePrizeEmoji: lv.freePrizeEmoji ?? freeGift?.emoji ?? (lv.freePrizeType === 'COINS' ? '🪙' : '🎁'),
      freeQuantity: lv.freeQuantity,
    }
  })

  // Next-level threshold + points remaining (drives the progress bar).
  const nextRow = levels.find((lv) => lv.level > currentLevel)
  if (nextRow) {
    catalogRow.nextThreshold = Math.max(0, nextRow.thresholdPoints)
    catalogRow.pointsToNext = Math.max(0, catalogRow.nextThreshold - cratePoints)
  }

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

async function grantedLevelsFor(client: AnyDb, userId: string, crateId: string, upTo: number): Promise<number[]> {
  const grants = await client.crateLevelGrant
    .findMany({ where: { userId, crateId, level: { lte: Math.max(0, upTo) } }, select: { level: true } })
    .catch(() => [] as { level: number }[])
  return [...new Set(grants.map((g) => g.level))].sort((a, b) => a - b)
}

/**
 * "Get Crate" — buy the pack, unlock the CRATE track with coins. Every
 * already-reached level's CRATE prize pops immediately (the FREE prizes were
 * already collected on the way up).
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
      // Sync with unlock state — CRATE prizes for every reached level pop.
      const newLevel = await syncCrateProgress(tx, { ...uc, unlockedAt: uc.unlockedAt ?? new Date() }, crate, 'UNLOCK')
      const fresh = await tx.user.findUnique({ where: { id: userId }, select: { coinBalance: true } })
      const granted = await grantedLevelsFor(tx, userId, crateId, newLevel)
      return { insufficient: false as const, balance: fresh?.coinBalance ?? 0, newLevel, granted }
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
      const targetLevel = Math.min(crate.levelCount, uc.currentLevel + levels.length)
      const newLevel = await syncCrateProgress(tx, uc, crate, 'BOUGHT', { targetLevel })
      const fresh = await tx.user.findUnique({ where: { id: userId }, select: { coinBalance: true } })
      const granted = await grantedLevelsFor(tx, userId, crateId, newLevel)
      return { insufficient: false as const, balance: fresh?.coinBalance ?? 0, newLevel, granted }
    })
    .catch(() => null)

  if (!result) return { ok: false, error: 'not_found' }
  if (result.insufficient) return { ok: false, error: 'insufficient_coins' }
  return { ok: true, coinBalance: result.balance, currentLevel: result.newLevel, unlocked: true, newLevels: result.granted }
}
