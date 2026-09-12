// Quicky — ADMIN gift catalog management (v3 PRD §62-§69)
// Gated by User.isAdmin (checked fresh from the DB every request).
//
// GET    → all categories + all gifts (INCLUDING inactive ones — the admin
//          must be able to re-activate; the player catalog filters itself).
// POST   → { kind: 'category' | 'gift', data }     create
// PATCH  → { kind, id, data }                      update (partial)
// DELETE → { kind, id }                            SOFT delete (isActive=false)
//          so historical gift transactions keep rendering (§102).
//
// Gift fields (§65): name, categoryId, icon (emoji today — stored in BOTH
// `emoji` and the future-proof iconType/iconValue pair, §67), priceCoins,
// isActive, sortOrder. Category fields (§63): name, slug, icon, sortOrder.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/quicky/auth'

async function requireAdmin() {
  const me = await getCurrentUser()
  if (!me) return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) }
  const u = await db.user.findUnique({ where: { id: me.id }, select: { isAdmin: true } })
  if (!u?.isAdmin) return { error: NextResponse.json({ error: 'forbidden' }, { status: 403 }) }
  return { me }
}

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

export async function GET(_req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const [categories, gifts] = await Promise.all([
    db.giftCategory.findMany({ orderBy: { sortOrder: 'asc' } }),
    db.gameItem.findMany({
      where: { category: 'gift' },
      orderBy: { sortOrder: 'asc' },
    }),
  ])
  return NextResponse.json({ categories, gifts })
}

function cleanIcon(v: unknown): string | undefined {
  if (v === undefined) return undefined
  const s = String(v).trim()
  if (!s) return undefined
  return Array.from(s).slice(0, 4).join('') // ≤4 glyphs, emoji-safe
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const body = await req.json().catch(() => null)
  const kind = body?.kind
  const data = body?.data ?? {}

  if (kind === 'category') {
    const name = String(data.name ?? '').trim()
    if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })
    const slug = slugify(String(data.slug ?? '') || name)
    if (!slug) return NextResponse.json({ error: 'slug_required' }, { status: 400 })
    const dup = await db.giftCategory.findUnique({ where: { slug } })
    if (dup) return NextResponse.json({ error: 'slug_taken' }, { status: 409 })
    const icon = cleanIcon(data.icon) ?? '🎁'
    const created = await db.giftCategory.create({
      data: {
        name: name.slice(0, 40),
        slug,
        icon,
        sortOrder: Number.isFinite(Number(data.sortOrder)) ? Math.floor(Number(data.sortOrder)) : 99,
        isActive: data.isActive !== false,
      },
    })
    return NextResponse.json({ ok: true, category: created })
  }

  if (kind === 'gift') {
    const name = String(data.name ?? '').trim()
    if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })
    const price = Math.floor(Number(data.priceCoins))
    if (!Number.isFinite(price) || price < 0) return NextResponse.json({ error: 'invalid_price' }, { status: 400 })
    const icon = cleanIcon(data.icon) ?? '🎁'
    if (data.categoryId) {
      const cat = await db.giftCategory.findUnique({ where: { id: String(data.categoryId) } })
      if (!cat) return NextResponse.json({ error: 'invalid_category' }, { status: 400 })
    }
    const created = await db.gameItem.create({
      data: {
        category: 'gift',
        categoryId: data.categoryId ? String(data.categoryId) : null,
        name: name.slice(0, 40),
        emoji: icon,
        iconType: 'emoji',
        iconValue: icon,
        coinPrice: price,
        tier: price >= 250 ? 'premium' : 'default',
        isActive: data.isActive !== false,
        sortOrder: Number.isFinite(Number(data.sortOrder)) ? Math.floor(Number(data.sortOrder)) : 99,
      },
    })
    return NextResponse.json({ ok: true, gift: created })
  }

  return NextResponse.json({ error: 'invalid_kind' }, { status: 400 })
}

export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const body = await req.json().catch(() => null)
  const kind = body?.kind
  const id = String(body?.id ?? '')
  const data = body?.data ?? {}
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })

  if (kind === 'category') {
    const patch: any = {}
    if (data.name !== undefined) patch.name = String(data.name).trim().slice(0, 40)
    if (data.icon !== undefined) { const i = cleanIcon(data.icon); if (i) patch.icon = i }
    if (data.sortOrder !== undefined) patch.sortOrder = Math.floor(Number(data.sortOrder)) || 0
    if (data.isActive !== undefined) patch.isActive = !!data.isActive
    if (!Object.keys(patch).length) return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 })
    const updated = await db.giftCategory.update({ where: { id }, data: patch }).catch(() => null)
    if (!updated) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    return NextResponse.json({ ok: true, category: updated })
  }

  if (kind === 'gift') {
    const patch: any = {}
    if (data.name !== undefined) patch.name = String(data.name).trim().slice(0, 40)
    if (data.icon !== undefined) {
      const i = cleanIcon(data.icon)
      if (i) {
        patch.emoji = i
        patch.iconType = 'emoji'
        patch.iconValue = i
      }
    }
    if (data.priceCoins !== undefined) {
      const price = Math.floor(Number(data.priceCoins))
      if (!Number.isFinite(price) || price < 0) return NextResponse.json({ error: 'invalid_price' }, { status: 400 })
      patch.coinPrice = price
      patch.tier = price >= 250 ? 'premium' : 'default'
    }
    if (data.categoryId !== undefined) {
      if (data.categoryId === null) patch.categoryId = null
      else {
        const cat = await db.giftCategory.findUnique({ where: { id: String(data.categoryId) } })
        if (!cat) return NextResponse.json({ error: 'invalid_category' }, { status: 400 })
        patch.categoryId = cat.id
      }
    }
    if (data.sortOrder !== undefined) patch.sortOrder = Math.floor(Number(data.sortOrder)) || 0
    if (data.isActive !== undefined) patch.isActive = !!data.isActive
    if (!Object.keys(patch).length) return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 })
    const updated = await db.gameItem.update({ where: { id }, data: patch }).catch(() => null)
    if (!updated) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    return NextResponse.json({ ok: true, gift: updated })
  }

  return NextResponse.json({ error: 'invalid_kind' }, { status: 400 })
}

export async function DELETE(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const body = await req.json().catch(() => null)
  const kind = body?.kind
  const id = String(body?.id ?? '')
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })

  // SOFT delete only (§102): rows stay for historical transaction rendering.
  if (kind === 'category') {
    const updated = await db.giftCategory.update({ where: { id }, data: { isActive: false } }).catch(() => null)
    if (!updated) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  }
  if (kind === 'gift') {
    const updated = await db.gameItem.update({ where: { id }, data: { isActive: false } }).catch(() => null)
    if (!updated) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'invalid_kind' }, { status: 400 })
}
