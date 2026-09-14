// Quicky — Spin the Bottle matchmaking
// POST /api/quicky/games/spin-bottle/join
//   → finds an open WAITING/STARTING room (creating one if none), seats the
//     player, and starts the spin loop when there are ≥ 2 active players.
//
// Room-lifecycle integration (lifecycle PRD §4/§7/§8):
//   · a debounced cleanup sweep runs first, so matchmaking never lands in a
//     zombie/abandoned room;
//   · a freshly created room starts its 5-minute SINGLETON TIMER
//     (singletonStartedAt) — the DB timestamp the cleanup worker checks;
//   · the timer is CANCELLED (nulled) the moment the room has ≥ 2 players;
//   · seating is race-resilient: if the chosen room was deleted between the
//     candidate query and the seat write (cleanup raced us), the join falls
//     back to creating a brand-new room instead of erroring.
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { buildRoomSnapshot } from '@/lib/quicky/spin-snapshot'
import { startSpinLoop } from '@/lib/quicky/spin-bottle'
import { emitRoomUpdate } from '@/lib/quicky/spin-events'
import { maybeRunCleanupLazy } from '@/lib/quicky/room-cleanup'

export async function POST(_req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Non-null alias — TS narrowing does not survive the hoisted helper
  // function declaration below.
  const myId = me.id

  // Lifecycle §4: reclaim abandoned rooms BEFORE hunting for a table.
  maybeRunCleanupLazy()

  // Seat the player — idempotent: a concurrent double-join (double-tap or a
  // retry) hits the (roomId,userId) unique constraint; reactivate that row.
  const seatPlayer = async (data: {
    roomId: string
    userId: string
    seatIndex: number
    turnIndex: number
    connection: string
  }) => {
    try {
      await db.spinRoomPlayer.create({ data: { ...data, lastActivityAt: new Date() } })
    } catch (e: any) {
      if (e?.code !== 'P2002') throw e
      // Row already exists for this user in this room — reactivate it
      await db.spinRoomPlayer.updateMany({
        where: { roomId: data.roomId, userId: data.userId },
        data: {
          leftAt: null,
          isActive: true,
          seatIndex: data.seatIndex,
          turnIndex: data.turnIndex,
          connection: 'online',
          lastActivityAt: new Date(),
        },
      })
    }
  }

  const joinChip = async (roomId: string) => {
    await db.spinRoomMessage.create({
      data: {
        roomId,
        userId: me.id,
        kind: 'join',
        text: `${(await db.user.findUnique({ where: { id: me.id }, select: { name: true } }))?.name ?? 'Someone'} joined`,
      },
    })
  }

  // 1. End any other active SpinRoomPlayer rows for this user
  await db.spinRoomPlayer.updateMany({
    where: { userId: me.id, leftAt: null },
    data: { leftAt: new Date(), isActive: false },
  })

  // 2. Look for an open room with < 12 players (CLOSING rooms are never
  //    candidates — they are on their way out).
  const candidates = await db.spinRoom.findMany({
    where: { status: { in: ['WAITING', 'STARTING', 'PLAYING'] } },
    include: { players: { where: { leftAt: null, isActive: true } } },
    orderBy: { lastActivityAt: 'desc' },
    take: 25,
  })
  const open = candidates.find((r) => r.players.length < r.maxPlayers)

  let roomId: string
  let createdNewRoom = false
  if (open) {
    const takenSeats = open.players.map((p) => p.seatIndex)
    const seatIndex = Array.from({ length: 12 }, (_, i) => i).find((i) => !takenSeats.includes(i)) ?? 0
    const turnIndex = open.players.length
    try {
      await seatPlayer({
        roomId: open.id,
        userId: me.id,
        seatIndex,
        turnIndex,
        connection: 'online',
      })
      roomId = open.id
      // Join chip (v2.1 §50/§52): name resolved from the event data itself,
      // never guessed from the player list later.
      await joinChip(roomId)
      await db.spinRoom.update({ where: { id: roomId }, data: { lastActivityAt: new Date() } })
      emitRoomUpdate(roomId) // players_changed — SSE subscribers refresh instantly
    } catch (e: any) {
      // Lifecycle §26: the cleanup worker deleted the room between the
      // candidate query and our seat write (P2025 = relation missing) —
      // fall through and create a fresh room instead of failing the join.
      if (e?.code !== 'P2025') throw e
      roomId = await createFreshRoom()
      createdNewRoom = true
    }
  } else {
    roomId = await createFreshRoom()
    createdNewRoom = true
  }

  async function createFreshRoom(): Promise<string> {
    // 3. Create a new WAITING room — the creator alone starts the 5-minute
    //    singleton timer immediately (lifecycle §5/§6).
    const room = await db.spinRoom.create({
      data: {
        status: 'WAITING',
        maxPlayers: 12,
        minPlayers: 2,
        singletonStartedAt: new Date(),
      },
    })
    await seatPlayer({
      roomId: room.id,
      userId: myId,
      seatIndex: 0,
      turnIndex: 0,
      connection: 'online',
    })
    await joinChip(room.id)
    return room.id
  }

  // 4. If we have ≥ 2 active players: start the loop (WAITING/STARTING) and
  //    CANCEL the singleton timer either way (lifecycle §7).
  const playersCount = await db.spinRoomPlayer.count({
    where: { roomId, leftAt: null, isActive: true },
  })
  const roomRow = await db.spinRoom.findUnique({ where: { id: roomId } })
  if (!roomRow) {
    // Deleted by a racing cleanup pass — join a fresh room (one retry).
    const retry = await db.spinRoom.create({
      data: { status: 'WAITING', maxPlayers: 12, minPlayers: 2, singletonStartedAt: new Date() },
    })
    await seatPlayer({ roomId: retry.id, userId: me.id, seatIndex: 0, turnIndex: 0, connection: 'online' })
    await joinChip(retry.id)
    const snapshot2 = await buildRoomSnapshot(retry.id, me.id)
    return NextResponse.json({ ok: true, roomId: retry.id, snapshot: snapshot2 })
  }
  if (playersCount >= 2) {
    await db.spinRoom.updateMany({
      where: { id: roomId, singletonStartedAt: { not: null } },
      data: { singletonStartedAt: null },
    })
    if (roomRow.status === 'WAITING' || roomRow.status === 'STARTING') {
      await startSpinLoop(roomId)
    }
  }

  const snapshot = await buildRoomSnapshot(roomId, me.id)
  return NextResponse.json({ ok: true, roomId, createdNewRoom, snapshot })
}
