// Quicky — COSMETICS SERVICE (admin-console PRD §8.2/§9)
//
// Owned profile cosmetics (hats / frames / name decorators / chat bubbles)
// with the "ONE equipped cosmetic per reward TYPE" rule. Rendering surfaces
// consume the compact equipped view: my profile + wardrobe, chat contacts
// rows, and the Game Chat bubbles (both participants).

import { db } from '@/lib/db'
import { COSMETIC_TYPES, parseRewardMetadata, type LevelAsset, type CosmeticAnimation } from './catalog'

export type CosmeticView = {
  id: string
  rewardId: string
  rewardType: string
  name: string
  rarity: string
  level: number
  equipped: boolean
  source: string
  levelAsset: LevelAsset | CosmeticAnimation | null
  decorator?: { left?: string; right?: string }
  bubble?: { color?: string; border?: string; textLight?: boolean; frameUrl?: string }
}

function serialize(row: { id: string; rewardId: string; level: number; equipped: boolean; source: string; reward: { rewardType: string; name: string; rarity: string; metadata: string | null } }): CosmeticView {
  const meta = parseRewardMetadata(row.reward.metadata)
  return {
    id: row.id,
    rewardId: row.rewardId,
    rewardType: row.reward.rewardType,
    name: row.reward.name,
    rarity: row.reward.rarity,
    level: row.level,
    equipped: row.equipped,
    source: row.source,
    levelAsset: meta.levels?.[row.level as 1 | 2 | 3] ?? null,
    decorator: meta.decorator,
    bubble: meta.bubble,
  }
}

const INCLUDE = {
  reward: { select: { rewardType: true, name: true, rarity: true, metadata: true } },
} as const

/** My full cosmetics inventory (wardrobe UI). */
export async function getMyCosmetics(userId: string): Promise<CosmeticView[]> {
  const rows = await db.userCosmetic.findMany({ where: { userId }, orderBy: { grantedAt: 'desc' }, include: INCLUDE })
  return rows.map(serialize)
}

/** Equipped cosmetics for a batch of users (chat contacts / peers). */
export async function getEquippedCosmetics(userIds: string[]): Promise<Map<string, CosmeticView[]>> {
  const ids = Array.from(new Set(userIds.filter(Boolean)))
  const out = new Map<string, CosmeticView[]>()
  if (ids.length === 0) return out
  const rows = await db.userCosmetic
    .findMany({ where: { userId: { in: ids }, equipped: true }, include: INCLUDE })
    .catch(() => [])
  for (const row of rows) {
    const list = out.get(row.userId) ?? []
    list.push(serialize(row))
    out.set(row.userId, list)
  }
  return out
}

/**
 * Equip / unequip one cosmetic. ONE equipped cosmetic per reward TYPE
 * (§8.2 user_equipped): equipping a hat unequips every other hat the user
 * owns. Toggling the currently equipped row OFF simply unequips.
 */
export async function equipCosmetic(userId: string, rewardId: string, level: number, equip: boolean): Promise<CosmeticView[]> {
  const row = await db.userCosmetic.findUnique({
    where: { userId_rewardId_level: { userId, rewardId, level } },
    include: INCLUDE,
  })
  if (!row) throw new Error('cosmetic_not_owned')
  if (!(COSMETIC_TYPES as string[]).includes(row.reward.rewardType)) throw new Error('not_a_cosmetic')

  await db.$transaction(async (tx) => {
    if (equip) {
      // Unequip every OTHER cosmetic of the same type first.
      const sameType = await tx.userCosmetic.findMany({
        where: { userId, equipped: true },
        select: { id: true, rewardId: true, level: true, reward: { select: { rewardType: true } } },
      })
      const others = sameType.filter((r) => r.reward.rewardType === row.reward.rewardType && r.rewardId !== rewardId)
      if (others.length > 0) {
        await tx.userCosmetic.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { equipped: false } })
      }
      await tx.userCosmetic.update({ where: { id: row.id }, data: { equipped: true } })
    } else {
      await tx.userCosmetic.updateMany({ where: { id: row.id, equipped: true }, data: { equipped: false } })
    }
  })

  return getMyCosmetics(userId)
}
