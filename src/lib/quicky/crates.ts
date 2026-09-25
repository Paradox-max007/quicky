// Quicky — CRATES SERVICE (crate-tracks PRD — the battle-pass "crate room")
//
// A crate is a 100-level BATTLE-PASS prize track opened from the 👑 room chip.
// Every level carries TWO aligned prizes:
//   · FREE track  — claimable by WINNING REALMS alone (crate points climb
//                   the levels; no purchase needed)
//   · CRATE track — claimable only once the crate pack is bought ("Get
//                   Crate"); realm wins then reach BOTH tracks' prizes
//
// The pass ALWAYS STARTS AT LEVEL 1 the moment a user logs in: level 1's
// threshold is treated as 0 no matter what is stored, so the first FREE
// prize is immediately claimable (the user taps it → claim modal → the
// prize lands in their account). Every further level unlocks when the
// cumulative crate points cover its admin-set thresholdPoints.
//
// Level advance: CRATE POINTS earned per realm PLACEMENT (1st-8th, each
// realm's per-place amounts admin-configured — see DEFAULT_CRATE_PLACE_POINTS)
// measured against each level's admin-set cumulative thresholdPoints, or
// buying levels/packs with coins (per-level admin price).
//
// currentLevel is the MONOTONIC reached-level marker: the highest level whose
// effective threshold ≤ cratePoints (buys advance the marker directly).
// Prizes are NEVER auto-granted anymore — the user CLAIMS each reached
// level's prize through claimCratePrize (idempotent per level+track via the
// CrateLevelGrant unique key userId+crateId+level+track).
//
// Which crate receives realm-win points: the user's unlocked pass if any
// (first by sortOrder), else the FIRST active crate (the featured one).

import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'

export const CRATE_LEVELS_DEFAULT = 100
export const CRATE_UNLOCK_PRICE_DEFAULT = 500
export const CRATE_LEVEL_PRICE_DEFAULT = 100
export const CRATE_MILESTONES = [10, 25, 50, 100] as const
/** Default CUMULATIVE threshold: level N needs (N−1) × this many crate
 *  points (level 1 = 0 — the pass starts unlocked at level 1). */
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
          thresholdPoints: (level - 1) * CRATE_THRESHOLD_STEP_DEFAULT,
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
 * cover. The pass ALWAYS starts at LEVEL 1: level 1's threshold is treated
 * as 0 no matter what is stored (the first free prize unlocks at login —
 * every user logs in at level 1). Levels are sorted ascending; thresholds
 * are treated as non-decreasing (admin edits are trusted).
 */
export function pointsLevelFor(cratePoints: number, levels: LevelThresholdRow[]): number {
  const points = Math.max(0, Math.floor(cratePoints) || 0)
  let reached = 0
  for (const lv of levels) {
    const t = lv.level === 1 ? 0 : Math.max(0, Math.floor(lv.thresholdPoints) || 0)
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
 * Recompute the reached-level marker and persist it (monotonic — NEVER
 * regresses). Prizes are NOT granted here: reached prizes wait on the track
 * until the user taps them (claimCratePrize). `opts.targetLevel` forces a
 * higher target (level buys). Returns the (possibly new) current level.
 */
async function advanceLevelMarker(
  client: AnyDb,
  userCrate: SyncUserCrate,
  crate: SyncCrate,
  opts?: { targetLevel?: number },
): Promise<number> {
  const levels = await client.crateLevel
    .findMany({
      where: { crateId: userCrate.crateId },
      select: { level: true, thresholdPoints: true },
      orderBy: { level: 'asc' },
    })
    .catch(() => [] as { level: number; thresholdPoints: number }[])

  const pointsLevel = pointsLevelFor(userCrate.cratePoints, levels)
  const target = Math.min(Math.max(crate.levelCount, 1), Math.max(pointsLevel, userCrate.currentLevel, opts?.targetLevel ?? 0))
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
 * settlement). Points land on the user's crate; reached levels' prizes wait
 * on the track until the user CLAIMS them (FREE immediately, CRATE once the
 * pack is bought). Fire-and-forget safe — settlement never breaks.
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
    await advanceLevelMarker(db, { ...uc, cratePoints: uc.cratePoints }, target)
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
  const [mine, levelRows, pointsTarget] = await Promise.all([
    db.userCrate
      .findMany({ where: { userId, crateId: { in: crates.map((c) => c.id) } } })
      .catch(() => [] as Awaited<ReturnType<typeof db.userCrate.findMany>>),
    db.crateLevel
      .findMany({
        where: { crateId: { in: crates.map((c) => c.id) } },
        select: { crateId: true, level: true, thresholdPoints: true },
        orderBy: { level: 'asc' },
      })
      .catch(() => [] as { crateId: string; level: number; thresholdPoints: number }[]),
    resolvePointsCrate(userId),
  ])
  const byCrate = new Map(mine.map((m) => [m.crateId, m] as const))
  const levelsByCrate = new Map<string, { level: number; thresholdPoints: number }[]>()
  for (const row of levelRows) {
    const arr = levelsByCrate.get(row.crateId) ?? []
    arr.push(row)
    levelsByCrate.set(row.crateId, arr)
  }

  return crates.map((c) => {
    const uc = byCrate.get(c.id)
    // Read-side truth: the marker NEVER regresses but points may push the
    // reached level past it (level 1 counts from 0 points — login state).
    const pointsLevel = pointsLevelFor(uc?.cratePoints ?? 0, levelsByCrate.get(c.id) ?? [])
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      imageUrl: c.imageUrl,
      priceCoins: c.priceCoins,
      levelCount: c.levelCount,
      unlocked: !!uc?.unlockedAt,
      currentLevel: Math.max(uc?.currentLevel ?? 0, pointsLevel),
      cratePoints: uc?.cratePoints ?? 0,
      isPointsTarget: pointsTarget?.id === c.id,
    }
  })
}

export type CrateLevelRow = {
  level: number
  /** Cumulative crate points needed to reach this level (level 1 = 0). */
  thresholdPoints: number
  prizeType: string
  prizeName: string | null
  prizeEmoji: string | null
  quantity: number
  priceCoins: number
  reached: boolean
  /** True once the user CLAIMED this track's prize (CrateLevelGrant). */
  freeCollected: boolean
  crateCollected: boolean
  /** Reached (and, for CRATE, unlocked) but NOT yet claimed → tappable. */
  freeClaimable: boolean
  crateClaimable: boolean
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

export async function getCrateDetail(userId: string, crateId: string): Promise<CrateDetail | null> {
  await ensureCrateBootstrap()
  const crate = await db.crate.findUnique({ where: { id: crateId } })
  if (!crate || !crate.isActive) return null

  const [levels, uc, balance, pointsTarget] = await Promise.all([
    db.crateLevel.findMany({ where: { crateId }, orderBy: { level: 'asc' } }),
    db.userCrate.findUnique({ where: { userId_crateId: { userId, crateId } } }).catch(() => null),
    db.user.findUnique({ where: { id: userId }, select: { coinBalance: true } }).catch(() => null),
    resolvePointsCrate(userId),
  ])

  const unlocked = !!uc?.unlockedAt
  const cratePoints = uc?.cratePoints ?? 0
  // Read-side truth: the reached level is the max of the persisted marker
  // (buys) and the points-derived level (level 1 is ALWAYS reached — its
  // threshold counts as 0, so the first free prize is claimable at login).
  const reachedLevel = Math.min(crate.levelCount, Math.max(uc?.currentLevel ?? 0, pointsLevelFor(cratePoints, levels)))
  // Keep the persisted marker honest (monotonic; never blocks the payload).
  if (uc && reachedLevel > uc.currentLevel) {
    await db.userCrate
      .update({ where: { userId_crateId: { userId, crateId } }, data: { currentLevel: reachedLevel } })
      .catch(() => {})
  }
  const currentLevel = reachedLevel

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
    const freeCollected = grantedFree.has(lv.level)
    const crateCollected = grantedCrate.has(lv.level)
    return {
      level: lv.level,
      thresholdPoints: lv.level === 1 ? 0 : Math.max(0, lv.thresholdPoints),
      prizeType: lv.prizeType,
      prizeName: lv.prizeName ?? gift?.name ?? (lv.prizeType === 'COINS' ? 'Coin Drop' : 'Gift'),
      prizeEmoji: lv.prizeEmoji ?? gift?.emoji ?? (lv.prizeType === 'COINS' ? '🪙' : '🎁'),
      quantity: lv.quantity,
      priceCoins: lv.priceCoins,
      reached,
      freeCollected,
      crateCollected,
      freeClaimable: reached && !freeCollected,
      crateClaimable: reached && unlocked && !crateCollected,
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

/**
 * "Get Crate" — buy the pack, unlock the CRATE track with coins. Every
 * already-reached level's CRATE prize becomes CLAIMABLE on the track (the
 * user taps them — claim modal — at their own pace).
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
      // No auto-grant: unlocking makes the reached CRATE prizes CLAIMABLE.
      const fresh = await tx.user.findUnique({ where: { id: userId }, select: { coinBalance: true } })
      return { insufficient: false as const, balance: fresh?.coinBalance ?? 0, newLevel: uc.currentLevel, granted: [] as number[] }
    })
    .catch(() => null)

  if (!result) return { ok: false, error: 'not_found' }
  if (result.insufficient) return { ok: false, error: 'insufficient_coins' }
  return { ok: true, coinBalance: result.balance, currentLevel: result.newLevel, unlocked: true, newLevels: result.granted }
}

/**
 * Buy N levels with coins (only once the crate is unlocked). Price = the sum
 * of the next N locked levels' configured prices. Bought levels advance the
 * reached-level marker — their prizes wait to be CLAIMED like every other.
 */
export async function buyCrateLevels(userId: string, crateId: string, count: number): Promise<PurchaseResult> {
  await ensureCrateBootstrap()
  const crate = await db.crate.findUnique({ where: { id: crateId } })
  if (!crate || !crate.isActive) return { ok: false, error: 'not_found' }

  const existing = await db.userCrate.findUnique({ where: { userId_crateId: { userId, crateId } } })
  if (!existing?.unlockedAt) return { ok: false, error: 'crate_locked' }

  const n = Math.floor(count)
  if (n < 1) return { ok: false, error: 'no_levels_left' }

  // Read-side reached level (points may sit above the persisted marker).
  const thresholdRows = await db.crateLevel
    .findMany({ where: { crateId }, select: { level: true, thresholdPoints: true }, orderBy: { level: 'asc' } })
    .catch(() => [] as { level: number; thresholdPoints: number }[])
  const reachedLevel = Math.max(existing.currentLevel, pointsLevelFor(existing.cratePoints, thresholdRows))

  const levels = await db.crateLevel.findMany({
    where: { crateId, level: { gt: reachedLevel, lte: reachedLevel + n } },
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
        data: { boughtLevels: { increment: levels.length }, currentLevel: Math.min(crate.levelCount, reachedLevel + levels.length) },
      })
      const fresh = await tx.user.findUnique({ where: { id: userId }, select: { coinBalance: true } })
      return { insufficient: false as const, balance: fresh?.coinBalance ?? 0, newLevel: uc.currentLevel, granted: levels.map((lv) => lv.level) }
    })
    .catch(() => null)

  if (!result) return { ok: false, error: 'not_found' }
  if (result.insufficient) return { ok: false, error: 'insufficient_coins' }
  return { ok: true, coinBalance: result.balance, currentLevel: result.newLevel, unlocked: true, newLevels: result.granted }
}

// ─── Prize claiming (the tap → modal → CLAIM flow) ────────────────────────

export type ClaimPrizeResult =
  | {
      ok: true
      track: 'FREE' | 'CRATE'
      level: number
      prize: { type: string; name: string; emoji: string; quantity: number }
      coinBalance: number | null
    }
  | { ok: false; error: 'not_found' | 'invalid_level' | 'level_locked' | 'crate_locked' | 'already_claimed' | 'no_prize' }

/**
 * CLAIM one level's prize (the user taps an unlocked tile → the claim modal
 * → this). Validates: the level is reached (level 1 is ALWAYS reached —
 * claimable from the moment a user logs in), the CRATE track needs the pack
 * bought, and the prize is unclaimed — then grants the prize (COINS →
 * balance + ledger, GIFT → inventory) exactly once (CrateLevelGrant unique
 * key userId+crateId+level+track; races lose cleanly with
 * 'already_claimed').
 */
export async function claimCratePrize(
  userId: string,
  crateId: string,
  level: number,
  track: 'FREE' | 'CRATE',
): Promise<ClaimPrizeResult> {
  await ensureCrateBootstrap()
  if (!Number.isInteger(level) || level < 1 || level > 10_000) return { ok: false, error: 'invalid_level' }
  if (track !== 'FREE' && track !== 'CRATE') return { ok: false, error: 'invalid_level' }

  const [crate, lv] = await Promise.all([
    db.crate.findUnique({ where: { id: crateId } }),
    db.crateLevel.findUnique({ where: { crateId_level: { crateId, level } } }),
  ])
  if (!crate || !crate.isActive || !lv) return { ok: false, error: 'not_found' }

  const uc = await db.userCrate.findUnique({ where: { userId_crateId: { userId, crateId } } })
  const unlocked = !!uc?.unlockedAt
  if (track === 'CRATE' && !unlocked) return { ok: false, error: 'crate_locked' }

  const thresholdRows = await db.crateLevel
    .findMany({ where: { crateId }, select: { level: true, thresholdPoints: true }, orderBy: { level: 'asc' } })
    .catch(() => [] as { level: number; thresholdPoints: number }[])
  const reachedLevel = Math.max(uc?.currentLevel ?? 0, pointsLevelFor(uc?.cratePoints ?? 0, thresholdRows))
  if (level > reachedLevel) return { ok: false, error: 'level_locked' }

  const existing = await db.crateLevelGrant
    .findUnique({ where: { userId_crateId_level_track: { userId, crateId, level, track } } })
    .catch(() => null)
  if (existing) return { ok: false, error: 'already_claimed' }

  const prize: PrizeSpec =
    track === 'FREE'
      ? { prizeType: lv.freePrizeType, itemId: lv.freeItemId, prizeName: lv.freePrizeName, prizeEmoji: lv.freePrizeEmoji, quantity: lv.freeQuantity }
      : { prizeType: lv.prizeType, itemId: lv.itemId, prizeName: lv.prizeName, prizeEmoji: lv.prizeEmoji, quantity: lv.quantity }
  if (prize.prizeType !== 'COINS' && !prize.itemId) return { ok: false, error: 'no_prize' }

  // Resolve the display name/emoji for the modal (GIFTs pull the live item).
  let name = prize.prizeName ?? (prize.prizeType === 'COINS' ? (track === 'FREE' ? 'Free Coins' : 'Coin Drop') : null)
  let emoji = prize.prizeEmoji ?? (prize.prizeType === 'COINS' ? '🪙' : null)
  if (prize.prizeType !== 'COINS' && prize.itemId) {
    const item = await db.gameItem.findUnique({ where: { id: prize.itemId }, select: { name: true, emoji: true } })
    if (!item) return { ok: false, error: 'no_prize' }
    name = prize.prizeName ?? item.name
    emoji = prize.prizeEmoji ?? item.emoji
  }
  if (!name) name = 'Prize'
  if (!emoji) emoji = '🎁'

  const won = await db
    .$transaction(async (tx) => {
      // Exactly-once: the unique key wins the race — losers read 'already_claimed'.
      const created = await tx.crateLevelGrant
        .create({ data: { userId, crateId, level, track, source: 'CLAIM' } })
        .then(() => true)
        .catch(() => false)
      if (!created) return false
      await grantPrize(tx, userId, prize, track === 'FREE' ? 'crate_free_prize' : 'crate_prize')
      return true
    })
    .catch(() => false)
  if (!won) return { ok: false, error: 'already_claimed' }

  const coinBalance =
    prize.prizeType === 'COINS'
      ? ((await db.user.findUnique({ where: { id: userId }, select: { coinBalance: true } }).catch(() => null))?.coinBalance ?? null)
      : null
  return {
    ok: true,
    track,
    level,
    prize: { type: prize.prizeType, name, emoji, quantity: Math.max(1, Math.floor(prize.quantity) || 1) },
    coinBalance,
  }
}
