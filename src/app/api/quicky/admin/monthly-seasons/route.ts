// Quicky — ADMIN MONTHLY SEASONS (crate-pass PRD)
// GET    /api/quicky/admin/monthly-seasons
// POST   /api/quicky/admin/monthly-seasons        — create a season
// PATCH  /api/quicky/admin/monthly-seasons        — update / manage gifts+events:
//          { id, name?, imageUrl?, startsAt?, endsAt?, isActive? }
//          { id, action: 'add_gift' | 'remove_gift', itemId }
//          { id, action: 'add_event' | 'update_event' | 'remove_event', ... }
// DELETE /api/quicky/admin/monthly-seasons?id=
//
// The MONTHLY season (❤ chip, calendar-month windows, seasonal gifts +
// events). Distinct from /admin/seasons (the realm-ladder season).
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, logAdminAction } from '@/lib/quicky/admin'
import { getOrCreateActiveSeason } from '@/lib/quicky/season'

export const dynamic = 'force-dynamic'

function parseDate(input: unknown): Date | null {
  const t = Date.parse(String(input ?? ''))
  return Number.isFinite(t) ? new Date(t) : null
}

export async function GET() {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  await getOrCreateActiveSeason().catch(() => null)
  const [seasons, giftCounts, eventCounts, pointAgg, giftRows, eventRows] = await Promise.all([
    db.season.findMany({ orderBy: { startsAt: 'desc' }, take: 36 }),
    db.seasonGift.groupBy({ by: ['seasonId'], _count: { _all: true } }),
    db.seasonEvent.groupBy({ by: ['seasonId'], _count: { _all: true } }),
    db.userSeason.groupBy({ by: ['seasonId'], _sum: { points: true }, _count: { _all: true } }),
    db.seasonGift.findMany({ orderBy: { sortOrder: 'asc' } }),
    db.seasonEvent.findMany({ orderBy: { startsAt: 'asc' } }),
  ])
  const giftBy = new Map(giftCounts.map((g) => [g.seasonId, g._count._all]))
  const eventBy = new Map(eventCounts.map((e) => [e.seasonId, e._count._all]))
  const pointBy = new Map(pointAgg.map((p) => [p.seasonId, p]))
  const giftsBySeason = new Map<string, string[]>()
  for (const g of giftRows) giftsBySeason.set(g.seasonId, [...(giftsBySeason.get(g.seasonId) ?? []), g.itemId])
  const eventsBySeason = new Map<string, unknown[]>()
  for (const e of eventRows) {
    eventsBySeason.set(e.seasonId, [
      ...(eventsBySeason.get(e.seasonId) ?? []),
      {
        id: e.id,
        name: e.name,
        emoji: e.emoji,
        description: e.description,
        multiplier: e.multiplier,
        startsAt: e.startsAt.toISOString(),
        endsAt: e.endsAt.toISOString(),
        running: e.startsAt.getTime() <= Date.now() && e.endsAt.getTime() > Date.now(),
      },
    ])
  }

  return NextResponse.json({
    seasons: seasons.map((s) => ({
      id: s.id,
      name: s.name,
      imageUrl: s.imageUrl,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      isActive: s.isActive,
      giftCount: giftBy.get(s.id) ?? 0,
      eventCount: eventBy.get(s.id) ?? 0,
      players: pointBy.get(s.id)?._count._all ?? 0,
      pointsAwarded: pointBy.get(s.id)?._sum.points ?? 0,
      giftIds: giftsBySeason.get(s.id) ?? [],
      events: eventsBySeason.get(s.id) ?? [],
    })),
    itemOptions: await db.gameItem
      .findMany({
        where: { isActive: true, category: 'gift' },
        select: { id: true, name: true, emoji: true, iconType: true, iconValue: true },
        orderBy: { sortOrder: 'asc' },
      })
      .catch(() => []),
  })
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const body = await req.json().catch(() => null)
  const name = String(body?.name ?? '').trim().slice(0, 60)
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })

  const startsAt = body?.startsAt ? parseDate(body.startsAt) : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))
  const endsAt = body?.endsAt ? parseDate(body.endsAt) : null
  if (!startsAt) return NextResponse.json({ error: 'invalid_window' }, { status: 400 })
  const finalEndsAt = endsAt ?? new Date(startsAt.getTime() + 31 * 86_400_000)
  if (finalEndsAt <= startsAt) return NextResponse.json({ error: 'invalid_window' }, { status: 400 })

  const season = await db.season.create({
    data: {
      name,
      imageUrl: typeof body?.imageUrl === 'string' && body.imageUrl.trim() ? body.imageUrl.trim() : null,
      startsAt,
      endsAt: finalEndsAt,
      isActive: body?.isActive === undefined ? true : Boolean(body.isActive),
    },
  })
  await logAdminAction(gate.me.id, 'monthly_season_create', 'Season', season.id, { name })
  return NextResponse.json({ ok: true, season })
}

export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const body = await req.json().catch(() => null)
  const id = String(body?.id ?? '')
  const action = body?.action ? String(body.action) : null
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })

  const season = await db.season.findUnique({ where: { id } })
  if (!season) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // ── Action-based management: seasonal gifts + season events ──────────────
  if (action === 'add_gift' || action === 'remove_gift') {
    const itemId = String(body?.itemId ?? '')
    if (!itemId) return NextResponse.json({ error: 'item_required' }, { status: 400 })
    if (action === 'add_gift') {
      const exists = await db.gameItem.findUnique({ where: { id: itemId }, select: { id: true } })
      if (!exists) return NextResponse.json({ error: 'item_not_found' }, { status: 404 })
      await db.seasonGift.upsert({ where: { seasonId_itemId: { seasonId: id, itemId } }, create: { seasonId: id, itemId }, update: {} })
    } else {
      await db.seasonGift.deleteMany({ where: { seasonId: id, itemId } })
    }
    await logAdminAction(gate.me.id, `monthly_season_${action}`, 'Season', id, { itemId })
    return NextResponse.json({ ok: true })
  }

  if (action === 'add_event' || action === 'update_event') {
    const name = String(body?.name ?? '').trim().slice(0, 60)
    const startsAt = parseDate(body?.startsAt)
    const endsAt = parseDate(body?.endsAt)
    if (!name || !startsAt || !endsAt || endsAt <= startsAt) {
      return NextResponse.json({ error: 'invalid_event' }, { status: 400 })
    }
    const multiplier = Math.min(10, Math.max(1, Math.floor(Number(body?.multiplier ?? 1)) || 1))
    const data = {
      seasonId: id,
      name,
      emoji: String(body?.emoji ?? '✨').slice(0, 8) || '✨',
      description: typeof body?.description === 'string' && body.description.trim() ? body.description.trim().slice(0, 200) : null,
      multiplier,
      startsAt,
      endsAt,
    }
    if (action === 'add_event') {
      const ev = await db.seasonEvent.create({ data })
      await logAdminAction(gate.me.id, 'season_event_create', 'SeasonEvent', ev.id, { seasonId: id, name })
    } else {
      const eventId = String(body?.eventId ?? '')
      if (!eventId) return NextResponse.json({ error: 'event_required' }, { status: 400 })
      await db.seasonEvent.updateMany({ where: { id: eventId, seasonId: id }, data })
      await logAdminAction(gate.me.id, 'season_event_update', 'SeasonEvent', eventId, { seasonId: id })
    }
    return NextResponse.json({ ok: true })
  }

  if (action === 'remove_event') {
    const eventId = String(body?.eventId ?? '')
    if (!eventId) return NextResponse.json({ error: 'event_required' }, { status: 400 })
    await db.seasonEvent.deleteMany({ where: { id: eventId, seasonId: id } })
    await logAdminAction(gate.me.id, 'season_event_delete', 'SeasonEvent', eventId, { seasonId: id })
    return NextResponse.json({ ok: true })
  }

  // ── Plain season field update ─────────────────────────────────────────────
  const data: Record<string, unknown> = {}
  if (body?.name !== undefined) {
    const name = String(body.name).trim().slice(0, 60)
    if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })
    data.name = name
  }
  if (body?.imageUrl !== undefined) {
    data.imageUrl = typeof body.imageUrl === 'string' && body.imageUrl.trim() ? body.imageUrl.trim() : null
  }
  if (body?.startsAt !== undefined) {
    const d = parseDate(body.startsAt)
    if (!d) return NextResponse.json({ error: 'invalid_window' }, { status: 400 })
    data.startsAt = d
  }
  if (body?.endsAt !== undefined) {
    const d = parseDate(body.endsAt)
    if (!d) return NextResponse.json({ error: 'invalid_window' }, { status: 400 })
    data.endsAt = d
  }
  if (body?.isActive !== undefined) data.isActive = Boolean(body.isActive)
  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 })

  const updated = await db.season.update({ where: { id }, data: data as never })
  await logAdminAction(gate.me.id, 'monthly_season_update', 'Season', id, data)
  return NextResponse.json({ ok: true, season: updated })
}

export async function DELETE(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const id = new URL(req.url).searchParams.get('id') ?? ''
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })

  // Never delete a season that already has points history — deactivate instead.
  const hasPoints = await db.userSeason.count({ where: { seasonId: id } })
  if (hasPoints > 0) {
    await db.season.update({ where: { id }, data: { isActive: false } }).catch(() => null)
    return NextResponse.json({ error: 'has_history_deactivated', message: 'This season has player history — deactivated instead of deleted.' }, { status: 409 })
  }
  await db.season.delete({ where: { id } }).catch(() => null)
  await logAdminAction(gate.me.id, 'monthly_season_delete', 'Season', id, {})
  return NextResponse.json({ ok: true })
}
