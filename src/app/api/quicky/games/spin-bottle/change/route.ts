// Quicky — Change Table (Games PRD §9)
// POST /api/quicky/games/spin-bottle/change { roomId }
//
// The client NEVER makes the final room assignment decision (§9). Change
// Table runs the EXACT same server algorithm as Play Now — find active
// rooms → free gender-compatible seat → capacity → room state → assign —
// except the current room is excluded from the candidates. The old
// client-orchestrated "leave → random join" flow is gone; this endpoint
// atomically leaves the old room and claims the new seat in one call.
//
// A round participant may still change tables: leaving cancels the round
// server-side (PRD §14-§17), so there is no 409 lock here either.
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { buildRoomSnapshot } from '@/lib/quicky/spin-snapshot'
import { startSpinLoop, cancelRoomTimers } from '@/lib/quicky/spin-bottle'
import { emitRoomUpdate } from '@/lib/quicky/spin-events'
import { maybeRunCleanupLazy, deleteRoomCompletely } from '@/lib/quicky/room-cleanup'
import {
  assignRoomAndSeat,
  endOtherMemberships,
  activePlayerCount,
  normalizeGender,
} from '@/lib/quicky/room-assignment'

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const currentRoomId = String(body?.roomId ?? '')
  if (!currentRoomId) return NextResponse.json({ error: 'roomId required' }, { status: 400 })

  maybeRunCleanupLazy()

  const membership = await db.spinRoomPlayer.findFirst({
    where: { roomId: currentRoomId, userId: me.id, leftAt: null, isActive: true },
  })
  if (!membership) return NextResponse.json({ error: 'not_in_room' }, { status: 403 })

  const profile = await db.user.findUnique({
    where: { id: me.id },
    select: { name: true, gender: true },
  })
  const seatGender = normalizeGender(profile?.gender)

  // 1. Leave the current table (seat release + PLAYER_LEFT event).
  await endOtherMemberships(me.id)
  await db.spinRoomMessage.create({
    data: { roomId: currentRoomId, userId: me.id, kind: 'leave', text: `${profile?.name ?? 'Someone'} left` },
  })
  emitRoomUpdate(currentRoomId, 'PLAYER_LEFT', {
    roomId: currentRoomId,
    userId: me.id,
    seatIndex: membership.seatIndex,
    timestamp: new Date().toISOString(),
  })
  emitRoomUpdate(currentRoomId)

  // 2. Same algorithm as join, excluding the current room (§9).
  const claim = await assignRoomAndSeat({
    userId: me.id,
    seatGender,
    excludeRoomId: currentRoomId,
  })
  await db.spinRoomMessage.create({
    data: { roomId: claim.roomId, userId: me.id, kind: 'join', text: `${profile?.name ?? 'Someone'} joined` },
  })
  emitRoomUpdate(claim.roomId)

  // 3. Start the loop when the new table has ≥ 2 players (gate in beginSpin).
  const playersCount = await activePlayerCount(claim.roomId)
  const roomRow = await db.spinRoom.findUnique({ where: { id: claim.roomId } })
  if (playersCount >= 2 && roomRow && (roomRow.status === 'WAITING' || roomRow.status === 'STARTING')) {
    await db.spinRoom.updateMany({
      where: { id: claim.roomId, singletonStartedAt: { not: null } },
      data: { singletonStartedAt: null },
    })
    await startSpinLoop(claim.roomId)
  }

  // 4. Lifecycle housekeeping for the room we left — identical transitions
  //    to the leave endpoint: 0 players → delete the room completely;
  //    exactly 1 player → (re)start its 5-minute singleton timer.
  const remaining = await db.spinRoomPlayer.count({
    where: { roomId: currentRoomId, leftAt: null, isActive: true },
  })
  if (remaining === 0) {
    cancelRoomTimers(currentRoomId)
    await deleteRoomCompletely(currentRoomId).catch(() => {})
  } else if (remaining === 1) {
    await db.spinRoom.updateMany({
      where: { id: currentRoomId, singletonStartedAt: null },
      data: { singletonStartedAt: new Date(), lastActivityAt: new Date() },
    })
  }

  const snapshot = await buildRoomSnapshot(claim.roomId, me.id)
  return NextResponse.json({
    ok: true,
    roomId: claim.roomId,
    createdNewRoom: claim.createdNewRoom,
    changed: claim.roomId !== currentRoomId,
    snapshot,
  })
}
