// Quicky — Room closure status (lifecycle PRD §27/§28/§29)
// GET /api/quicky/games/spin-bottle/room-status?roomId=...
//
// The client calls this the moment its room disappears (SSE `room_gone` or a
// 404 on the recovery poll). It answers WHY, from the SpinRoomClosure
// receipts written by the cleanup worker BEFORE the room was deleted:
//   singleton  → "This room was closed because no other players joined." (§28)
//   inactivity → "You were removed from the room due to inactivity."     (§29)
//   closed     → generic "This room was closed."
// The room itself no longer exists at this point, so nothing here may touch
// SpinRoom rows (they are gone — receipts are the only survivor).
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

const RECEIPT_WINDOW_MS = 10 * 60_000

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const roomId = req.nextUrl.searchParams.get('roomId') ?? ''
  if (!roomId) return NextResponse.json({ error: 'roomId required' }, { status: 400 })

  const room = await db.spinRoom.findUnique({ where: { id: roomId }, select: { id: true } })

  if (room) {
    // The room still exists — figure out whether I am still in it.
    const member = await db.spinRoomPlayer.findFirst({
      where: { roomId, userId: me.id, leftAt: null, isActive: true },
      select: { id: true },
    })
    if (member) return NextResponse.json({ closed: false, exists: true, amMember: true })
    // Room exists but I am no longer an active member → I was auto-removed
    // (inactivity) while the room lives on.
    const receipt = await db.spinRoomClosure.findFirst({
      where: { roomId, userId: me.id, createdAt: { gte: new Date(Date.now() - RECEIPT_WINDOW_MS) } },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({
      closed: true,
      exists: true,
      amMember: false,
      reason: receipt?.reason ?? 'closed',
    })
  }

  // Room is gone — read the freshest receipt for this user + room.
  const receipt = await db.spinRoomClosure.findFirst({
    where: { roomId, userId: me.id, createdAt: { gte: new Date(Date.now() - RECEIPT_WINDOW_MS) } },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({
    closed: true,
    exists: false,
    amMember: false,
    reason: receipt?.reason ?? 'closed',
  })
}
