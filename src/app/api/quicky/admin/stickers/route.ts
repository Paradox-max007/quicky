// Quicky — ADMIN sticker ITEM management (game-chat PRD §67/§71/§118/§119/§127)
// Gated by requireAdmin() — server-side role check on EVERY request (§127).
//
// GET    ?bundleId= → stickers of one bundle (admin view — includes inactive)
// POST   { bundleId, name, assetUrl, sortOrder?, isActive? }
// PATCH  { id, data { name?, assetUrl?, sortOrder?, isActive?, bundleId? } }
//        (bundleId = re-map a sticker to a different pack — admin request)
// DELETE { id }
// §119 asset validation: emoji/short-glyph assets or an https image URL —
// arbitrary client-supplied URLs are rejected; type + size are checked here
// (the actual binary upload flow arrives with Supabase Storage wiring).
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, logAdminAction } from '@/lib/quicky/admin'

const MAX_ASSET_URL = 300
const ALLOWED_IMAGE_EXT = /\.(png|gif|webp|apng|svg)(\?|$)/i

/** §119 — accept ≤8-glyph emoji assets or a validated https image URL. */
function validateAsset(v: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const s = String(v ?? '').trim()
  if (!s) return { ok: false, error: 'asset_required' }
  if (s.startsWith('http://') || s.startsWith('https://')) {
    if (!s.startsWith('https://')) return { ok: false, error: 'asset_https_only' }
    if (s.length > MAX_ASSET_URL) return { ok: false, error: 'asset_too_long' }
    if (!ALLOWED_IMAGE_EXT.test(s)) return { ok: false, error: 'asset_unsupported_type' }
    return { ok: true, value: s }
  }
  const glyphs = Array.from(s)
  if (glyphs.length > 8) return { ok: false, error: 'asset_too_long' }
  return { ok: true, value: s }
}

const cleanInt = (v: unknown): number | undefined => {
  if (v === undefined) return undefined
  const n = Math.floor(Number(v))
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

export async function GET(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error
  const bundleId = req.nextUrl.searchParams.get('bundleId') ?? ''
  if (!bundleId) return NextResponse.json({ error: 'bundleId required' }, { status: 400 })
  const stickers = await db.gameSticker.findMany({
    where: { bundleId },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  })
  return NextResponse.json({ stickers })
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const body = await req.json().catch(() => null)
  const bundleId = String(body?.bundleId ?? '')
  const name = String(body?.name ?? '').trim().slice(0, 60)
  if (!bundleId || !name) return NextResponse.json({ error: 'bundle_and_name_required' }, { status: 400 })
  const bundle = await db.gameStickerBundle.findUnique({ where: { id: bundleId }, select: { id: true } })
  if (!bundle) return NextResponse.json({ error: 'bundle_not_found' }, { status: 404 })

  const asset = validateAsset(body?.assetUrl)
  if (!asset.ok) return NextResponse.json({ error: asset.error }, { status: 400 })

  const created = await db.gameSticker.create({
    data: {
      bundleId,
      name,
      assetUrl: asset.value,
      sortOrder: cleanInt(body?.sortOrder) ?? 0,
      isActive: body?.isActive === undefined ? true : !!body.isActive,
    },
  })
  await logAdminAction(gate.me.id, 'create', 'sticker', created.id, { name, bundleId })
  return NextResponse.json({ ok: true, sticker: created })
}

export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const body = await req.json().catch(() => null)
  const id = String(body?.id ?? '')
  const data = body?.data ?? {}
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if (data?.name !== undefined) {
    const n = String(data.name).trim().slice(0, 60)
    if (!n) return NextResponse.json({ error: 'name_required' }, { status: 400 })
    patch.name = n
  }
  // Re-mapping a sticker to another pack (admin: "map a sticker to a set").
  // The target bundle must exist — a typo'd id must not orphan the sticker.
  if (data?.bundleId !== undefined) {
    const bid = String(data.bundleId).trim()
    if (!bid) return NextResponse.json({ error: 'bundle_required' }, { status: 400 })
    const target = await db.gameStickerBundle.findUnique({ where: { id: bid }, select: { id: true } })
    if (!target) return NextResponse.json({ error: 'bundle_not_found' }, { status: 404 })
    patch.bundleId = bid
  }
  if (data?.assetUrl !== undefined) {
    const asset = validateAsset(data.assetUrl)
    if (!asset.ok) return NextResponse.json({ error: asset.error }, { status: 400 })
    patch.assetUrl = asset.value
  }
  const sortOrder = cleanInt(data?.sortOrder)
  if (sortOrder !== undefined) patch.sortOrder = sortOrder
  if (data?.isActive !== undefined) patch.isActive = !!data.isActive
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 })

  const updated = await db.gameSticker.update({ where: { id }, data: patch }).catch(() => null)
  if (!updated) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  await logAdminAction(gate.me.id, 'update', 'sticker', id, patch)
  return NextResponse.json({ ok: true, sticker: updated })
}

export async function DELETE(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const body = await req.json().catch(() => null)
  const id = String(body?.id ?? '')
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })
  const gone = await db.gameSticker.delete({ where: { id } }).catch(() => null)
  if (!gone) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  await logAdminAction(gate.me.id, 'delete', 'sticker', id, { name: gone.name })
  return NextResponse.json({ ok: true })
}
