// Quicky — COMPLAINTS (refactor PRD §57/§58/§59/§80)
// POST /api/quicky/complaints
//   { reportedUserId, reason, description?, roomId?, messageId?, conversationId? }
//
// Reuses the existing Report table (§76: no duplicate tables) extended with
// the PRD §58 fields (name snapshot, origin context, OPEN/REVIEWING/RESOLVED/
// DISMISSED statuses). Reporter + reported IDs are stored as canonical
// relations; the reported display name is snapshotted for historical
// accuracy (§59). The admin API (§60) is prepared in
// /api/quicky/admin/complaints.
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

const REASONS = [
  'harassment',
  'spam',
  'fake',
  'inappropriate',
  'underage',
  'other',
] as const

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const reportedUserId = String(body.reportedUserId ?? '')
  const reason = String(body.reason ?? 'other')
  const description = String(body.description ?? '').slice(0, 2000)
  const roomId = body.roomId ? String(body.roomId) : null
  const messageId = body.messageId ? String(body.messageId) : null
  const conversationId = body.conversationId ? String(body.conversationId) : null

  if (!reportedUserId) return NextResponse.json({ error: 'reportedUserId required' }, { status: 400 })
  if (reportedUserId === me.id)
    return NextResponse.json({ error: 'Cannot complain about yourself' }, { status: 400 })
  if (!REASONS.includes(reason as (typeof REASONS)[number]))
    return NextResponse.json({ error: 'Invalid reason' }, { status: 400 })

  const reported = await db.user.findUnique({
    where: { id: reportedUserId },
    select: { id: true, name: true },
  })
  if (!reported) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Light anti-spam guard: at most 30 OPEN complaints per reporter.
  const openCount = await db.report.count({ where: { reporterId: me.id, status: 'OPEN' } })
  if (openCount >= 30)
    return NextResponse.json({ error: 'Too many open complaints' }, { status: 429 })

  const complaint = await db.report.create({
    data: {
      reporterId: me.id,
      reportedId: reportedUserId,
      reportedNameSnapshot: reported.name,
      category: reason,
      details: description,
      roomId,
      messageId,
      conversationId,
      status: 'OPEN',
    },
  })

  return NextResponse.json({ ok: true, complaintId: complaint.id }, { status: 201 })
}
