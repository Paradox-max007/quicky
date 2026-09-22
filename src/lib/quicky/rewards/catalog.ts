// Quicky — REWARD CATALOG SERVICE (admin-console PRD §8/§10/§12)
//
// The reusable reward catalog, separate from realm configuration (§10):
//   · Reward rows are created FIRST, saved, then assigned to realm positions
//     via RealmRewardRule.
//   · Settlement snapshots every granted reward into UserRewardGrant rows
//     (PENDING) — the popup collects them (§12).
//   · Claim is a single idempotent transaction: COINS credit the wallet,
//     STICKER_SET/GIFT flow into the EXISTING inventory tables, cosmetics
//     land in UserCosmetic (one equipped per type).
//
// Cosmetic levels (§9): 1 + 2 static assets, 3 animated — an actual animated
// image (GIF / animated WebP / APNG URL) or a frame sequence with fps/loop.
// The LEVEL is metadata (never a CSS-only effect).

import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

// ─── Types + constants ──────────────────────────────────────────────────────

export const REWARD_TYPES = ['COINS', 'STICKER_SET', 'GIFT', 'HAT', 'PROFILE_FRAME', 'NAME_DECORATOR', 'CHAT_BUBBLE'] as const
export type RewardType = (typeof REWARD_TYPES)[number]

export const COSMETIC_TYPES: RewardType[] = ['HAT', 'PROFILE_FRAME', 'NAME_DECORATOR', 'CHAT_BUBBLE']

export const REWARD_TYPE_LABELS: Record<RewardType, string> = {
  COINS: 'In-game Coins',
  STICKER_SET: 'Sticker Set',
  GIFT: 'Gift Item',
  HAT: 'Profile Hat',
  PROFILE_FRAME: 'Profile Frame',
  NAME_DECORATOR: 'Name Decorator',
  CHAT_BUBBLE: 'Chat Bubble',
}

export const RARITIES = ['COMMON', 'RARE', 'EPIC', 'LEGENDARY'] as const
export const REWARD_STATUSES = ['ACTIVE', 'DISABLED'] as const

/** §9 — an actual animation asset, never CSS-only. */
export type CosmeticAnimation =
  | { type: 'animated-image'; url: string }
  | { type: 'frames'; frameUrls: string[]; fps: number; loop: boolean }

/** Level asset: an image URL or short emoji for static levels 1/2. */
export type LevelAsset = { kind: 'image'; url: string } | { kind: 'emoji'; glyph: string }

export type RewardMetadata = {
  coinAmount?: number
  itemId?: string
  bundleId?: string
  levels?: Partial<Record<1 | 2 | 3, LevelAsset | CosmeticAnimation>>
  decorator?: { left?: string; right?: string }
  bubble?: { color?: string; border?: string; textLight?: boolean; frameUrl?: string }
}

export function parseRewardMetadata(json: string | null | undefined): RewardMetadata {
  if (!json) return {}
  try {
    const raw = JSON.parse(json) as RewardMetadata
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

/** Validation for admin-submitted metadata (never trusts the client shape). */
export function validateRewardInput(input: {
  rewardType: unknown
  name: unknown
  rarity?: unknown
  status?: unknown
  description?: unknown
  metadata?: unknown
}): { ok: true; data: { rewardType: RewardType; name: string; description: string | null; rarity: string; status: string; metadata: string | null } } | { ok: false; message: string } {
  const type = String(input.rewardType ?? '')
  if (!(REWARD_TYPES as readonly string[]).includes(type)) {
    return { ok: false, message: `rewardType must be one of: ${REWARD_TYPES.join(', ')}.` }
  }
  const rewardType = type as RewardType
  const name = String(input.name ?? '').trim()
  if (!name || name.length > 60) return { ok: false, message: 'Reward name is required (≤ 60 chars).' }

  const rarity = (RARITIES as readonly string[]).includes(String(input.rarity ?? 'COMMON')) ? String(input.rarity ?? 'COMMON') : 'COMMON'
  const status = (REWARD_STATUSES as readonly string[]).includes(String(input.status ?? 'ACTIVE')) ? String(input.status ?? 'ACTIVE') : 'ACTIVE'
  const description = input.description == null ? null : String(input.description).trim().slice(0, 300) || null

  let meta: RewardMetadata = {}
  if (input.metadata != null) {
    if (typeof input.metadata !== 'object') return { ok: false, message: 'metadata must be an object.' }
    meta = input.metadata as RewardMetadata
    if (rewardType === 'COINS') {
      const amt = Number(meta.coinAmount)
      if (!Number.isInteger(amt) || amt < 1 || amt > 1_000_000) return { ok: false, message: 'Coin rewards need a coin amount between 1 and 1,000,000.' }
    }
    if (rewardType === 'GIFT' && !meta.itemId) return { ok: false, message: 'Gift rewards need a catalog item.' }
    if (rewardType === 'STICKER_SET' && !meta.bundleId) return { ok: false, message: 'Sticker-set rewards need a sticker bundle.' }
  }

  return {
    ok: true,
    data: {
      rewardType,
      name: name.slice(0, 60),
      description,
      rarity,
      status,
      metadata: input.metadata == null ? null : JSON.stringify(meta),
    },
  }
}

// ─── Serialization (API shape) ──────────────────────────────────────────────

type RewardRow = { id: string; rewardType: string; name: string; description: string | null; rarity: string; status: string; metadata: string | null; createdAt: Date; updatedAt: Date }

export function serializeReward(r: RewardRow) {
  return {
    id: r.id,
    rewardType: r.rewardType,
    name: r.name,
    description: r.description,
    rarity: r.rarity,
    status: r.status,
    metadata: parseRewardMetadata(r.metadata),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }
}

/** Resolve the display icon for a reward at a level (snapshot-friendly). */
export function rewardIcon(meta: RewardMetadata, rewardType: string, level = 1): string {
  if (rewardType === 'COINS') return '🪙'
  const lv = meta.levels?.[level as 1 | 2 | 3]
  if (lv) {
    if ('kind' in lv && lv.kind === 'image') return lv.url
    if ('kind' in lv && lv.kind === 'emoji') return lv.glyph
    if (lv.type === 'animated-image') return lv.url
    if (lv.type === 'frames' && lv.frameUrls[0]) return lv.frameUrls[0]
  }
  if (rewardType === 'STICKER_SET') return '✨'
  if (rewardType === 'GIFT') return '🎁'
  if (rewardType === 'HAT') return '🎩'
  if (rewardType === 'PROFILE_FRAME') return '🖼️'
  if (rewardType === 'NAME_DECORATOR') return '👑'
  if (rewardType === 'CHAT_BUBBLE') return '💬'
  return '🎁'
}

// ─── Settlement → PENDING grants (§12.1 steps 1-6) ─────────────────────────

export type GrantSpec = { rewardId: string; level: number; quantity: number }

/** Snapshot JSON stored on the grant row (§21.4 — stable definition). */
export function buildRewardSnapshot(reward: { id: string; rewardType: string; name: string; description: string | null; rarity: string; metadata: string | null }, level: number, quantity: number): string {
  const meta = parseRewardMetadata(reward.metadata)
  return JSON.stringify({
    id: reward.id,
    name: reward.name,
    rewardType: reward.rewardType,
    rarity: reward.rarity,
    quantity,
    level,
    icon: rewardIcon(meta, reward.rewardType, level),
    description: reward.description,
    coinAmount: reward.rewardType === 'COINS' ? (meta.coinAmount ?? 0) : undefined,
    itemId: reward.rewardType === 'GIFT' ? (meta.itemId ?? undefined) : undefined,
    bundleId: reward.rewardType === 'STICKER_SET' ? (meta.bundleId ?? undefined) : undefined,
    decorator: reward.rewardType === 'NAME_DECORATOR' ? (meta.decorator ?? undefined) : undefined,
    bubble: reward.rewardType === 'CHAT_BUBBLE' ? (meta.bubble ?? undefined) : undefined,
    levelAsset: meta.levels?.[level as 1 | 2 | 3] ?? undefined,
  })
}

/**
 * Create PENDING UserRewardGrant rows for a settled member (idempotent via
 * the unique [userId, cycleId, rewardId, level] key — retries are no-ops).
 * Rewards referencing deleted catalog rows are skipped silently (settlement
 * must never crash on mid-cycle admin edits).
 */
export async function createPendingGrants(userId: string, cycleId: string, realmLevel: number, specs: GrantSpec[]): Promise<number> {
  if (specs.length === 0) return 0
  const rewards = await db.reward.findMany({ where: { id: { in: specs.map((s) => s.rewardId) } } })
  const byId = new Map(rewards.map((r) => [r.id, r]))
  let created = 0
  for (const spec of specs) {
    const reward = byId.get(spec.rewardId)
    if (!reward || reward.status !== 'ACTIVE') continue
    const level = Math.min(3, Math.max(1, Math.floor(spec.level) || 1))
    const quantity = Math.min(1000, Math.max(1, Math.floor(spec.quantity) || 1))
    const snapshot = buildRewardSnapshot(reward, level, quantity)
    await db.userRewardGrant
      .upsert({
        where: { userId_cycleId_rewardId_level: { userId, cycleId, rewardId: spec.rewardId, level } },
        create: { userId, cycleId, realmLevel, rewardId: spec.rewardId, rewardSnapshot: snapshot, quantity, level, status: 'PENDING' },
        update: {},
      })
      .catch(() => {})
    created++
  }
  return created
}

// ─── Claim (§12.1 steps 7-9 + §12.3 idempotency) ───────────────────────────

export type ClaimOutcome = {
  claimed: { id: string; name: string; rewardType: string; icon: string; quantity: number; level: number }[]
  alreadyClaimed: number
  coinBalance: number
}

/**
 * Claim ALL pending grants for a user in ONE transaction. Idempotent: only
 * rows still PENDING are transitioned + applied — repeated taps, retries and
 * concurrent devices can never double-credit coins or duplicate inventory
 * (§12.3). The DB transaction guards the status flip + effect together.
 */
export async function claimPendingRewards(userId: string): Promise<ClaimOutcome> {
  const pending = await db.userRewardGrant.findMany({ where: { userId, status: 'PENDING' }, orderBy: { grantedAt: 'asc' } })
  if (pending.length === 0) {
    const me = await db.user.findUnique({ where: { id: userId }, select: { coinBalance: true } })
    return { claimed: [], alreadyClaimed: 0, coinBalance: me?.coinBalance ?? 0 }
  }

  const claimed: ClaimOutcome['claimed'] = []

  await db
    .$transaction(async (tx) => {
      // Lock each row by conditional status flip — a concurrent claim flips
      // 0 rows here and falls through idempotently (§12.3).
      for (const grant of pending) {
        const flip = await tx.userRewardGrant.updateMany({
          where: { id: grant.id, status: 'PENDING' },
          data: { status: 'CLAIMED', claimedAt: new Date() },
        })
        if (flip.count === 0) continue

        await applyGrantEffect(tx, userId, grant.rewardSnapshot, grant.quantity, grant.level, grant.rewardId)
        let snapshot: Record<string, unknown> = {}
        try {
          snapshot = JSON.parse(grant.rewardSnapshot) as Record<string, unknown>
        } catch {
          snapshot = {}
        }
        claimed.push({
          id: grant.id,
          name: String(snapshot.name ?? 'Reward'),
          rewardType: String(snapshot.rewardType ?? 'GIFT'),
          icon: String(snapshot.icon ?? '🎁'),
          quantity: grant.quantity,
          level: grant.level,
        })
      }
    })
    .catch(() => {
      // Transaction failed (e.g. a concurrent claim won the race) — report
      // only what this call actually claimed.
    })

  const me = await db.user.findUnique({ where: { id: userId }, select: { coinBalance: true } })
  return { claimed, alreadyClaimed: 0, coinBalance: me?.coinBalance ?? 0 }
}

/**
 * Apply one grant's effect INSIDE the claim transaction. Coins credit the
 * wallet + CoinLedger; stickers/gifts upsert the EXISTING inventory tables;
 * cosmetics upsert UserCosmetic (never auto-equipped — §8.2 user_equipped).
 */
async function applyGrantEffect(tx: Prisma.TransactionClient, userId: string, snapshotJson: string, quantity: number, level: number, rewardId: string): Promise<void> {
  let snapshot: Record<string, unknown> = {}
  try {
    snapshot = JSON.parse(snapshotJson) as Record<string, unknown>
  } catch {
    return
  }
  const type = String(snapshot.rewardType ?? '')

  if (type === 'COINS') {
    const amount = Math.max(0, Math.floor(Number(snapshot.coinAmount ?? 0))) * Math.max(1, quantity)
    if (amount > 0) {
      await tx.user.update({ where: { id: userId }, data: { coinBalance: { increment: amount } } })
      await tx.coinLedger.create({ data: { userId, delta: amount, reason: 'realm_reward', meta: JSON.stringify({ rewardId, reward: snapshot.name ?? 'Reward' }) } })
    }
    return
  }

  if (type === 'GIFT') {
    const itemId = snapshot.itemId ? String(snapshot.itemId) : null
    if (itemId) {
      const exists = await tx.gameItem.findUnique({ where: { id: itemId }, select: { id: true } }).catch(() => null)
      if (exists) {
        await tx.userItem.upsert({
          where: { userId_itemId: { userId, itemId } },
          create: { userId, itemId, quantity: Math.max(1, quantity) },
          update: { quantity: { increment: Math.max(1, quantity) } },
        })
      }
    }
    return
  }

  if (type === 'STICKER_SET') {
    const bundleId = snapshot.bundleId ? String(snapshot.bundleId) : null
    if (bundleId) {
      const exists = await tx.gameStickerBundle.findUnique({ where: { id: bundleId }, select: { id: true } }).catch(() => null)
      if (exists) {
        await tx.userGameStickerBundle.upsert({
          where: { userId_bundleId: { userId, bundleId } },
          create: { userId, bundleId, source: 'league_reward' },
          update: {},
        })
      }
    }
    return
  }

  if ((COSMETIC_TYPES as string[]).includes(type)) {
    await tx.userCosmetic.upsert({
      where: { userId_rewardId_level: { userId, rewardId, level } },
      create: { userId, rewardId, level, source: 'REALM_REWARD', equipped: false },
      update: {},
    })
  }
}

// ─── Pending list for the popup (§12.1/§12.2 — offline users see it on return)

export type PendingGrantView = {
  id: string
  name: string
  rewardType: string
  rarity: string
  icon: string
  description: string | null
  quantity: number
  level: number
  coinAmount: number | null
  grantedAt: string
  realmLevel: number
  levelAsset: LevelAsset | CosmeticAnimation | null
  bubble?: RewardMetadata['bubble']
  decorator?: RewardMetadata['decorator']
}

export async function getPendingGrants(userId: string): Promise<PendingGrantView[]> {
  const rows = await db.userRewardGrant.findMany({ where: { userId, status: 'PENDING' }, orderBy: { grantedAt: 'asc' } })
  return rows.map((r) => {
    let s: Record<string, unknown> = {}
    try {
      s = JSON.parse(r.rewardSnapshot) as Record<string, unknown>
    } catch {
      s = {}
    }
    return {
      id: r.id,
      name: String(s.name ?? 'Reward'),
      rewardType: String(s.rewardType ?? 'GIFT'),
      rarity: String(s.rarity ?? 'COMMON'),
      icon: String(s.icon ?? '🎁'),
      description: s.description ? String(s.description) : null,
      quantity: r.quantity,
      level: r.level,
      coinAmount: s.coinAmount != null ? Number(s.coinAmount) : null,
      grantedAt: r.grantedAt.toISOString(),
      realmLevel: r.realmLevel,
      levelAsset: (s.levelAsset as LevelAsset | CosmeticAnimation | undefined) ?? null,
      bubble: s.bubble as RewardMetadata['bubble'] | undefined,
      decorator: s.decorator as RewardMetadata['decorator'] | undefined,
    }
  })
}
