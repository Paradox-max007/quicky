// Quicky — Admin / abandoned-room close
// POST /api/quicky/games/spin-bottle/close { roomId }
//
// Lifecycle PRD §17: an explicitly closed room is deleted immediately —
// status flags alone would leave a husk behind for the cleanup worker. All
// members are deactivated first, then the room + chat + rounds + gifts are
// cascade-deleted inside one guarded transaction.
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { cancelRoomTimers } from '@/lib/quicky/spin-bottle'
import { deleteRoomCompletely, recordClosure } from '@/lib/quicky/room-cleanup'

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const roomId = String(body?.roomId ?? '')
  if (!roomId) return NextResponse.json({ error: 'roomId required' }, { status: 400 })

  const member = await db.spinRoomPlayer.findFirst({
    where: { roomId, userId: me.id, leftAt: null },
  })
  if (!member) return NextResponse.json({ error: 'Not in room' }, { status: 403 })

  cancelRoomTimers(roomId)
  // Deactivate everyone, then delete the room + all temporary data (§18).
  const others = await db.spinRoomPlayer.findMany({
    where: { roomId, leftAt: null, isActive: true, userId: { not: me.id } },
    select: { userId: true },
  })
  await db.spinRoomPlayer.updateMany({
    where: { roomId, leftAt: null },
    data: { leftAt: new Date(), isActive: false, connection: 'offline' },
  })
  // Closure receipts so everyone still holding the room UI gets a proper
  // "room closed" dialog instead of a stale table (§27).
  await recordClosure(roomId, others.map((o) => o.userId), 'closed')
  await deleteRoomCompletely(roomId)
  return NextResponse.json({ ok: true, roomDeleted: true })
}
