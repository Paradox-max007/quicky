// Quicky — ADMIN REALM CONFIG (realm PRD §26/§50/§52)
// GET  /api/quicky/admin/realm-config       — the 15 realm definitions
// PATCH /api/quicky/admin/realm-config      — update threshold / cycle
//                                            duration / active / rewards
// Validation: thresholds ≥ 0, durations 1-30 days, reward place limits
// 5/3/1 (PRD §53). Threshold edits apply to FUTURE cycles — the current
// cycle's snapshot is history (§26: never rewrite earned standings).
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, logAdminAction } from '@/lib/quicky/admin'
import { ensureRealmBootstrap } from '@/lib/quicky/realm/realm-config'
import { validateRewardsConfig } from '@/lib/quicky/realm/realm-rewards'
import { DEFAULT_CRATE_PLACE_POINTS } from '@/lib/quicky/crates'

export async function GET(_req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  await ensureRealmBootstrap()
  const [defs, itemOptions] = await Promise.all([
    db.realmDefinition.findMany({ orderBy: { level: 'asc' } }),
    db.gameItem.findMany({ where: { isActive: true }, select: { id: true, name: true, emoji: true, iconType: true, iconValue: true }, orderBy: { sortOrder: 'asc' } }),
  ])
  return NextResponse.json({ realms: defs, itemOptions })
}

export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const body = await req.json().catch(() => null)
  const level = Number(body?.level)
  if (!Number.isInteger(level) || level < 1 || level > 15) {
    return NextResponse.json({ error: 'invalid_level' }, { status: 400 })
  }

  const existing = await db.realmDefinition.findUnique({ where: { level } })
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const data: Record<string, unknown> = {}
  if (body?.promotionThreshold !== undefined) {
    const t = Number(body.promotionThreshold)
    if (!Number.isInteger(t) || t < 0 || t > 1_000_000) {
      return NextResponse.json({ error: 'invalid_threshold', message: 'Threshold must be a whole number between 0 and 1,000,000.' }, { status: 400 })
    }
    data.promotionThreshold = t
  }
  if (body?.cycleDurationDays !== undefined) {
    const d = Number(body.cycleDurationDays)
    if (!Number.isInteger(d) || d < 1 || d > 30) {
      return NextResponse.json({ error: 'invalid_duration', message: 'Cycle duration must be 1-30 days.' }, { status: 400 })
    }
    data.cycleDurationDays = d
  }
  // Crate-tracks PRD — legacy flat crate points (superseded by the
  // per-placement table below; kept editable for back-compat).
  if (body?.cratePoints !== undefined) {
    const cp = Number(body.cratePoints)
    if (!Number.isInteger(cp) || cp < 0 || cp > 10_000) {
      return NextResponse.json({ error: 'invalid_crate_points', message: 'Crate points must be a whole number between 0 and 10,000.' }, { status: 400 })
    }
    data.cratePoints = cp
  }
  // Crate-tracks PRD — per-PLACEMENT crate points (1st-8th) granted when
  // this realm's cycle settles. Accepts a place→points object.
  if (body?.cratePointsByPlace !== undefined) {
    let raw: unknown = body.cratePointsByPlace
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw)
      } catch {
        raw = null
      }
    }
    const table = (raw ?? {}) as Record<string, unknown>
    const out: Record<string, number> = {}
    for (const key of Object.keys(DEFAULT_CRATE_PLACE_POINTS)) {
      const v = Number(table?.[key])
      if (!Number.isInteger(v) || v < 0 || v > 100_000) {
        return NextResponse.json({ error: 'invalid_crate_place_points', message: `Place ${key} crate points must be a whole number between 0 and 100,000.` }, { status: 400 })
      }
      out[key] = v
    }
    data.cratePointsByPlace = JSON.stringify(out)
  }
  if (body?.isActive !== undefined) data.isActive = Boolean(body.isActive)
  if (body?.rewards !== undefined) {
    const parsed = validateRewardsConfig(body.rewards)
    if (!parsed.ok) return NextResponse.json({ error: 'invalid_rewards', message: parsed.message }, { status: 400 })
    data.rewards = parsed.json
  }

  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 })

  const updated = await db.realmDefinition.update({ where: { level }, data: data as never })
  await logAdminAction(gate.me.id, 'realm_config_update', 'RealmDefinition', updated.id, { level, ...data })
  return NextResponse.json({ ok: true, realm: updated })
}
