// Quicky — LUDO ROOM ASSIGNMENT (Ludo PRD §5/§6/§97/§98/§117 — REVISED:
// gender-weighted seating, 2 male + 2 female per table)
//
// The Ludo flavour of the room-assignment service. REVISED per the unified
// entry-screen requirements: a Ludo table is gender-weighted — EXACTLY
// 2 male and 2 female seats — mirroring the Spin Bottle seat architecture:
//   · 4 seats — seat 0 → RED, seat 1 → GREEN, seat 2 → YELLOW, seat 3 → BLUE
//     (color is still determined by SEAT, not by user gender — §6/§7)
//   · a seat's GENDER SLOT is deterministic: seatIndex % 2 === 0 → male,
//     odd → female. With the fixed seat→color ring that puts the two male
//     seats (RED/YELLOW) and the two female seats (GREEN/BLUE) on opposite
//     DIAGONALS of the board — neither gender ever clusters on one side.
//   · users whose profile gender maps cleanly (male/female) can only claim
//     seats of their own gender slot; nonbinary/other/unset profiles are
//     treated as "either" and may take ANY open seat (same rule as Spin).
//   · rooms with status PLAYING are never assigned (§98: membership is
//     locked once the game starts — the turn structure never changes)
//   · claiming still races safely: the partial unique index
//     SpinRoomPlayer(roomId, seatIndex) WHERE active + an in-transaction
//     recheck of seat count AND gender capacity make a seat physically
//     un-claimable twice and a gender slot impossible to overfill.
import { db } from '@/lib/db'
import { LUDO_MAX_PLAYERS, LUDO_MIN_PLAYERS } from './ludo/constants'
import { createGameState } from './ludo/rules'
import { normalizeGender, type SeatGender } from './room-assignment'
import type { Prisma } from '@prisma/client'

export type LudoClaimResult = {
  roomId: string
  seatIndex: number
  createdNewRoom: boolean
}

/** Ludo seats per gender: even = male (RED/YELLOW), odd = female (GREEN/BLUE). */
export function ludoSeatsOfGender(gender: SeatGender): number[] {
  return gender === 'male' ? [0, 2] : [1, 3]
}

type RoomCandidate = {
  id: string
  maxPlayers: number
  players: { seatIndex: number }[]
}

/**
 * Find a joinable Ludo room and claim a gender-compatible seat (§6/§97).
 * Ranking: rooms with existing players first, highest occupancy next, most
 * recent activity, then a random tie-break. Creates a fresh room when
 * nothing validates. `profileGender` is the raw User.gender value — it is
 * normalized here (null → "either", any open seat).
 */
export async function assignLudoRoomAndSeat(userId: string, profileGender?: string | null): Promise<LudoClaimResult> {
  const seatGender = normalizeGender(profileGender ?? null)

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
      const slots = seatGender ? ludoSeatsOfGender(seatGender) : [0, 1, 2, 3]
      const free = slots.filter((i) => !taken.has(i))
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
    const claimed = await claimLudoSeat(cand.id, free, userId, seatGender)
    if (claimed) return { roomId: cand.id, seatIndex: claimed, createdNewRoom: false }
  }

  // No candidate validated → a fresh 4-seat Ludo room (§7 step 6), built as
  // a gender-weighted table from the start: 2 male + 2 female seats.
  const firstState = createGameState([]) as unknown as Prisma.InputJsonValue
  const room = await db.spinRoom.create({
    data: {
      status: 'WAITING',
      gameType: 'ludo',
      maxPlayers: LUDO_MAX_PLAYERS,
      minPlayers: LUDO_MIN_PLAYERS,
      // REVISED — gender weighting: exactly 2 male + 2 female seats. The
      // seat-slot parity below enforces it; these columns record the
      // composition for report queries.
      maleCapacity: 2,
      femaleCapacity: 2,
      singletonStartedAt: new Date(),
      gameState: firstState,
    },
  })
  const preferred = seatGender ? ludoSeatsOfGender(seatGender) : [0, 1, 2, 3]
  const seatIndex = preferred[0]
  await claimLudoSeat(room.id, [seatIndex], userId, seatGender)
  return { roomId: room.id, seatIndex, createdNewRoom: true }
}

/**
 * Atomically claim one of `freeSeats` inside a Ludo room:
 *   BEGIN → re-validate seat count AND gender capacity → claim seat → COMMIT.
 * The (roomId, userId) unique keeps reconnects idempotent (upsert);
 * P2002 on the seat index = seat raced → the caller tries the next room.
 */
async function claimLudoSeat(
  roomId: string,
  freeSeats: number[],
  userId: string,
  seatGender: SeatGender | null
): Promise<number | null> {
  const paritySeats = seatGender ? ludoSeatsOfGender(seatGender) : null
  for (const seatIndex of freeSeats) {
    try {
      const ok = await db.$transaction(async (tx) => {
        const activeCount = await tx.spinRoomPlayer.count({
          where: { roomId, isActive: true, leftAt: null },
        })
        if (activeCount >= LUDO_MAX_PLAYERS) throw new Error('room_full')
        // Gender-capacity recheck INSIDE the transaction: the candidate
        // snapshot may be stale — two racers of the same gender can never
        // both overfill a 2-seat gender quota.
        if (paritySeats) {
          const sameGender = await tx.spinRoomPlayer.count({
            where: {
              roomId,
              isActive: true,
              leftAt: null,
              userId: { not: userId },
              seatIndex: { in: paritySeats },
            },
          })
          if (sameGender >= 2) throw new Error('gender_full')
        }
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
      if (e?.message === 'room_full' || e?.message === 'room_locked' || e?.message === 'gender_full') return null
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
