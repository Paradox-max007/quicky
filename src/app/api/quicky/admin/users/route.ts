// Quicky — ADMIN USER management (Games PRD §66)
// GET   /api/quicky/admin/users?q=   → searchable user list (read-only fields
//                                      relevant to moderation + economy)
// PATCH /api/quicky/admin/users      → { id, isAdmin } role toggle
// Server-side permission checks only (§105/§66) — never client state. Every
// mutation writes an AdminAuditLog row (§67).
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, logAdminAction } from '@/lib/quicky/admin'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const q = req.nextUrl.searchParams.get('q')?.trim() ?? ''
  const users = await db.user.findMany({
    where: q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q } },
          ],
        }
      : undefined,
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      gender: true,
      isAdmin: true,
      isPremium: true,
      coinBalance: true,
      kissPoints: true,
      gamesPlayed: true,
      quickyScore: true,
      giftsSentCount: true,
      giftsReceivedCount: true,
      createdAt: true,
      _count: { select: { photos: true } },
    },
  })

  return NextResponse.json({ users })
}

export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const body = await req.json().catch(() => null)
  const id = String(body?.id ?? '')
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })
  if (typeof body?.isAdmin !== 'boolean') {
    return NextResponse.json({ error: 'isAdmin_required' }, { status: 400 })
  }
  if (id === gate.me.id && body.isAdmin === false) {
    // An admin cannot demote themselves — avoids an lock-out accident.
    return NextResponse.json({ error: 'cannot_demote_self' }, { status: 400 })
  }

  const updated = await db.user
    .update({ where: { id }, data: { isAdmin: body.isAdmin }, select: { id: true, name: true, isAdmin: true } })
    .catch(() => null)
  if (!updated) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await logAdminAction(gate.me.id, body.isAdmin ? 'ADMIN_GRANTED' : 'ADMIN_REVOKED', 'user', id, {
    name: updated.name,
  })
  return NextResponse.json({ ok: true, user: updated })
}
