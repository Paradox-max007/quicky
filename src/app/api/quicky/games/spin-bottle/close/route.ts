// Quicky — Admin / abandoned-room close
// POST /api/quicky/games/spin-bottle/close { roomId }
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { cancelRoomTimers } from '@/lib/quicky/spin-bottle'

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
  await db.spinRoomPlayer.updateMany({
    where: { roomId, leftAt: null },
    data: { leftAt: new Date(), isActive: false, connection: 'offline' },
  })
  await db.spinRoom.update({
    where: { id: roomId },
    data: { status: 'CLOSING', lastActivityAt: new Date() },
  })
  return NextResponse.json({ ok: true })
}
