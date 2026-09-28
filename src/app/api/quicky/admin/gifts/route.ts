// Quicky — ADMIN gift catalog management (v3 PRD §62-§69 + admin-console
// PRD §6.1)
// Gated by User.isAdmin (checked fresh from the DB every request).
//
// GET    → all categories + all gifts (INCLUDING inactive ones — the admin
//          must be able to re-activate; the player catalog filters itself).
// POST   → { kind: 'category' | 'gift', data }     create
// PATCH  → { kind, id, data }                      update (partial)
//          { kind, id, move: 'up' | 'down' }        reorder (swap sortOrder —
//          admin-console PRD §18.1 move-up/move-down, persists server-side)
// DELETE → { kind, id }                            SOFT delete (isActive=false)
//          so historical gift transactions keep rendering (§102).
//
// Gift fields (§65 + admin-console PRD §6.1): name, description, categoryId,
// icon (emoji today — stored in BOTH `emoji` and the future-proof
// iconType/iconValue pair, §67), priceCoins, tier (default/premium/seasonal
// — the optional rarity/premium classification), optional availability
// window (availableFrom/availableUntil — NULL = always available), isActive,
// sortOrder. Category fields (§63): name, slug, icon, sortOrder.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, logAdminAction } from '@/lib/quicky/admin'
import { isPrismaSchemaDrift, SCHEMA_SYNC_HINT } from '@/lib/quicky/prisma-sync'

/** Drift-hardening (commit 8470343 pattern): surface the REMEDY on a
 * half-synced machine instead of a cryptic 500. */
function driftGuard(err: unknown): NextResponse | null {
  if (!isPrismaSchemaDrift(err)) return null
  return NextResponse.json({ error: 'schema_out_of_sync', message: SCHEMA_SYNC_HINT }, { status: 500 })
}

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

export async function GET(_req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  let categories, gifts
  try {
    ;[categories, gifts] = await Promise.all([
      db.giftCategory.findMany({ orderBy: { sortOrder: 'asc' } }),
      db.gameItem.findMany({
        where: { category: 'gift' },
        orderBy: { sortOrder: 'asc' },
      }),
    ])
  } catch (err) {
    const hint = driftGuard(err)
    if (hint) return hint
    throw err
  }
  return NextResponse.json({ categories, gifts })
}

function cleanIcon(v: unknown): string | undefined {
  if (v === undefined) return undefined
  const s = String(v).trim()
  if (!s) return undefined
  return Array.from(s).slice(0, 4).join('') // ≤4 glyphs, emoji-safe
}

/** Gifting-revision (PNG icons): an icon value that is a URL (http(s)://,
 *  data:image/… or an app-relative /… path) marks an IMAGE icon — stored as
 *  iconType "image" + iconValue = URL, with the 🎁 emoji kept as the legacy
 *  fallback for old readers. Anything else stays an emoji (≤4 glyphs). */
function isImageIconUrl(v: string): boolean {
  return /^(https?:\/\/|data:image\/|\/)/i.test(v) && v.length <= 600
}

function iconPatch(v: unknown): { emoji?: string; iconType?: string; iconValue?: string } | undefined {
  if (v === undefined) return undefined
  const s = String(v).trim()
  if (!s) return undefined
  if (isImageIconUrl(s)) return { iconType: 'image', iconValue: s }
  const emoji = Array.from(s).slice(0, 4).join('')
  return { emoji, iconType: 'emoji', iconValue: emoji }
}

const TIERS = new Set(['default', 'premium', 'seasonal'])
const cleanTier = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined
  const s = String(v).trim().toLowerCase()
  return TIERS.has(s) ? s : undefined
}

/** Parse an optional ISO date field ('' / null → null to clear). */
const parseDate = (v: unknown): Date | null | undefined => {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? undefined : d
}

/** Availability pair with cross-validation (until must be after from). */
function availabilityPatch(data: Record<string, unknown>):
  | { ok: true; from?: Date | null; until?: Date | null }
  | { ok: false; error: string } {
  const from = parseDate(data.availableFrom)
  const until = parseDate(data.availableUntil)
  if (from === undefined || until === undefined) return { ok: false, error: 'invalid_availability_date' }
  if (from && until && from.getTime() >= until.getTime()) {
    return { ok: false, error: 'available_until_must_be_after_from' }
  }
  return { ok: true, from, until }
}

/** Swap sortOrder with the adjacent row (admin-console PRD §18.1).
 * Runs inside ONE transaction; ties on sortOrder are re-sequenced to 0..n-1
 * first so the swap is unambiguous. */
async function moveRow(
  kind: 'gift' | 'category',
  id: string,
  direction: 'up' | 'down'
): Promise<{ ok: boolean; moved: boolean; error?: string }> {
  type Row = { id: string; sortOrder: number }
  let siblings: Row[]
  if (kind === 'gift') {
    const target = await db.gameItem.findUnique({ where: { id } })
    if (!target) return { ok: false, moved: false, error: 'not_found' }
    siblings = await db.gameItem.findMany({
      where: { category: 'gift' },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, sortOrder: true },
    })
  } else {
    const target = await db.giftCategory.findUnique({ where: { id } })
    if (!target) return { ok: false, moved: false, error: 'not_found' }
    siblings = await db.giftCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, sortOrder: true },
    })
  }
  const idx = siblings.findIndex((s) => s.id === id)
  if (idx < 0) return { ok: false, moved: false, error: 'not_found' }
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1
  if (swapIdx < 0 || swapIdx >= siblings.length) return { ok: true, moved: false } // already at the end

  await db.$transaction(async (tx) => {
    const write = kind === 'gift'
      ? (rowId: string, order: number) => tx.gameItem.update({ where: { id: rowId }, data: { sortOrder: order } })
      : (rowId: string, order: number) => tx.giftCategory.update({ where: { id: rowId }, data: { sortOrder: order } })
    // Re-sequence the whole catalog to 0..n-1 (admin list order IS the
    // display order), then apply the one-step swap on the clean sequence.
    for (let i = 0; i < siblings.length; i++) await write(siblings[i].id, i)
    await write(siblings[idx].id, swapIdx)
    await write(siblings[swapIdx].id, idx)
  })
  return { ok: true, moved: true }
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
    await logAdminAction(gate.me.id, 'create', 'gift_category', created.id, { name: created.name })
    return NextResponse.json({ ok: true, category: created })
  }

  if (kind === 'gift') {
    const name = String(data.name ?? '').trim()
    if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })
    const price = Math.floor(Number(data.priceCoins))
    if (!Number.isFinite(price) || price < 0) return NextResponse.json({ error: 'invalid_price' }, { status: 400 })
    const icon = iconPatch(data.icon) ?? { emoji: '🎁', iconType: 'emoji', iconValue: '🎁' }
    if (data.categoryId) {
      const cat = await db.giftCategory.findUnique({ where: { id: String(data.categoryId) } })
      if (!cat) return NextResponse.json({ error: 'invalid_category' }, { status: 400 })
    }
    const window = availabilityPatch(data)
    if (!window.ok) return NextResponse.json({ error: window.error }, { status: 400 })
    let created
    try {
      created = await db.gameItem.create({
        data: {
          category: 'gift',
          categoryId: data.categoryId ? String(data.categoryId) : null,
          name: name.slice(0, 40),
          emoji: icon.emoji ?? '🎁',
          iconType: icon.iconType ?? 'emoji',
          iconValue: icon.iconValue ?? icon.emoji ?? '🎁',
          description: data.description !== undefined ? String(data.description).trim().slice(0, 200) || null : null,
          coinPrice: price,
          tier: cleanTier(data.tier) ?? (price >= 250 ? 'premium' : 'default'),
          availableFrom: window.from ?? null,
          availableUntil: window.until ?? null,
          isActive: data.isActive !== false,
          sortOrder: Number.isFinite(Number(data.sortOrder)) ? Math.floor(Number(data.sortOrder)) : 99,
        },
      })
    } catch (err) {
      const hint = driftGuard(err)
      if (hint) return hint
      throw err
    }
    await logAdminAction(gate.me.id, 'create', 'gift', created.id, { name: created.name, priceCoins: price })
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
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })

  // admin-console PRD §18.1 — persistent move-up/move-down reorder.
  if (body?.move === 'up' || body?.move === 'down') {
    if (kind !== 'gift' && kind !== 'category') {
      return NextResponse.json({ error: 'invalid_kind' }, { status: 400 })
    }
    let result
    try {
      result = await moveRow(kind === 'gift' ? 'gift' : 'category', id, body.move)
    } catch (err) {
      const hint = driftGuard(err)
      if (hint) return hint
      throw err
    }
    if (!result.ok && result.error === 'not_found') {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    if (!result.ok) return NextResponse.json({ error: result.error ?? 'move_failed' }, { status: 500 })
    if (result.moved) {
      await logAdminAction(gate.me.id, 'reorder', kind === 'gift' ? 'gift' : 'gift_category', id, { move: body.move })
    }
    return NextResponse.json({ ok: true, moved: result.moved })
  }

  const data = body?.data ?? {}

  if (kind === 'category') {
    const patch: any = {}
    if (data.name !== undefined) patch.name = String(data.name).trim().slice(0, 40)
    if (data.icon !== undefined) { const i = cleanIcon(data.icon); if (i) patch.icon = i }
    if (data.sortOrder !== undefined) patch.sortOrder = Math.floor(Number(data.sortOrder)) || 0
    if (data.isActive !== undefined) patch.isActive = !!data.isActive
    if (!Object.keys(patch).length) return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 })
    const updated = await db.giftCategory.update({ where: { id }, data: patch }).catch(() => null)
    if (!updated) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    await logAdminAction(gate.me.id, 'update', 'gift_category', id, patch)
    return NextResponse.json({ ok: true, category: updated })
  }

  if (kind === 'gift') {
    const patch: any = {}
    if (data.name !== undefined) patch.name = String(data.name).trim().slice(0, 40)
    if (data.description !== undefined) {
      patch.description = String(data.description).trim().slice(0, 200) || null
    }
    if (data.icon !== undefined) {
      const icon = iconPatch(data.icon)
      if (icon) {
        // PNG/image icons: iconType+iconValue carry the URL; emoji keeps a
        // glyph fallback so legacy readers still render SOMETHING.
        if (icon.emoji !== undefined) patch.emoji = icon.emoji
        patch.iconType = icon.iconType
        patch.iconValue = icon.iconValue
      }
    }
    if (data.priceCoins !== undefined) {
      const price = Math.floor(Number(data.priceCoins))
      if (!Number.isFinite(price) || price < 0) return NextResponse.json({ error: 'invalid_price' }, { status: 400 })
      patch.coinPrice = price
      // Explicit tier wins (admin-console PRD §6.1 rarity/premium
      // classification); only fall back to the price heuristic without one.
      const explicitTier = cleanTier(data.tier)
      if (explicitTier) patch.tier = explicitTier
      else if (!data.tier) patch.tier = price >= 250 ? 'premium' : 'default'
    } else if (cleanTier(data.tier)) {
      patch.tier = cleanTier(data.tier)
    }
    if (data.categoryId !== undefined) {
      if (data.categoryId === null) patch.categoryId = null
      else {
        const cat = await db.giftCategory.findUnique({ where: { id: String(data.categoryId) } })
        if (!cat) return NextResponse.json({ error: 'invalid_category' }, { status: 400 })
        patch.categoryId = cat.id
      }
    }
    // Optional availability window (admin-console PRD §6.1) — validated as a
    // pair so from is always before until.
    if (data.availableFrom !== undefined || data.availableUntil !== undefined) {
      let current
      try {
        current = await db.gameItem.findUnique({ where: { id }, select: { availableFrom: true, availableUntil: true } })
      } catch (err) {
        const hint = driftGuard(err)
        if (hint) return hint
        throw err
      }
      if (!current) return NextResponse.json({ error: 'not_found' }, { status: 404 })
      const merged = {
        availableFrom: data.availableFrom !== undefined ? data.availableFrom : current.availableFrom,
        availableUntil: data.availableUntil !== undefined ? data.availableUntil : current.availableUntil,
      }
      const window = availabilityPatch(merged)
      if (!window.ok) return NextResponse.json({ error: window.error }, { status: 400 })
      patch.availableFrom = window.from ?? null
      patch.availableUntil = window.until ?? null
    }
    if (data.sortOrder !== undefined) patch.sortOrder = Math.floor(Number(data.sortOrder)) || 0
    if (data.isActive !== undefined) patch.isActive = !!data.isActive
    if (!Object.keys(patch).length) return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 })
    let updated
    try {
      updated = await db.gameItem.update({ where: { id }, data: patch })
    } catch (err) {
      const hint = driftGuard(err)
      if (hint) return hint
      const code = (err as { code?: string })?.code
      if (code !== 'P2025') throw err
      updated = null
    }
    if (!updated) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    await logAdminAction(gate.me.id, 'update', 'gift', id, patch)
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
    let updated
    try {
      updated = await db.giftCategory.update({ where: { id }, data: { isActive: false } })
    } catch (err) {
      const hint = driftGuard(err)
      if (hint) return hint
      const code = (err as { code?: string })?.code
      if (code !== 'P2025') throw err
      updated = null
    }
    if (!updated) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    await logAdminAction(gate.me.id, 'deactivate', 'gift_category', id)
    return NextResponse.json({ ok: true })
  }
  if (kind === 'gift') {
    let updated
    try {
      updated = await db.gameItem.update({ where: { id }, data: { isActive: false } })
    } catch (err) {
      const hint = driftGuard(err)
      if (hint) return hint
      const code = (err as { code?: string })?.code
      if (code !== 'P2025') throw err
      updated = null
    }
    if (!updated) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    await logAdminAction(gate.me.id, 'deactivate', 'gift', id)
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'invalid_kind' }, { status: 400 })
}
