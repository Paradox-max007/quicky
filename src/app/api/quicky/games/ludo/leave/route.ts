// Quicky — LUDO LEAVE (Ludo PRD §41 + lifecycle §5/§8/§17)
// POST /api/quicky/games/ludo/leave { roomId }
//
// Leaving ALWAYS works (mirrors the Spin Bottle leave contract):
//   1. membership ends at the SERVER first (no ghost player — §41)
//   2. the Ludo engine removes the leaver's tokens; a pending dice is
//      discarded and the turn advances if it was theirs (§43/§44 — the
//      game never locks behind a departed player)
//   3. leave chip + typed LUDO_PLAYER_LEFT propagate to every client
//   4. last player left → the room and ALL temporary data are deleted;
//      exactly 1 player remains → the 5-minute singleton timer starts
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { cancelLudoTimers, detachLudoPlayer } from '@/lib/quicky/ludo-server'
import { deleteRoomCompletely } from '@/lib/quicky/room-cleanup'
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

  // 1. Seat released at the SERVER first (§41).
  await db.spinRoomPlayer.update({
    where: { id: me_row.id },
    data: { leftAt: new Date(), isActive: false, connection: 'offline' },
  })

  // 2. Engine-side removal: tokens off the board, dice discarded, turn
  //    advanced when needed (§41/§43/§44).
  await detachLudoPlayer(roomId, me.id)

  // 3. Leave chip (same room-chat storage — §79).
  await db.spinRoomMessage.create({
    data: {
      roomId,
      userId: me.id,
      kind: 'leave',
      text: `${(await db.user.findUnique({ where: { id: me.id }, select: { name: true } }))?.name ?? 'Someone'} left`,
    },
  })
  emitRoomUpdate(roomId, 'LUDO_PLAYER_LEFT', {
    roomId,
    userId: me.id,
    seatIndex: me_row.seatIndex,
    timestamp: new Date().toISOString(),
  })

  // 4. Lifecycle recount (same rules as the Spin Bottle room).
  const remaining = await db.spinRoomPlayer.count({
    where: { roomId, leftAt: null, isActive: true },
  })
  if (remaining === 0) {
    cancelLudoTimers(roomId)
    await deleteRoomCompletely(roomId)
    return NextResponse.json({ ok: true, roomDeleted: true })
  }
  if (remaining === 1) {
    await db.spinRoom.updateMany({
      where: { id: roomId, singletonStartedAt: null },
      data: { singletonStartedAt: new Date(), lastActivityAt: new Date() },
    })
  }
  emitRoomUpdate(roomId)
  return NextResponse.json({ ok: true })
}
