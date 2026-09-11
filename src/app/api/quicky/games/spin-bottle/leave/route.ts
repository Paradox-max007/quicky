// Quicky — Leave a Spin the Bottle room (PRD §9/§66/§67)
// POST /api/quicky/games/spin-bottle/leave { roomId }
//
// Room lock: while a round is SPINNING/AWAITING, its spinner and target are
// locked — the server refuses their leave with 409 ("Finish the current
// round first"). Spectators may leave any time. Crash/disconnect recovery
// never depends on this endpoint: the response-deadline watchdog resolves
// every round within 10s even if a participant simply vanishes.
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { cancelRoomTimers, advanceTurn, activeRoundParticipant } from '@/lib/quicky/spin-bottle'
import { emitRoomUpdate } from '@/lib/quicky/spin-events'

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

  // ROOM LOCK — active-round participants cannot walk away mid-round (§66).
  if (await activeRoundParticipant(roomId, me.id)) {
    return NextResponse.json(
      { error: 'Finish the current round first.' },
      { status: 409 }
    )
  }

  // Mark the player as left
  await db.spinRoomPlayer.update({
    where: { id: me_row.id },
    data: { leftAt: new Date(), isActive: false, connection: 'offline' },
  })

  // Room empty → close it
  const remaining = await db.spinRoomPlayer.count({
    where: { roomId, leftAt: null, isActive: true },
  })
  if (remaining === 0) {
    cancelRoomTimers(roomId)
    await db.spinRoom.update({ where: { id: roomId }, data: { status: 'CLOSING', lastActivityAt: new Date() } })
    return NextResponse.json({ ok: true })
  }

  const room = await db.spinRoom.findUnique({ where: { id: roomId } })
  const activeSpin = room?.currentSpinId
    ? await db.spinBottleSpin.findUnique({ where: { id: room.currentSpinId } })
    : null
  const roundInFlight = !!activeSpin && (activeSpin.status === 'spinning' || activeSpin.status === 'awaiting')

  if (!roundInFlight) {
    // Idle between rounds → nudge the rotation so the table keeps flowing
    await advanceTurn(roomId)
  }
  emitRoomUpdate(roomId)

  return NextResponse.json({ ok: true })
}
