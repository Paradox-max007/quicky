// Quicky — MY COSMETICS WARDROBE (admin-console PRD §8.2/§9)
// GET /api/quicky/cosmetics → owned cosmetics + equip state (wardrobe UI)
// GET /api/quicky/cosmetics?catalog=1 → ALSO the full ACTIVE cosmetic
//     catalog (Reward rows of every cosmetic type) with the viewer's owned
//     levels per item — powers the Gifts & Cosmetics modal's Frames / Hats /
//     Name Icons browse tabs (chat bubbles are event-only and stay in the
//     wardrobe). Catalog entries carry their level assets (1/2 static, 3
//     animated) so the tabs render live previews.
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { getMyCosmetics } from '@/lib/quicky/rewards/cosmetics'
import { COSMETIC_TYPES, parseRewardMetadata } from '@/lib/quicky/rewards/catalog'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const cosmetics = await getMyCosmetics(me.id).catch(() => [])
  const wantCatalog = req.nextUrl.searchParams.get('catalog') === '1'
  if (!wantCatalog) return NextResponse.json({ cosmetics })

  const [rewards, owned] = await Promise.all([
    db.reward.findMany({
      where: { rewardType: { in: COSMETIC_TYPES as string[] }, status: 'ACTIVE' },
      select: { id: true, rewardType: true, name: true, description: true, rarity: true, metadata: true },
      orderBy: [{ rewardType: 'asc' }, { name: 'asc' }],
    }),
    db.userCosmetic.findMany({ where: { userId: me.id }, select: { rewardId: true, level: true, equipped: true } }),
  ])

  const ownedByReward = new Map<string, { level: number; equipped: boolean }[]>()
  for (const row of owned) {
    const list = ownedByReward.get(row.rewardId) ?? []
    list.push({ level: row.level, equipped: row.equipped })
    ownedByReward.set(row.rewardId, list)
  }

  const catalog = rewards.map((r) => {
    const meta = parseRewardMetadata(r.metadata)
    const mine = ownedByReward.get(r.id) ?? []
    return {
      id: r.id,
      rewardType: r.rewardType,
      name: r.name,
      description: r.description,
      rarity: r.rarity,
      levels: meta.levels ?? null,
      decorator: meta.decorator ?? null,
      ownedLevels: mine.map((m) => m.level),
      anyEquipped: mine.some((m) => m.equipped),
    }
  })

  return NextResponse.json({ cosmetics, catalog })
}
