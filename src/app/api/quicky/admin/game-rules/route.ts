// Quicky — ADMIN "How It Works" rule management (lifecycle PRD §44/§48/§49 +
// admin-console PRD §5 — per-game content)
// Gated by User.isAdmin (fresh from the DB on EVERY request — frontend
// hiding is not security, §35/§36).
//
// GET    → all rules for ?gameType= (INCLUDING inactive + DRAFT ones — the
//          admin must be able to re-activate/publish; the player-facing
//          endpoint filters). Defaults to spin_the_bottle for compatibility.
// POST   → { title, description, icon?, sortOrder?, gameType?, status? }  create
//          status DRAFT allows a staged step with a missing description;
//          PUBLISHED (the default) requires non-empty title AND description
//          (admin-console PRD §5.1 — "prevent empty or invalid content from
//          being published").
// PATCH  → { id, data { title?, description?, icon?, isActive?, sortOrder?,
//          status? } }   OR   { id, move: 'up' | 'down' }  — swap the step
//          with its neighbor in the same game (admin-console PRD §5.1 +
//          §18.1 "move-up and move-down controls"; the order persists).
// DELETE → { id }                                                 HARD delete
//          (rules carry no transaction history — §48 "Delete a rule" maps to
//          a real delete, unlike soft-deleted gift catalog rows).
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, logAdminAction } from '@/lib/quicky/admin'
import { isPrismaSchemaDrift, SCHEMA_SYNC_HINT } from '@/lib/quicky/prisma-sync'

/** Drift-hardening (commit 8470343 pattern): a half-synced machine must see
 * the REMEDY, not a cryptic 500. Returns the hint response on drift, else
 * null (rethrow at the call site). */
function driftGuard(err: unknown): NextResponse | null {
  if (!isPrismaSchemaDrift(err)) return null
  return NextResponse.json({ error: 'schema_out_of_sync', message: SCHEMA_SYNC_HINT }, { status: 500 })
}

const cleanIcon = (v: unknown): string | undefined => {
  if (v === undefined) return undefined
  const s = String(v).trim()
  if (!s) return undefined
  return Array.from(s).slice(0, 4).join('') // ≤4 glyphs, emoji-safe
}

const cleanGameType = (v: unknown): string => {
  const s = String(v ?? '').trim().toLowerCase().slice(0, 40)
  return s || 'spin_the_bottle'
}

const cleanStatus = (v: unknown): string | undefined => {
  if (v === undefined) return undefined
  const s = String(v).trim().toUpperCase()
  return s === 'DRAFT' || s === 'PUBLISHED' ? s : undefined
}

export async function GET(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const gameType = cleanGameType(req.nextUrl.searchParams.get('gameType'))
  let rules
  try {
    rules = await db.gameRule.findMany({
      where: { gameType },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })
  } catch (err) {
    const hint = driftGuard(err)
    if (hint) return hint
    throw err
  }
  return NextResponse.json({ rules, gameType })
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const body = await req.json().catch(() => null)
  const data = body ?? {}
  const gameType = cleanGameType(data.gameType)
  const title = String(data.title ?? '').trim()
  const description = String(data.description ?? '').trim()
  const status = cleanStatus(data.status) ?? 'PUBLISHED'
  if (!title) return NextResponse.json({ error: 'title_required' }, { status: 400 })
  if (status === 'PUBLISHED' && !description) {
    // admin-console PRD §5.1 — empty content can't be PUBLISHED (drafts can).
    return NextResponse.json({ error: 'description_required_to_publish' }, { status: 400 })
  }
  const max = await db.gameRule.aggregate({
    where: { gameType },
    _max: { sortOrder: true },
  })
  let created
  try {
    created = await db.gameRule.create({
      data: {
        gameType,
        title: title.slice(0, 60),
        // A draft may temporarily miss its description — fill with an empty
        // string until it is published (publish re-validates).
        description: (description || '—').slice(0, 200),
        icon: cleanIcon(data.icon) ?? '🎲',
        sortOrder: Number.isFinite(Number(data.sortOrder))
          ? Math.floor(Number(data.sortOrder))
          : (max._max.sortOrder ?? 0) + 1,
        isActive: data.isActive !== false,
        status,
      },
    })
  } catch (err) {
    const hint = driftGuard(err)
    if (hint) return hint
    throw err
  }
  await logAdminAction(gate.me.id, 'create', 'game_rule', created.id, { title: created.title, status })
  return NextResponse.json({ ok: true, rule: created })
}

export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const body = await req.json().catch(() => null)
  const id = String(body?.id ?? '')
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })

  // ── Reorder: { id, move: 'up' | 'down' } (admin-console PRD §5.1/§18.1) ──
  const move = body?.move
  if (move === 'up' || move === 'down') {
    let target
    try {
      target = await db.gameRule.findUnique({ where: { id } })
    } catch (err) {
      const hint = driftGuard(err)
      if (hint) return hint
      throw err
    }
    if (!target) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const siblings = await db.gameRule.findMany({
      where: { gameType: target.gameType },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, sortOrder: true },
    })
    const idx = siblings.findIndex((s) => s.id === id)
    if (idx < 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const swapIdx = move === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= siblings.length) {
      return NextResponse.json({ ok: true, moved: false }) // already at the end
    }

    // Ties on sortOrder make a pure swap ambiguous — re-sequence the whole
    // game's steps to 0..n-1 first (the admin list order IS the display
    // order, §49), then apply the swap on the clean sequence.
    await db.$transaction(async (tx) => {
      const rows = siblings.map((s, i) => ({ id: s.id, order: i }))
      for (const row of rows) {
        await tx.gameRule.update({ where: { id: row.id }, data: { sortOrder: row.order } })
      }
      const a = rows[idx].order
      const b = rows[swapIdx].order
      await tx.gameRule.update({ where: { id: siblings[idx].id }, data: { sortOrder: b } })
      await tx.gameRule.update({ where: { id: siblings[swapIdx].id }, data: { sortOrder: a } })
    })
    await logAdminAction(gate.me.id, 'reorder', 'game_rule', id, { gameType: target.gameType, move })
    return NextResponse.json({ ok: true, moved: true })
  }

  // ── Regular field patch ──
  const data = body?.data ?? {}
  const patch: any = {}
  if (data.title !== undefined) {
    const t = String(data.title).trim()
    if (!t) return NextResponse.json({ error: 'title_required' }, { status: 400 })
    patch.title = t.slice(0, 60)
  }
  // Current row — needed for draft-aware validation (loaded lazily).
  let current: { title: string; description: string; status: string } | null = null
  const driftError = { response: null as NextResponse | null }
  const loadCurrent = async () => {
    if (current === null && driftError.response === null) {
      current = await db.gameRule
        .findUnique({ where: { id }, select: { title: true, description: true, status: true } })
        .catch((err: unknown) => {
          const hint = driftGuard(err)
          if (hint) {
            driftError.response = hint
            return null
          }
          return null
        })
    }
    return current
  }
  if (data.description !== undefined) {
    const d = String(data.description).trim()
    if (!d) {
      // An empty description is only storable on a DRAFT step (the placeholder
      // '—' is replaced the moment it gets real copy or is published).
      const row = await loadCurrent()
      if (driftError.response) return driftError.response
      const resultingStatus = cleanStatus(data.status) ?? row?.status
      if (resultingStatus !== 'DRAFT') {
        return NextResponse.json({ error: 'description_required' }, { status: 400 })
      }
      patch.description = '—'
    } else {
      patch.description = d.slice(0, 200)
    }
  }
  if (data.icon !== undefined) {
    const i = cleanIcon(data.icon)
    if (i) patch.icon = i
  }
  if (data.isActive !== undefined) patch.isActive = !!data.isActive
  if (data.sortOrder !== undefined) patch.sortOrder = Math.floor(Number(data.sortOrder)) || 0
  if (data.status !== undefined) {
    const s = cleanStatus(data.status)
    if (!s) return NextResponse.json({ error: 'invalid_status' }, { status: 400 })
    patch.status = s
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 })

  // Publishing validation — decide on the MERGED row (existing + patch), so
  // an empty draft can't be flipped to PUBLISHED by a status-only PATCH.
  if (patch.status === 'PUBLISHED') {
    const row = await loadCurrent()
    if (driftError.response) return driftError.response
    if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const finalDescription = String(patch.description ?? row.description).trim()
    if (!String(patch.title ?? row.title).trim() || !finalDescription || finalDescription === '—') {
      return NextResponse.json({ error: 'description_required_to_publish' }, { status: 400 })
    }
  }

  let updated
  try {
    updated = await db.gameRule.update({ where: { id }, data: patch })
  } catch (err) {
    const hint = driftGuard(err)
    if (hint) return hint
    // P2025 (record not found) surfaces as a null-equivalent → 404 below.
    const code = (err as { code?: string })?.code
    if (code !== 'P2025') throw err
    updated = null
  }
  if (!updated) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  await logAdminAction(gate.me.id, 'update', 'game_rule', id, patch)
  return NextResponse.json({ ok: true, rule: updated })
}

export async function DELETE(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const body = await req.json().catch(() => null)
  const id = String(body?.id ?? '')
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })
  let gone
  try {
    gone = await db.gameRule.delete({ where: { id } })
  } catch (err) {
    const hint = driftGuard(err)
    if (hint) return hint
    const code = (err as { code?: string })?.code
    if (code !== 'P2025') throw err
    gone = null
  }
  if (!gone) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  await logAdminAction(gate.me.id, 'delete', 'game_rule', id, { title: gone.title })
  return NextResponse.json({ ok: true })
}
