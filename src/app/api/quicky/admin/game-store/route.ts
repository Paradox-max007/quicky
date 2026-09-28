// Quicky — ADMIN GAME STORE CONSOLE (Game Economy PRD §63-§66, §59)
// GET    /api/quicky/admin/game-store            → packages + crates + boost configs + monetization stats
// POST   /api/quicky/admin/game-store            → create { kind: 'package' | 'crate' | 'boost', data }
// PATCH  /api/quicky/admin/game-store            → update { kind, id?, data } (boost uses realmLevel as the key)
// DELETE /api/quicky/admin/game-store?kind=..&id=.. → remove a package / crate product
//
// Admin controls (PRD §63): coin packages (coins/bonus/price/badge/featured/
// order/active), crate products (price + disclosed contents), the final-hours
// boost (enabled / hours / multiplier, default + per-realm overrides §65)
// and reads the monetization dashboard aggregates (§59).
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, logAdminAction } from '@/lib/quicky/admin'
import { getMonetizationStats, ensureGameStoreBootstrap } from '@/lib/quicky/game-store'
import { upsertBoostConfig, invalidateBoostConfigCache } from '@/lib/quicky/realm/realm-boost'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest) {
  const guard = await requireAdmin()
  if (guard.error) return guard.error
  await ensureGameStoreBootstrap()

  const [packages, crates, boosts, stats, gifts, cosmetics] = await Promise.all([
    db.gameCoinPackage.findMany({ orderBy: { sortOrder: 'asc' } }).catch(() => []),
    db.crateProduct.findMany({ orderBy: { sortOrder: 'asc' } }).catch(() => []),
    db.realmBoostConfig.findMany({ orderBy: { realmLevel: 'asc' } }).catch(() => []),
    getMonetizationStats().catch(() => null),
    db.gameItem.findMany({ where: { category: 'gift', isActive: true }, select: { id: true, name: true, emoji: true, coinPrice: true }, orderBy: { coinPrice: 'asc' } }).catch(() => []),
    db.reward.findMany({ where: { rewardType: { in: ['HAT', 'PROFILE_FRAME', 'NAME_DECORATOR', 'CHAT_BUBBLE'] }, status: 'ACTIVE' }, select: { id: true, name: true, rewardType: true }, orderBy: { name: 'asc' } }).catch(() => []),
  ])

  return NextResponse.json({
    packages,
    crates,
    boosts,
    stats,
    giftOptions: gifts,
    cosmeticOptions: cosmetics,
  })
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin()
  if (guard.error) return guard.error
  const body = await req.json().catch(() => null)
  const kind = String(body?.kind ?? '')
  const data = (body?.data ?? {}) as Record<string, unknown>

  try {
    if (kind === 'package') {
      const row = await db.gameCoinPackage.create({
        data: {
          name: String(data.name ?? 'New Pack').slice(0, 60),
          coins: Math.max(1, Math.floor(num(data.coins, 100))),
          bonusCoins: Math.max(0, Math.floor(num(data.bonusCoins))),
          price: Math.max(0, num(data.price, 0.99)),
          currency: String(data.currency ?? 'USD').slice(0, 8).toUpperCase(),
          badge: data.badge ? String(data.badge).slice(0, 24) : null,
          featured: !!data.featured,
          premiumOnly: !!data.premiumOnly,
          sortOrder: Math.floor(num(data.sortOrder, 99)),
          isActive: data.isActive === undefined ? true : !!data.isActive,
        },
      })
      await logAdminAction(guard.me.id, 'game_store.package.create', 'GameCoinPackage', row.id, { name: row.name })
      return NextResponse.json({ ok: true, row })
    }

    if (kind === 'crate') {
      const row = await db.crateProduct.create({
        data: {
          name: String(data.name ?? 'New Crate').slice(0, 60),
          description: data.description ? String(data.description).slice(0, 300) : null,
          crateType: ['STARTER', 'PREMIUM', 'ELITE', 'REALM'].includes(String(data.crateType)) ? String(data.crateType) : 'PREMIUM',
          price: Math.max(0, num(data.price, 4.99)),
          currency: String(data.currency ?? 'USD').slice(0, 8).toUpperCase(),
          emoji: String(data.emoji ?? '💎').slice(0, 8),
          realmPoints: Math.max(0, Math.floor(num(data.realmPoints))),
          coins: Math.max(0, Math.floor(num(data.coins))),
          giftItemId: data.giftItemId ? String(data.giftItemId) : null,
          giftQuantity: Math.max(1, Math.floor(num(data.giftQuantity, 1))),
          cosmeticRewardId: data.cosmeticRewardId ? String(data.cosmeticRewardId) : null,
          bonusLabel: data.bonusLabel ? String(data.bonusLabel).slice(0, 60) : null,
          featured: !!data.featured,
          sortOrder: Math.floor(num(data.sortOrder, 99)),
          isActive: data.isActive === undefined ? true : !!data.isActive,
        },
      })
      await logAdminAction(guard.me.id, 'game_store.crate.create', 'CrateProduct', row.id, { name: row.name })
      return NextResponse.json({ ok: true, row })
    }

    if (kind === 'boost') {
      const realmLevel = data.realmLevel === null || data.realmLevel === undefined || data.realmLevel === '' ? null : Math.max(1, Math.min(15, Math.floor(num(data.realmLevel, 1))))
      const row = await upsertBoostConfig({
        realmLevel,
        hoursBeforeEnd: num(data.hoursBeforeEnd, 4),
        multiplier: Math.floor(num(data.multiplier, 2)),
        enabled: data.enabled === undefined ? true : !!data.enabled,
      })
      await logAdminAction(guard.me.id, 'game_store.boost.upsert', 'RealmBoostConfig', row.id, { realmLevel: row.realmLevel, multiplier: row.multiplier, hoursBeforeEnd: row.hoursBeforeEnd, enabled: row.enabled })
      return NextResponse.json({ ok: true, row })
    }

    return NextResponse.json({ error: 'unknown_kind' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: 'failed', detail: (e as Error).message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin()
  if (guard.error) return guard.error
  const body = await req.json().catch(() => null)
  const kind = String(body?.kind ?? '')
  const id = body?.id ? String(body.id) : null
  const data = (body?.data ?? {}) as Record<string, unknown>

  try {
    if (kind === 'package' && id) {
      const patch: Record<string, unknown> = {}
      if (data.name != null) patch.name = String(data.name).slice(0, 60)
      if (data.coins != null) patch.coins = Math.max(1, Math.floor(num(data.coins, 1)))
      if (data.bonusCoins != null) patch.bonusCoins = Math.max(0, Math.floor(num(data.bonusCoins)))
      if (data.price != null) patch.price = Math.max(0, num(data.price))
      if (data.currency != null) patch.currency = String(data.currency).slice(0, 8).toUpperCase()
      if (data.badge !== undefined) patch.badge = data.badge ? String(data.badge).slice(0, 24) : null
      if (data.featured !== undefined) patch.featured = !!data.featured
      if (data.premiumOnly !== undefined) patch.premiumOnly = !!data.premiumOnly
      if (data.sortOrder != null) patch.sortOrder = Math.floor(num(data.sortOrder, 99))
      if (data.isActive !== undefined) patch.isActive = !!data.isActive
      const row = await db.gameCoinPackage.update({ where: { id }, data: patch })
      await logAdminAction(guard.me.id, 'game_store.package.update', 'GameCoinPackage', id, patch)
      return NextResponse.json({ ok: true, row })
    }

    if (kind === 'crate' && id) {
      const patch: Record<string, unknown> = {}
      if (data.name != null) patch.name = String(data.name).slice(0, 60)
      if (data.description !== undefined) patch.description = data.description ? String(data.description).slice(0, 300) : null
      if (data.crateType != null && ['STARTER', 'PREMIUM', 'ELITE', 'REALM'].includes(String(data.crateType))) patch.crateType = String(data.crateType)
      if (data.price != null) patch.price = Math.max(0, num(data.price))
      if (data.currency != null) patch.currency = String(data.currency).slice(0, 8).toUpperCase()
      if (data.emoji != null) patch.emoji = String(data.emoji).slice(0, 8)
      if (data.realmPoints != null) patch.realmPoints = Math.max(0, Math.floor(num(data.realmPoints)))
      if (data.coins != null) patch.coins = Math.max(0, Math.floor(num(data.coins)))
      if (data.giftItemId !== undefined) patch.giftItemId = data.giftItemId ? String(data.giftItemId) : null
      if (data.giftQuantity != null) patch.giftQuantity = Math.max(1, Math.floor(num(data.giftQuantity, 1)))
      if (data.cosmeticRewardId !== undefined) patch.cosmeticRewardId = data.cosmeticRewardId ? String(data.cosmeticRewardId) : null
      if (data.bonusLabel !== undefined) patch.bonusLabel = data.bonusLabel ? String(data.bonusLabel).slice(0, 60) : null
      if (data.featured !== undefined) patch.featured = !!data.featured
      if (data.sortOrder != null) patch.sortOrder = Math.floor(num(data.sortOrder, 99))
      if (data.isActive !== undefined) patch.isActive = !!data.isActive
      const row = await db.crateProduct.update({ where: { id }, data: patch })
      await logAdminAction(guard.me.id, 'game_store.crate.update', 'CrateProduct', id, patch)
      return NextResponse.json({ ok: true, row })
    }

    if (kind === 'boost') {
      const realmLevel = data.realmLevel === null || data.realmLevel === undefined || data.realmLevel === '' ? null : Math.max(1, Math.min(15, Math.floor(num(data.realmLevel, 1))))
      const patch: { hoursBeforeEnd?: number; multiplier?: number; enabled?: boolean } = {}
      if (data.hoursBeforeEnd != null) patch.hoursBeforeEnd = num(data.hoursBeforeEnd, 4)
      if (data.multiplier != null) patch.multiplier = Math.floor(num(data.multiplier, 2))
      if (data.enabled !== undefined) patch.enabled = !!data.enabled
      await upsertBoostConfig({ realmLevel, ...patch })
      invalidateBoostConfigCache()
      await logAdminAction(guard.me.id, 'game_store.boost.update', 'RealmBoostConfig', String(realmLevel ?? 'default'), patch)
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'unknown_kind' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: 'failed', detail: (e as Error).message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin()
  if (guard.error) return guard.error
  const kind = req.nextUrl.searchParams.get('kind')
  const id = req.nextUrl.searchParams.get('id')
  if (!kind || !id) return NextResponse.json({ error: 'missing_params' }, { status: 400 })

  try {
    if (kind === 'package') {
      await db.gameCoinPackage.delete({ where: { id } })
      await logAdminAction(guard.me.id, 'game_store.package.delete', 'GameCoinPackage', id)
      return NextResponse.json({ ok: true })
    }
    if (kind === 'crate') {
      // Keep purchase history intact — disable instead of hard-delete when
      // entitlements reference the product.
      const inUse = await db.cratePurchase.count({ where: { crateProductId: id } })
      if (inUse > 0) {
        await db.crateProduct.update({ where: { id }, data: { isActive: false } })
        return NextResponse.json({ ok: true, disabled: true })
      }
      await db.crateProduct.delete({ where: { id } })
      await logAdminAction(guard.me.id, 'game_store.crate.delete', 'CrateProduct', id)
      return NextResponse.json({ ok: true })
    }
    if (kind === 'boost') {
      const levelRaw = req.nextUrl.searchParams.get('realmLevel')
      const realmLevel = levelRaw === 'default' || levelRaw == null ? null : Math.floor(Number(levelRaw))
      await db.realmBoostConfig.deleteMany({ where: { realmLevel: Number.isFinite(realmLevel) ? realmLevel : null } })
      invalidateBoostConfigCache()
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: 'unknown_kind' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: 'failed', detail: (e as Error).message }, { status: 500 })
  }
}
