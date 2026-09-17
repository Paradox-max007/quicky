// Quicky — Leave a Spin the Bottle room (Games PRD §14-§17 + lifecycle §5/§8/§17)
// POST /api/quicky/games/spin-bottle/leave { roomId }
//
// Games PRD §14-§17 — leaving ALWAYS works. The old 409 "finish the round
// first" lock is gone: if the leaver is the spinner or the target of an
// active round, the SERVER CANCELS the round (cancelRoundForLeaver →
// ROUND_CANCELLED realtime event) before membership ends. Seat release,
// the leave chip and the fresh snapshot then propagate to every client,
// which removes the player card and frees the seat (§14: never a stale
// card — server state is authoritative).
//
// Lifecycle transitions handled here (server-authoritative):
//   · last player left  → the room and ALL its temporary data are deleted
//     immediately (§17) — chat, membership, round state, gifts (cascade);
//   · exactly 1 player remains → their 5-minute singleton timer starts
//     (singletonStartedAt = now, §8) unless already running.
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { cancelRoomTimers, advanceTurn, cancelRoundForLeaver } from '@/lib/quicky/spin-bottle'
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

  // Mark the player as left — seat released at the SERVER first (§14).
  await db.spinRoomPlayer.update({
    where: { id: me_row.id },
    data: { leftAt: new Date(), isActive: false, connection: 'offline' },
  })

  // Games PRD §17: if I was the spinner/target, the round dies WITH me —
  // no client may keep a round alive that involves a player who is gone.
  await cancelRoundForLeaver(roomId, me.id)

  // Leave chip (v2.1 §51/§52): resolved from the EVENT data at leave time —
  // the frontend never has to guess the name after the row is gone.
  await db.spinRoomMessage.create({
    data: {
      roomId,
      userId: me.id,
      kind: 'leave',
      text: `${(await db.user.findUnique({ where: { id: me.id }, select: { name: true } }))?.name ?? 'Someone'} left`,
    },
  })

  // Games PRD §16 — typed realtime leave event (payload per §16), followed
  // by the authoritative snapshot refresh.
  emitRoomUpdate(roomId, 'PLAYER_LEFT', {
    roomId,
    userId: me.id,
    seatIndex: me_row.seatIndex,
    timestamp: new Date().toISOString(),
  })

  // Recount CURRENT active membership (lifecycle §8/§9 — never history).
  const remaining = await db.spinRoomPlayer.count({
    where: { roomId, leftAt: null, isActive: true },
  })

  if (remaining === 0) {
    // §17: a zero-player temporary room has no reason to exist — delete the
    // room AND its chat/rounds/gifts immediately (transaction-safe, §26).
    cancelRoomTimers(roomId)
    await deleteRoomCompletely(roomId)
    return NextResponse.json({ ok: true, roomDeleted: true })
  }

  if (remaining === 1) {
    // §8: the room just reached exactly one player — start/restart the
    // 5-minute singleton timer (a DB timestamp the cleanup worker checks).
    await db.spinRoom.updateMany({
      where: { id: roomId, singletonStartedAt: null },
      data: { singletonStartedAt: new Date(), lastActivityAt: new Date() },
    })
  }

  const room = await db.spinRoom.findUnique({ where: { id: roomId } })
  const activeSpin = room?.currentSpinId
    ? await db.spinBottleSpin.findUnique({ where: { id: room.currentSpinId } })
    : null
  const roundInFlight = !!activeSpin && (activeSpin.status === 'spinning' || activeSpin.status === 'awaiting')

  if (!roundInFlight) {
    // Idle between rounds → nudge the rotation so the table keeps flowing
    // (advanceTurn → beginSpin re-runs the both-gender no-spin gate).
    await advanceTurn(roomId)
  }
  emitRoomUpdate(roomId)

  return NextResponse.json({ ok: true })
}
