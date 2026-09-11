// Quicky — Spin the Bottle matchmaking
// POST /api/quicky/games/spin-bottle/join
//   → finds an open WAITING/STARTING room (creating one if none), seats the
//     player, and starts the spin loop when there are ≥ 2 active players.
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { buildRoomSnapshot } from '@/lib/quicky/spin-snapshot'
import { startSpinLoop } from '@/lib/quicky/spin-bottle'
import { emitRoomUpdate } from '@/lib/quicky/spin-events'

export async function POST(_req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
      await db.spinRoomPlayer.create({ data })
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
        },
      })
    }
  }

  // 1. End any other active SpinRoomPlayer rows for this user
  await db.spinRoomPlayer.updateMany({
    where: { userId: me.id, leftAt: null },
    data: { leftAt: new Date(), isActive: false },
  })

  // 2. Look for an open room with < 12 players
  const candidates = await db.spinRoom.findMany({
    where: { status: { in: ['WAITING', 'STARTING', 'PLAYING'] } },
    include: { players: { where: { leftAt: null, isActive: true } } },
    orderBy: { lastActivityAt: 'desc' },
  })
  const open = candidates.find((r) => r.players.length < r.maxPlayers)

  let roomId: string
  if (open) {
    roomId = open.id
    const takenSeats = open.players.map((p) => p.seatIndex)
    const seatIndex = Array.from({ length: 12 }, (_, i) => i).find((i) => !takenSeats.includes(i)) ?? 0
    const turnIndex = open.players.length
    await seatPlayer({
      roomId,
      userId: me.id,
      seatIndex,
      turnIndex,
      connection: 'online',
    })
    await db.spinRoom.update({ where: { id: roomId }, data: { lastActivityAt: new Date() } })
    emitRoomUpdate(roomId) // players_changed — SSE subscribers refresh instantly
  } else {
    // 3. Create a new WAITING room
    const room = await db.spinRoom.create({
      data: {
        status: 'WAITING',
        maxPlayers: 12,
        minPlayers: 2,
      },
    })
    roomId = room.id
    await seatPlayer({
      roomId,
      userId: me.id,
      seatIndex: 0,
      turnIndex: 0,
      connection: 'online',
    })
    await db.spinRoomMessage.create({
      data: {
        roomId,
        userId: me.id,
        kind: 'system',
        text: `👋 ${(await db.user.findUnique({ where: { id: me.id }, select: { name: true } }))?.name ?? 'Someone'} joined the room.`,
      },
    })
  }

  // 4. If we have ≥ 2 active players and room is WAITING/STARTING, start the loop
  const playersCount = await db.spinRoomPlayer.count({
    where: { roomId, leftAt: null, isActive: true },
  })
  const roomRow = await db.spinRoom.findUnique({ where: { id: roomId } })
  if (playersCount >= 2 && (roomRow?.status === 'WAITING' || roomRow?.status === 'STARTING')) {
    await startSpinLoop(roomId)
  }

  const snapshot = await buildRoomSnapshot(roomId, me.id)
  return NextResponse.json({ ok: true, roomId, snapshot })
}
