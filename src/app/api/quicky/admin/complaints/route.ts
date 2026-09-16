// Quicky — ADMIN COMPLAINTS (refactor PRD §59/§60/§80)
// GET   /api/quicky/admin/complaints   -> latest complaints with BOTH identities
// PATCH /api/quicky/admin/complaints   { id, status }
//
// §59: every record shows Reporter + Reported User with canonical IDs (names
// are snapshots). §60: admin can view, inspect, and update status
// (OPEN | REVIEWING | RESOLVED | DISMISSED). The full admin UI arrives in a
// later phase — the backend contract is live now.
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, logAdminAction } from '@/lib/quicky/admin'
import { db } from '@/lib/db'

const STATUSES = ['OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED'] as const

export async function GET(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const status = req.nextUrl.searchParams.get('status')
  const complaints = await db.report.findMany({
    where: status ? { status } : undefined,
    include: {
      reporter: { select: { id: true, name: true, phone: true, photos: { take: 1, orderBy: { position: 'asc' as const } } } },
      reported: { select: { id: true, name: true, phone: true, photos: { take: 1, orderBy: { position: 'asc' as const } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  return NextResponse.json({
    complaints: complaints.map((c) => ({
      id: c.id,
      status: c.status,
      category: c.category,
      details: c.details,
      roomId: c.roomId,
      messageId: c.messageId,
      conversationId: c.conversationId,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      reportedNameSnapshot: c.reportedNameSnapshot,
      reporter: {
        id: c.reporter.id,
        name: c.reporter.name,
        photo: c.reporter.photos[0]?.url ?? null,
      },
      reported: {
        id: c.reported.id,
        name: c.reported.name,
        photo: c.reported.photos[0]?.url ?? null,
      },
    })),
  })
}

export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const body = await req.json().catch(() => ({}))
  const id = String(body.id ?? '')
  const status = String(body.status ?? '')
  if (!id || !STATUSES.includes(status as (typeof STATUSES)[number]))
    return NextResponse.json({ error: 'id and valid status required' }, { status: 400 })

  const updated = await db.report.update({
    where: { id },
    data: { status },
  }).catch(() => null)
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await logAdminAction(gate.me.id, 'complaint_status', 'report', id, { status })
  return NextResponse.json({ ok: true })
}
