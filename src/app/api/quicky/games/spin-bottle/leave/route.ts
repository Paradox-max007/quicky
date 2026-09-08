// Quicky — Leave a Spin the Bottle room
// POST /api/quicky/games/spin-bottle/leave { roomId }
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { cancelRoomTimers, advanceTurn } from '@/lib/quicky/spin-bottle'

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const roomId = String(body?.roomId ?? '')
  if (!roomId) return NextResponse.json({ error: 'roomId required' }, { status: 400 })

  const me_row = await db.spinRoomPlayer.findFirst({
    where: { roomId, userId: me.id, leftAt: null },
  })
  if (!me_row) return NextResponse.json({ ok: true, alreadyLeft: true })

  // Mark the player as left
  await db.spinRoomPlayer.update({
    where: { id: me_row.id },
    data: { leftAt: new Date(), isActive: false, connection: 'offline' },
  })

  // If I was the current spinner, the awaiting spin (if any) needs to be
  // resolved so the room doesn't stall.
  const room = await db.spinRoom.findUnique({ where: { id: roomId } })
  if (room?.currentSpinId) {
    const spin = await db.spinBottleSpin.findUnique({ where: { id: room.currentSpinId } })
    if (spin && spin.spinnerId === me.id && spin.status !== 'completed') {
      await db.spinBottleSpin.update({
        where: { id: spin.id },
        data: { status: 'completed', response: 'timeout', completedAt: new Date() },
      })
      await db.spinBottleEvent.create({
        data: { spinId: spin.id, kind: 'kiss_timeout', toUserId: spin.targetId },
      })
      await db.spinRoomMessage.create({
        data: {
          roomId,
          userId: me.id,
          kind: 'system',
          text: '⏰ The spinner left — skipping their turn.',
        },
      })
    }
  }

  // If the room is now empty, close it
  const remaining = await db.spinRoomPlayer.count({
    where: { roomId, leftAt: null, isActive: true },
  })
  if (remaining === 0) {
    cancelRoomTimers(roomId)
    await db.spinRoom.update({ where: { id: roomId }, data: { status: 'CLOSING', lastActivityAt: new Date() } })
  } else {
    // Otherwise advance the turn so the room keeps flowing
    await advanceTurn(roomId)
  }

  return NextResponse.json({ ok: true })
}
