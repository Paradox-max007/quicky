// Quicky — ADMIN "How It Works" rule management (lifecycle PRD §44/§48/§49 +
// admin-console PRD §5 — per-game content)
// Gated by User.isAdmin (fresh from the DB on EVERY request — frontend
// hiding is not security, §35/§36).
//
// GET    → all rules for ?gameType= (INCLUDING inactive — the admin must be
//          able to re-activate; the player-facing endpoint filters). Defaults
//          to spin_the_bottle for backward compatibility.
// POST   → { title, description, icon?, sortOrder?, gameType? }   create
// PATCH  → { id, data { title?, description?, icon?, isActive?, sortOrder? } }
// DELETE → { id }                                                 HARD delete
//          (rules carry no transaction history — §48 "Delete a rule" maps to
//          a real delete, unlike soft-deleted gift catalog rows).
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/quicky/auth'
import { requireAdmin, logAdminAction } from '@/lib/quicky/admin'

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

export async function GET(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const gameType = cleanGameType(req.nextUrl.searchParams.get('gameType'))
  const rules = await db.gameRule.findMany({
    where: { gameType },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  })
  return NextResponse.json({ rules, gameType })
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const body = await req.json().catch(() => null)
  const data = body ?? {}
  const title = String(data.title ?? '').trim()
  const description = String(data.description ?? '').trim()
  if (!title || !description) {
    return NextResponse.json({ error: 'title_and_description_required' }, { status: 400 })
  }
  const max = await db.gameRule.aggregate({
    where: { gameType: String(data.gameType ?? 'spin_the_bottle').slice(0, 40) },
    _max: { sortOrder: true },
  })
  const created = await db.gameRule.create({
    data: {
      gameType: String(data.gameType ?? 'spin_the_bottle').slice(0, 40),
      title: title.slice(0, 60),
      description: description.slice(0, 200),
      icon: cleanIcon(data.icon) ?? '🎲',
      sortOrder: Number.isFinite(Number(data.sortOrder))
        ? Math.floor(Number(data.sortOrder))
        : (max._max.sortOrder ?? 0) + 1,
      isActive: data.isActive !== false,
    },
  })
  await logAdminAction(gate.me.id, 'create', 'game_rule', created.id, { title: created.title })
  return NextResponse.json({ ok: true, rule: created })
}

export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const body = await req.json().catch(() => null)
  const id = String(body?.id ?? '')
  const data = body?.data ?? {}
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })

  const patch: any = {}
  if (data.title !== undefined) {
    const t = String(data.title).trim()
    if (!t) return NextResponse.json({ error: 'title_required' }, { status: 400 })
    patch.title = t.slice(0, 60)
  }
  if (data.description !== undefined) {
    const d = String(data.description).trim()
    if (!d) return NextResponse.json({ error: 'description_required' }, { status: 400 })
    patch.description = d.slice(0, 200)
  }
  if (data.icon !== undefined) {
    const i = cleanIcon(data.icon)
    if (i) patch.icon = i
  }
  if (data.isActive !== undefined) patch.isActive = !!data.isActive
  if (data.sortOrder !== undefined) patch.sortOrder = Math.floor(Number(data.sortOrder)) || 0
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 })

  const updated = await db.gameRule.update({ where: { id }, data: patch }).catch(() => null)
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
  const gone = await db.gameRule.delete({ where: { id } }).catch(() => null)
  if (!gone) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  await logAdminAction(gate.me.id, 'delete', 'game_rule', id, { title: gone.title })
  return NextResponse.json({ ok: true })
}
