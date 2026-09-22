// Quicky — ADMIN SEASONS (admin-console PRD §7/§14)
// GET/POST/PATCH/DELETE /api/quicky/admin/seasons
//
// Seasons sit above the 15-realm ladder; each can override realm names
// ("different seasons can have different realm names"). Player rollover to
// season N+1 happens server-side at settlement.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, logAdminAction } from '@/lib/quicky/admin'
import { validateRealmNameOverrides } from '@/lib/quicky/realm/realm-seasons'

export const dynamic = 'force-dynamic'

export async function GET() {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const [seasons, progress] = await Promise.all([
    db.realmSeason.findMany({ orderBy: { seasonNumber: 'asc' } }),
    db.userRealm.groupBy({ by: ['seasonNumber'], _count: { _all: true } }),
  ])
  const playersBy = new Map(progress.map((p) => [p.seasonNumber, p._count._all]))
  return NextResponse.json({
    seasons: seasons.map((s) => ({
      id: s.id,
      seasonNumber: s.seasonNumber,
      name: s.name,
      description: s.description,
      realmNameOverrides: s.realmNameOverrides ? safeParse(s.realmNameOverrides) : {},
      isActive: s.isActive,
      players: playersBy.get(s.seasonNumber) ?? 0,
      createdAt: s.createdAt.toISOString(),
    })),
  })
}

function safeParse(json: string): Record<string, string> {
  try {
    return JSON.parse(json) as Record<string, string>
  } catch {
    return {}
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const body = await req.json().catch(() => null)
  const name = String(body?.name ?? '').trim()
  const seasonNumber = Number(body?.seasonNumber)
  if (!name || name.length > 60) return NextResponse.json({ error: 'name_required' }, { status: 400 })
  if (!Number.isInteger(seasonNumber) || seasonNumber < 1 || seasonNumber > 999) {
    return NextResponse.json({ error: 'invalid_season_number' }, { status: 400 })
  }
  const overrides = validateRealmNameOverrides(body?.realmNameOverrides)
  if (!overrides.ok) return NextResponse.json({ error: 'invalid_overrides', message: overrides.message }, { status: 400 })

  const clash = await db.realmSeason.findUnique({ where: { seasonNumber } }).catch(() => null)
  if (clash) return NextResponse.json({ error: 'season_number_taken' }, { status: 409 })

  const created = await db.realmSeason
    .create({
      data: {
        seasonNumber,
        name: name.slice(0, 60),
        description: body?.description ? String(body.description).slice(0, 300) : null,
        realmNameOverrides: overrides.json,
        isActive: body?.isActive === true,
      },
    })
    .catch(() => null)
  if (!created) return NextResponse.json({ error: 'create_failed' }, { status: 500 })
  await logAdminAction(gate.me.id, 'create', 'realm_season', created.id, { name, seasonNumber })
  return NextResponse.json({ ok: true, season: created })
}

export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const body = await req.json().catch(() => null)
  const id = String(body?.id ?? '')
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })
  const patch: Record<string, unknown> = {}
  if (body?.data?.name !== undefined) {
    const name = String(body.data.name).trim()
    if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })
    patch.name = name.slice(0, 60)
  }
  if (body?.data?.description !== undefined) patch.description = body.data.description ? String(body.data.description).slice(0, 300) : null
  if (body?.data?.isActive !== undefined) patch.isActive = !!body.data.isActive
  if (body?.data?.realmNameOverrides !== undefined) {
    const overrides = validateRealmNameOverrides(body.data.realmNameOverrides)
    if (!overrides.ok) return NextResponse.json({ error: 'invalid_overrides', message: overrides.message }, { status: 400 })
    patch.realmNameOverrides = overrides.json
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 })

  const updated = await db.realmSeason.update({ where: { id }, data: patch }).catch(() => null)
  if (!updated) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  await logAdminAction(gate.me.id, 'update', 'realm_season', id, patch)
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const body = await req.json().catch(() => null)
  const id = String(body?.id ?? '')
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })
  const season = await db.realmSeason.findUnique({ where: { id } })
  if (!season) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (season.seasonNumber === 1) return NextResponse.json({ error: 'cannot_delete_season_1' }, { status: 400 })
  const players = await db.userRealm.count({ where: { seasonNumber: season.seasonNumber } })
  if (players > 0) {
    await db.realmSeason.update({ where: { id }, data: { isActive: false } })
    await logAdminAction(gate.me.id, 'disable', 'realm_season', id, { players })
    return NextResponse.json({ ok: true, disabled: true, players })
  }
  await db.realmSeason.delete({ where: { id } }).catch(() => null)
  await logAdminAction(gate.me.id, 'delete', 'realm_season', id, { name: season.name })
  return NextResponse.json({ ok: true, disabled: false })
}
