// Quicky — Spin the Bottle room chat
// GET  /api/quicky/games/spin-bottle/chat?roomId=...   → recent 80
// POST /api/quicky/games/spin-bottle/chat  { roomId, text }
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { touchMemberActivity } from '@/lib/quicky/room-activity'

const RATE_LIMIT_MS = 1500

// A naive per-user rate limit (kept in-memory — fine for V1 single-process).
const lastSentAt = new Map<string, number>()

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const roomId = req.nextUrl.searchParams.get('roomId') ?? ''
  if (!roomId) return NextResponse.json({ error: 'roomId required' }, { status: 400 })

  const member = await db.spinRoomPlayer.findFirst({ where: { roomId, userId: me.id, leftAt: null } })
  if (!member) return NextResponse.json({ error: 'Not in room' }, { status: 403 })

  const msgs = await db.spinRoomMessage.findMany({
    where: { roomId, kind: 'user' },
    orderBy: { createdAt: 'desc' },
    take: 80,
    include: { user: { select: { name: true, id: true } } },
  })
  return NextResponse.json({
    messages: msgs.reverse().map((m) => ({
      id: m.id,
      userId: m.userId,
      text: m.text,
      kind: m.kind,
      createdAt: m.createdAt.toISOString(),
      author: { id: m.user.id, name: m.user.name },
    })),
  })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const roomId = String(body?.roomId ?? '')
  const text = String(body?.text ?? '').trim().slice(0, 280)
  if (!roomId || !text) return NextResponse.json({ error: 'roomId + text required' }, { status: 400 })

  const member = await db.spinRoomPlayer.findFirst({ where: { roomId, userId: me.id, leftAt: null } })
  if (!member) return NextResponse.json({ error: 'Not in room' }, { status: 403 })

  // Block basic slurs/links for V1 — full moderation in V1.1
  if (/(https?:\/\/|www\.)/i.test(text)) {
    return NextResponse.json({ error: 'Links are not allowed in room chat' }, { status: 400 })
  }

  const last = lastSentAt.get(me.id) ?? 0
  if (Date.now() - last < RATE_LIMIT_MS) {
    return NextResponse.json({ error: 'Slow down a bit' }, { status: 429 })
  }
  lastSentAt.set(me.id, Date.now())

  const created = await db.spinRoomMessage.create({
    data: { roomId, userId: me.id, text, kind: 'user' },
    include: { user: { select: { name: true, id: true } } },
  })
  await db.spinRoom.update({ where: { id: roomId }, data: { lastActivityAt: new Date() } })
  // Lifecycle §12: sending a chat message counts as room activity.
  await touchMemberActivity(roomId, me.id).catch(() => {})

  return NextResponse.json({
    ok: true,
    message: {
      id: created.id,
      userId: created.userId,
      text: created.text,
      kind: created.kind,
      createdAt: created.createdAt.toISOString(),
      author: { id: created.user.id, name: created.user.name },
    },
  })
}
