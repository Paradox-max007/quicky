// Quicky — ADMIN CRATES (crate-pass PRD)
// GET    /api/quicky/admin/crates
//          — crates (with level stats) + gift catalog options + realm cratePoints
// POST   /api/quicky/admin/crates              — create a crate (seeds levels)
// PATCH  /api/quicky/admin/crates
//          { id, name?, description?, imageUrl?, priceCoins?, levelCount?, isActive?, sortOrder? }
//          { id, action: 'levels_bulk', prizeType?, itemId?, prizeName?, prizeEmoji?, quantity?, priceCoins? }
//          { id, action: 'level_update', level, prizeType?, itemId?, prizeName?, prizeEmoji?, quantity?, priceCoins? }
// DELETE /api/quicky/admin/crates?id=
//
// Everything about a crate is admin-owned: the unlock price, the per-level
// PRIZE (a gift item or coins) and the per-level coin PRICE. Realm crate-point
// grants are configured per realm on /admin/realm-config (cratePoints field).
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, logAdminAction } from '@/lib/quicky/admin'
import { CRATE_LEVELS_DEFAULT, ensureCrateBootstrap } from '@/lib/quicky/crates'

export const dynamic = 'force-dynamic'

const MAX_LEVELS = 100
const MAX_QTY = 100_000
const MAX_PRICE = 1_000_000

function cleanLevelFields(body: Record<string, unknown>): {
  prizeType?: string
  itemId?: string | null
  prizeName?: string | null
  prizeEmoji?: string | null
  quantity?: number
  priceCoins?: number
} {
  const out: Record<string, unknown> = {}
  if (body.prizeType !== undefined) {
    const t = String(body.prizeType)
    out.prizeType = t === 'COINS' ? 'COINS' : 'GIFT'
    if (t !== 'COINS') out.itemId = String(body.itemId ?? '') || null
  }
  if (body.itemId !== undefined) out.itemId = String(body.itemId ?? '') || null
  if (body.prizeName !== undefined) out.prizeName = String(body.prizeName ?? '').trim().slice(0, 60) || null
  if (body.prizeEmoji !== undefined) out.prizeEmoji = String(body.prizeEmoji ?? '').trim().slice(0, 8) || null
  if (body.quantity !== undefined) {
    const q = Math.floor(Number(body.quantity))
    out.quantity = Number.isInteger(q) && q >= 1 && q <= MAX_QTY ? q : undefined
  }
  if (body.priceCoins !== undefined) {
    const p = Math.floor(Number(body.priceCoins))
    out.priceCoins = Number.isInteger(p) && p >= 0 && p <= MAX_PRICE ? p : undefined
  }
  return out as { prizeType?: string; itemId?: string | null; prizeName?: string | null; prizeEmoji?: string | null; quantity?: number; priceCoins?: number }
}

export async function GET() {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  await ensureCrateBootstrap().catch(() => {})
  const [crates, levelStats, userStats, itemOptions, realms] = await Promise.all([
    db.crate.findMany({ orderBy: { sortOrder: 'asc' } }),
    db.crateLevel.groupBy({ by: ['crateId'], _count: { _all: true } }),
    db.userCrate.groupBy({ by: ['crateId'], _count: { _all: true } }),
    db.gameItem.findMany({
      where: { isActive: true, category: 'gift' },
      select: { id: true, name: true, emoji: true, iconType: true, iconValue: true },
      orderBy: { sortOrder: 'asc' },
    }),
    db.realmDefinition.findMany({ orderBy: { level: 'asc' }, select: { level: true, name: true, cratePoints: true } }),
  ])
  const levelBy = new Map(levelStats.map((l) => [l.crateId, l._count._all]))
  const userBy = new Map(userStats.map((u) => [u.crateId, u._count._all]))

  return NextResponse.json({
    crates: crates.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      imageUrl: c.imageUrl,
      priceCoins: c.priceCoins,
      levelCount: c.levelCount,
      isActive: c.isActive,
      sortOrder: c.sortOrder,
      levelsConfigured: levelBy.get(c.id) ?? 0,
      owners: userBy.get(c.id) ?? 0,
    })),
    itemOptions,
    realms,
  })
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const name = String(body?.name ?? '').trim().slice(0, 60)
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })
  const levelCount = Math.min(MAX_LEVELS, Math.max(1, Math.floor(Number(body?.levelCount ?? CRATE_LEVELS_DEFAULT)) || CRATE_LEVELS_DEFAULT))
  const priceCoins = Math.min(MAX_PRICE, Math.max(0, Math.floor(Number(body?.priceCoins ?? 500)) || 0))
  const sortOrder = Math.max(0, Math.floor(Number(body?.sortOrder ?? 0)) || 0)
  const crate = await db.crate.create({
    data: {
      name,
      description: typeof body?.description === 'string' ? (body.description as string).trim().slice(0, 200) || null : null,
      imageUrl: typeof body?.imageUrl === 'string' && (body.imageUrl as string).trim() ? (body.imageUrl as string).trim() : null,
      priceCoins,
      levelCount,
      isActive: body?.isActive === undefined ? true : Boolean(body.isActive),
      sortOrder,
    },
  })

  // Seed the levels with the admin's default prize/price (editable per level
  // afterwards, or in bulk through the levels_bulk action). NOTE: the crate's
  // unlock price key is `priceCoins`; the seeded LEVEL price key is
  // `levelPriceCoins` (they must not collide in one payload).
  const levelPrizeType = body?.prizeType === 'GIFT' ? 'GIFT' : 'COINS'
  const levelItemId = levelPrizeType === 'GIFT' && typeof body?.itemId === 'string' ? (body.itemId as string) : null
  const levelQuantity = Math.min(MAX_QTY, Math.max(1, Math.floor(Number(body?.quantity ?? 20)) || 1))
  const levelPrice = Math.min(MAX_PRICE, Math.max(0, Math.floor(Number(body?.levelPriceCoins ?? 100)) || 0))
  const prizeName = typeof body?.prizeName === 'string' && body.prizeName ? (body.prizeName as string) : levelPrizeType === 'COINS' ? 'Coin Drop' : null
  const prizeEmoji = typeof body?.prizeEmoji === 'string' && body.prizeEmoji ? (body.prizeEmoji as string) : levelPrizeType === 'COINS' ? '🪙' : null

  await db.crateLevel.createMany({
    data: Array.from({ length: levelCount }, (_, i) => ({
      crateId: crate.id,
      level: i + 1,
      prizeType: levelPrizeType,
      itemId: levelItemId,
      prizeName,
      prizeEmoji,
      quantity: levelQuantity,
      priceCoins: levelPrice,
    })),
    skipDuplicates: true,
  })

  await logAdminAction(gate.me.id, 'crate_create', 'Crate', crate.id, { name, levelCount, priceCoins })
  return NextResponse.json({ ok: true, crate })
}

export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const id = String(body?.id ?? '')
  const action = body?.action ? String(body.action) : null
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })

  const crate = await db.crate.findUnique({ where: { id } })
  if (!crate) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // ── Level management ──────────────────────────────────────────────────────
  if (action === 'levels_bulk') {
    const fields = cleanLevelFields((body ?? {}) as Record<string, unknown>)
    if (Object.keys(fields).length === 0) return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 })
    await db.crateLevel.updateMany({ where: { crateId: id }, data: fields as never })
    await logAdminAction(gate.me.id, 'crate_levels_bulk', 'Crate', id, fields)
    return NextResponse.json({ ok: true })
  }

  if (action === 'level_update') {
    const level = Math.floor(Number(body?.level))
    if (!Number.isInteger(level) || level < 1 || level > MAX_LEVELS) {
      return NextResponse.json({ error: 'invalid_level' }, { status: 400 })
    }
    const fields = cleanLevelFields((body ?? {}) as Record<string, unknown>)
    if (Object.keys(fields).length === 0) return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 })
    // upsert keeps level rows that were skipped at creation manageable too
    const existing = await db.crateLevel.findUnique({ where: { crateId_level: { crateId: id, level } } })
    if (existing) {
      await db.crateLevel.update({ where: { crateId_level: { crateId: id, level } }, data: fields as never })
    } else {
      await db.crateLevel.create({
        data: { crateId: id, level, prizeType: fields.prizeType ?? 'COINS', itemId: fields.itemId ?? null, prizeName: fields.prizeName ?? null, prizeEmoji: fields.prizeEmoji ?? null, quantity: fields.quantity ?? 1, priceCoins: fields.priceCoins ?? 100 },
      })
    }
    await logAdminAction(gate.me.id, 'crate_level_update', 'CrateLevel', `${id}#${level}`, fields)
    return NextResponse.json({ ok: true })
  }

  // ── Crate field update ────────────────────────────────────────────────────
  const data: Record<string, unknown> = {}
  if (body?.name !== undefined) {
    const name = String(body.name).trim().slice(0, 60)
    if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })
    data.name = name
  }
  if (body?.description !== undefined) data.description = String(body.description).trim().slice(0, 200) || null
  if (body?.imageUrl !== undefined) data.imageUrl = typeof body.imageUrl === 'string' && body.imageUrl.trim() ? body.imageUrl.trim() : null
  if (body?.priceCoins !== undefined) {
    const p = Math.floor(Number(body.priceCoins))
    if (!Number.isInteger(p) || p < 0 || p > MAX_PRICE) return NextResponse.json({ error: 'invalid_price' }, { status: 400 })
    data.priceCoins = p
  }
  if (body?.levelCount !== undefined) {
    const n = Math.floor(Number(body.levelCount))
    if (!Number.isInteger(n) || n < 1 || n > MAX_LEVELS) return NextResponse.json({ error: 'invalid_level_count' }, { status: 400 })
    data.levelCount = n
  }
  if (body?.isActive !== undefined) data.isActive = Boolean(body.isActive)
  if (body?.sortOrder !== undefined) data.sortOrder = Math.max(0, Math.floor(Number(body.sortOrder)) || 0)
  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 })

  const updated = await db.crate.update({ where: { id }, data: data as never })
  await logAdminAction(gate.me.id, 'crate_update', 'Crate', id, data)
  return NextResponse.json({ ok: true, crate: updated })
}

export async function DELETE(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const id = new URL(req.url).searchParams.get('id') ?? ''
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })

  // Never hard-delete a crate with owners — deactivate instead (grants must
  // keep resolving for players who already own the pass).
  const owners = await db.userCrate.count({ where: { crateId: id, unlockedAt: { not: null } } })
  if (owners > 0) {
    await db.crate.update({ where: { id }, data: { isActive: false } }).catch(() => null)
    return NextResponse.json({ error: 'has_owners_deactivated', message: `${owners} players own this crate — deactivated instead of deleted.` }, { status: 409 })
  }
  await db.crate.delete({ where: { id } }).catch(() => null)
  await logAdminAction(gate.me.id, 'crate_delete', 'Crate', id, {})
  return NextResponse.json({ ok: true })
}
