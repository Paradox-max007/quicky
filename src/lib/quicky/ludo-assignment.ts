// Quicky — LUDO ROOM ASSIGNMENT (Ludo PRD §5/§6/§97/§98/§117)
//
// The Ludo flavour of the room-assignment service. Deliberately SIMPLER than
// the Spin Bottle gender-balanced claimer (Ludo PRD §6: "Ludo does NOT use
// the Spin Bottle gender balancing requirement"):
//   · 4 seats — seat 0 → RED, seat 1 → GREEN, seat 2 → YELLOW, seat 3 → BLUE
//     (color is determined by SEAT, not by user gender — §6/§7)
//   · any eligible player may occupy any available seat
//   · rooms with status PLAYING are never assigned (§98: membership is
//     locked once the game starts — the turn structure never changes)
//   · claiming still races safely: the partial unique index
//     SpinRoomPlayer(roomId, seatIndex) WHERE active + an in-transaction
//     active-count recheck make a seat physically un-claimable twice.
import { db } from '@/lib/db'
import { LUDO_MAX_PLAYERS, LUDO_MIN_PLAYERS } from './ludo/constants'
import { createGameState } from './ludo/rules'
import type { Prisma } from '@prisma/client'

export type LudoClaimResult = {
  roomId: string
  seatIndex: number
  createdNewRoom: boolean
}

type RoomCandidate = {
  id: string
  maxPlayers: number
  players: { seatIndex: number }[]
}

/**
 * Find a joinable Ludo room and claim a seat (§6/§97). Ranking: rooms with
 * existing players first, highest occupancy next, most recent activity, then
 * a random tie-break. Creates a fresh room when nothing validates.
 */
export async function assignLudoRoomAndSeat(userId: string): Promise<LudoClaimResult> {
  const candidates = (await db.spinRoom.findMany({
    where: {
      gameType: 'ludo',
      // §98 — PLAYING rooms are locked; only lobby / countdown rooms accept
      // new players.
      status: { in: ['WAITING', 'STARTING'] },
    },
    include: { players: { where: { leftAt: null, isActive: true }, select: { seatIndex: true } } },
    orderBy: { lastActivityAt: 'desc' },
    take: 25,
  })) as RoomCandidate[]

  const valid = candidates
    .map((cand) => {
      const taken = new Set(cand.players.map((p) => p.seatIndex))
      const free = [0, 1, 2, 3].filter((i) => !taken.has(i))
      return { cand, free }
    })
    .filter(({ cand, free }) => free.length > 0 && cand.players.length < Math.min(LUDO_MAX_PLAYERS, cand.maxPlayers))
    .sort((a, b) => {
      const byOccupancy = b.cand.players.length - a.cand.players.length
      if (byOccupancy !== 0) return byOccupancy
      if (a.cand.players.length === 0 && b.cand.players.length > 0) return 1
      if (b.cand.players.length === 0 && a.cand.players.length > 0) return -1
      return Math.random() - 0.5
    })

  for (const { cand, free } of valid) {
    const claimed = await claimLudoSeat(cand.id, free, userId)
    if (claimed) return { roomId: cand.id, seatIndex: claimed, createdNewRoom: false }
  }

  // No candidate validated → a fresh 4-seat Ludo room (§7 step 6).
  const firstState = createGameState([]) as unknown as Prisma.InputJsonValue
  const room = await db.spinRoom.create({
    data: {
      status: 'WAITING',
      gameType: 'ludo',
      maxPlayers: LUDO_MAX_PLAYERS,
      minPlayers: LUDO_MIN_PLAYERS,
      // Ludo has no gender capacities (§6) — the columns stay filled for
      // report queries only and are never consulted by the Ludo engine.
      maleCapacity: 4,
      femaleCapacity: 0,
      singletonStartedAt: new Date(),
      gameState: firstState,
    },
  })
  const seatIndex = 0
  await claimLudoSeat(room.id, [seatIndex], userId)
  return { roomId: room.id, seatIndex, createdNewRoom: true }
}

/**
 * Atomically claim one of `freeSeats` inside a Ludo room:
 *   BEGIN → re-validate capacity → claim seat → COMMIT.
 * The (roomId, userId) unique keeps reconnects idempotent (upsert);
 * P2002 on the seat index = seat raced → the caller tries the next room.
 */
async function claimLudoSeat(roomId: string, freeSeats: number[], userId: string): Promise<number | null> {
  for (const seatIndex of freeSeats) {
    try {
      const ok = await db.$transaction(async (tx) => {
        const activeCount = await tx.spinRoomPlayer.count({
          where: { roomId, isActive: true, leftAt: null },
        })
        if (activeCount >= LUDO_MAX_PLAYERS) throw new Error('room_full')
        // §98 — never seat into a room whose game already started.
        const room = await tx.spinRoom.findUnique({ where: { id: roomId }, select: { status: true } })
        if (!room || room.status === 'PLAYING' || room.status === 'CLOSING') throw new Error('room_locked')
        await tx.spinRoomPlayer.upsert({
          where: { roomId_userId: { roomId, userId } },
          create: {
            roomId,
            userId,
            seatIndex,
            turnIndex: activeCount,
            connection: 'online',
            lastActivityAt: new Date(),
          },
          update: {
            leftAt: null,
            isActive: true,
            seatIndex,
            turnIndex: activeCount,
            connection: 'online',
            lastActivityAt: new Date(),
          },
        })
        await tx.spinRoom.update({ where: { id: roomId }, data: { lastActivityAt: new Date() } })
        return true
      })
      if (ok) return seatIndex
    } catch (e: any) {
      if (e?.message === 'room_full' || e?.message === 'room_locked') return null
      if (e?.code === 'P2002') continue // seat raced — try the next free seat
      if (e?.code === 'P2025') return null // room deleted by cleanup
      throw e
    }
  }
  return null
}

export async function activeLudoPlayerCount(roomId: string): Promise<number> {
  return db.spinRoomPlayer.count({ where: { roomId, leftAt: null, isActive: true } })
}
