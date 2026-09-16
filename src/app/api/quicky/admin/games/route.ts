// Quicky — ADMIN GAME CONFIGURATION (refactor PRD §19/§20/§84/§85/§86)
// GET    /api/quicky/admin/games   -> ALL games (incl. inactive) + rotating description items
// POST   { kind: 'game' | 'description', data }
// PATCH  { kind, id, data }
// DELETE { kind, id }              -> game: soft-deactivate; description: hard delete
//
// Admin controls game presentation without code changes (§19): name, slug,
// description, icon, artwork (theme key), isPlayable, isActive, sort_order,
// supported modes, min/max players + the rotating landing texts (§20) with
// explicit sort_order (§86). Image upload uses the app's existing upload
// endpoint and stores a storage path — arbitrary external URLs are rejected
// for artwork (§85) unless they are app-relative (starting with "/").
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, logAdminAction } from '@/lib/quicky/admin'
import { db } from '@/lib/db'

const GAME_FIELDS = [
  'name', 'slug', 'shortDescription', 'description', 'icon', 'artwork',
  'supportedModes', 'minPlayers', 'maxPlayers', 'isPlayable', 'isActive',
  'isFeatured', 'sortOrder',
] as const

function sanitizeGame(data: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const k of GAME_FIELDS) {
    if (!(k in data)) continue
    let v = data[k]
    if (k === 'name' || k === 'shortDescription' || k === 'description') v = String(v).slice(0, 300)
    if (k === 'slug') v = String(v).toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').slice(0, 60)
    if (k === 'icon') v = String(v).slice(0, 8)
    if (k === 'artwork') {
      const sv = String(v).trim()
      // §85: no arbitrary external URLs — theme key or app-relative path only
      if (sv && !sv.startsWith('/') && !/^[a-z-]{2,24}$/.test(sv)) continue
      v = sv
    }
    if (k === 'supportedModes') {
      const s = String(v).toUpperCase()
      v = ['GROUP', 'TWO_PLAYER', 'BOTH'].includes(s) ? s : 'GROUP'
    }
    if (k === 'minPlayers' || k === 'maxPlayers' || k === 'sortOrder') v = Math.max(0, Math.round(Number(v) || 0))
    if (k === 'isPlayable' || k === 'isActive' || k === 'isFeatured') v = !!v
    out[k] = v
  }
  return out
}

export async function GET() {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const [games, items] = await Promise.all([
    db.gameDefinition.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    db.gameDescriptionItem.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
  ])
  return NextResponse.json({ games, descriptionItems: items })
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const body = await req.json().catch(() => ({}))
  const data = (body.data ?? {}) as Record<string, unknown>

  if (body.kind === 'game') {
    const clean = sanitizeGame(data)
    if (!clean.name) return NextResponse.json({ error: 'name required' }, { status: 400 })
    if (!clean.slug) clean.slug = String(clean.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)
    const game = await db.gameDefinition.create({ data: clean as never })
    await logAdminAction(gate.me.id, 'create', 'game', game.id, { name: game.name })
    return NextResponse.json({ ok: true, game }, { status: 201 })
  }

  if (body.kind === 'description') {
    const gameId = String(data.gameId ?? '')
    const text = String(data.text ?? '').slice(0, 160)
    if (!gameId || !text) return NextResponse.json({ error: 'gameId and text required' }, { status: 400 })
    const item = await db.gameDescriptionItem.create({
      data: {
        gameId,
        text,
        sortOrder: Math.max(0, Math.round(Number(data.sortOrder) || 0)),
        isActive: data.isActive === undefined ? true : !!data.isActive,
      },
    })
    await logAdminAction(gate.me.id, 'create', 'game_description', item.id, { text })
    return NextResponse.json({ ok: true, item }, { status: 201 })
  }

  return NextResponse.json({ error: 'Invalid kind' }, { status: 400 })
}

export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const body = await req.json().catch(() => ({}))
  const id = String(body.id ?? '')
  const data = (body.data ?? {}) as Record<string, unknown>
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  if (body.kind === 'game') {
    const clean = sanitizeGame(data)
    const game = await db.gameDefinition.update({ where: { id }, data: clean as never }).catch(() => null)
    if (!game) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await logAdminAction(gate.me.id, 'update', 'game', id, clean)
    return NextResponse.json({ ok: true, game })
  }

  if (body.kind === 'description') {
    const clean: Record<string, unknown> = {}
    if ('text' in data) clean.text = String(data.text).slice(0, 160)
    if ('sortOrder' in data) clean.sortOrder = Math.max(0, Math.round(Number(data.sortOrder) || 0))
    if ('isActive' in data) clean.isActive = !!data.isActive
    const item = await db.gameDescriptionItem.update({ where: { id }, data: clean }).catch(() => null)
    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await logAdminAction(gate.me.id, 'update', 'game_description', id, clean)
    return NextResponse.json({ ok: true, item })
  }

  return NextResponse.json({ error: 'Invalid kind' }, { status: 400 })
}

export async function DELETE(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const kind = req.nextUrl.searchParams.get('kind')
  const id = req.nextUrl.searchParams.get('id') ?? ''
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  if (kind === 'game') {
    // Soft-deactivate so historical rooms/stats keep rendering (§102 rule).
    const game = await db.gameDefinition.update({ where: { id }, data: { isActive: false } }).catch(() => null)
    if (!game) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await logAdminAction(gate.me.id, 'deactivate', 'game', id)
    return NextResponse.json({ ok: true })
  }
  if (kind === 'description') {
    await db.gameDescriptionItem.delete({ where: { id } }).catch(() => null)
    await logAdminAction(gate.me.id, 'delete', 'game_description', id)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Invalid kind' }, { status: 400 })
}
