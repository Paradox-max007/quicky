// Quicky — Spin the Bottle matchmaking (Games PRD §3-§11)
// POST /api/quicky/games/spin-bottle/join
//
// The SERVER is the sole authority on room + seat assignment (§7/§9/§71):
//   Step 1  determine the user's gender from the authenticated profile
//   Step 2  find active Spin the Bottle rooms
//   Step 3  filter rooms with a FREE seat whose gender slot matches
//   Step 4  rank candidates (existing players → occupancy → recency → random)
//   Step 5  claim the seat ATOMICALLY (gender capacity re-checked inside the
//           transaction, §10 — concurrent joins can never take the same seat
//           or overflow a gender)
//   Step 6  no candidate validated → fresh 6M+6F room
//
// Room-lifecycle integration (lifecycle PRD §4-§8) is preserved: the lazy
// cleanup sweep runs first, a fresh room starts its 5-minute singleton timer,
// the timer clears the moment the room reaches ≥ 2 players, and the spin
// loop starts only through the server's no-spin gate (§11: both genders).
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { buildRoomSnapshot } from '@/lib/quicky/spin-snapshot'
import { startSpinLoop } from '@/lib/quicky/spin-bottle'
import { emitRoomUpdate } from '@/lib/quicky/spin-events'
import { maybeRunCleanupLazy } from '@/lib/quicky/room-cleanup'
import {
  assignRoomAndSeat,
  endOtherMemberships,
  activePlayerCount,
  normalizeGender,
} from '@/lib/quicky/room-assignment'

export async function POST(_req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Lifecycle §4: reclaim abandoned rooms BEFORE hunting for a table.
  maybeRunCleanupLazy()

  // §7 Step 1 — gender from the authenticated profile (server-side).
  const profile = await db.user.findUnique({
    where: { id: me.id },
    select: { name: true, gender: true },
  })
  const seatGender = normalizeGender(profile?.gender)

  const joinChip = async (roomId: string) => {
    await db.spinRoomMessage.create({
      data: {
        roomId,
        userId: me.id,
        kind: 'join',
        text: `${profile?.name ?? 'Someone'} joined`,
      },
    })
  }

  // 1. End any other active SpinRoomPlayer rows for this user
  await endOtherMemberships(me.id)

  // 2-6. Gender-aware, race-safe assignment (§7-§10)
  const claim = await assignRoomAndSeat({ userId: me.id, seatGender })
  const roomId = claim.roomId
  await joinChip(roomId)
  emitRoomUpdate(roomId) // players_changed — SSE subscribers refresh instantly

  // 7. ≥ 2 active players → clear the singleton timer + start the loop
  //    (startSpinLoop → beginSpin enforces the both-gender gate, §11).
  const playersCount = await activePlayerCount(roomId)
  const roomRow = await db.spinRoom.findUnique({ where: { id: roomId } })
  if (playersCount >= 2) {
    await db.spinRoom.updateMany({
      where: { id: roomId, singletonStartedAt: { not: null } },
      data: { singletonStartedAt: null },
    })
    if (roomRow && (roomRow.status === 'WAITING' || roomRow.status === 'STARTING')) {
      await startSpinLoop(roomId)
    }
  }

  const snapshot = await buildRoomSnapshot(roomId, me.id)
  return NextResponse.json({ ok: true, roomId, createdNewRoom: claim.createdNewRoom, snapshot })
}
