// Quicky — LUDO ROOM ASSIGNMENT (Ludo PRD §5/§6/§97/§98/§117 — REVISED:
// mode-based tables (2 or 4 players) + DIAGONAL seat fill 1→3→2→4)
//
// The Ludo flavour of the room-assignment service. REVISED per play-test
// feedback:
//   · TABLE MODE — every Ludo table is created in a MODE chosen by the
//     first player BEFORE starting: "2 players" (starts when the 2nd joins,
//     3·2·1 countdown) or "4 players" (waits until all four are seated,
//     "waiting for players…"). The mode IS room.maxPlayers — no new
//     column, and matchmaking only ever matches equal modes.
//   · DIAGONAL SEAT FILL — players are assigned yards STRICTLY in join
//     order 1→3→2→4 clockwise (seat 0 TL → seat 2 BR → seat 1 TR → seat 3
//     BL): the 2nd joiner ALWAYS lands in the DIAGONALLY OPPOSITE yard of
//     the 1st, the 3rd diagonally opposite the 4th. This supersedes the
//     old gender-parity seating (the maleCapacity/femaleCapacity columns
//     stay for report queries, they no longer gate seats).
//   · JOIN LOCK — rooms with status PLAYING are never assigned (§98:
//     membership is locked once the game starts; a player arriving midway
//     gets a fresh table of their own, never a seat in a running game).
//   · RACE HARDENING (the Capacitor/mobile join failures) — three layers:
//       1. A fresh room and its FIRST seat are created inside ONE
//          transaction → a Ludo room can never exist with zero players,
//          so the cleanup worker can never delete a room out from under a
//          joining player (the old P2003 SpinRoomPlayer_roomId_fkey).
//       2. Every interactive transaction runs with an explicit
//          timeout/maxWait — under dashboard-poll connection pressure the
//          Prisma default (5s) expired (P2028 "Transaction not found").
//       3. P2028 is RETRIED (transient pool contention) and P2003/P2025
//          are treated as "room vanished" → the hunter simply moves to
//          the next candidate or builds a new table.
import { db } from '@/lib/db'
import { LUDO_MAX_PLAYERS, LUDO_MIN_PLAYERS } from './ludo/constants'
import { createGameState } from './ludo/rules'
import type { Prisma } from '@prisma/client'

export type LudoClaimResult = {
  roomId: string
  seatIndex: number
  maxPlayers: number
  createdNewRoom: boolean
}

/**
 * REVISED seat fill order — yards fill 1→3→2→4 clockwise (user-facing
 * numbering): seat 0 (red, top-left) → seat 2 (yellow, BOTTOM-RIGHT =
 * diagonally opposite) → seat 1 (green, top-right) → seat 3 (blue,
 * bottom-left). Each pair of joiners sits on opposite diagonals.
 */
export const LUDO_SEAT_FILL_ORDER: readonly number[] = [0, 2, 1, 3]

/** Valid Ludo table modes: 2-player duels and full 4-player tables. */
export function normalizeLudoMode(mode: unknown): 2 | 4 {
  return Number(mode) === 4 ? 4 : 2
}

/** Interactive-transaction options — survives connection-pool pressure. */
const TX_OPTS = { timeout: 15_000, maxWait: 10_000 } as const

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

type RoomCandidate = {
  id: string
  maxPlayers: number
  singletonStartedAt: Date | null
  players: { seatIndex: number }[]
}

/**
 * Find a joinable Ludo room of the requested MODE and claim a seat in
 * strict diagonal fill order (§6/§97 revised). Ranking: rooms with
 * existing players first, highest occupancy next, most recent activity,
 * then a random tie-break. Creates a fresh room when nothing validates.
 */
export async function assignLudoRoomAndSeat(userId: string, mode: 2 | 4): Promise<LudoClaimResult> {
  const candidates = (await db.spinRoom.findMany({
    where: {
      gameType: 'ludo',
      // Mode match — a 2-player duel never absorbs a 4-player seeker.
      maxPlayers: mode,
      // §98 — PLAYING rooms are locked; only lobby / countdown rooms
      // accept new players.
      status: { in: ['WAITING', 'STARTING'] },
      // Never seat into a singleton room that is about to be culled by
      // the cleanup worker (5-minute timer, we leave a 30s margin).
      OR: [
        { singletonStartedAt: null },
        { singletonStartedAt: { gt: new Date(Date.now() - 4.5 * 60_000) } },
      ],
    },
    include: { players: { where: { leftAt: null, isActive: true }, select: { seatIndex: true } } },
    orderBy: { lastActivityAt: 'desc' },
    take: 25,
  })) as RoomCandidate[]

  const valid = candidates
    .map((cand) => {
      const taken = new Set(cand.players.map((p) => p.seatIndex))
      const free = LUDO_SEAT_FILL_ORDER.filter((i) => !taken.has(i))
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
    if (claimed != null) return { roomId: cand.id, seatIndex: claimed, maxPlayers: mode, createdNewRoom: false }
  }

  // No candidate validated → a FRESH table of the requested mode. The room
  // and the creator's seat are created in ONE transaction (race hardening
  // layer 1 — no zero-player window for the cleanup worker to race).
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const created = await db.$transaction(
        async (tx) => {
          const firstState = createGameState([]) as unknown as Prisma.InputJsonValue
          const room = await tx.spinRoom.create({
            data: {
              status: 'WAITING',
              gameType: 'ludo',
              maxPlayers: mode,
              minPlayers: LUDO_MIN_PLAYERS,
              // Kept for report queries; seats no longer gate on gender.
              maleCapacity: 2,
              femaleCapacity: 2,
              singletonStartedAt: new Date(),
              gameState: firstState,
            },
          })
          await tx.spinRoomPlayer.create({
            data: {
              roomId: room.id,
              userId,
              seatIndex: LUDO_SEAT_FILL_ORDER[0],
              turnIndex: 0,
              connection: 'online',
              lastActivityAt: new Date(),
            },
          })
          return room.id
        },
        TX_OPTS
      )
      return { roomId: created, seatIndex: LUDO_SEAT_FILL_ORDER[0], maxPlayers: mode, createdNewRoom: true }
    } catch (e: any) {
      // P2002 = this user already holds a seat somewhere → fall through to
      // the claim path below. P2028 = transient pool contention → retry
      // once, then give the generic claim path a chance.
      if (e?.code === 'P2002') break
      if (e?.code === 'P2028' && attempt === 0) {
        await sleep(400)
        continue
      }
      if (e?.code === 'P2028') break
      throw e
    }
  }

  // Last resort (P2002 path): the user already owns a seat in some room of
  // this mode — re-claim inside it so the join is IDEMPOTENT, never a 500.
  const own = await db.spinRoomPlayer.findFirst({
    where: { userId, leftAt: null, isActive: true, room: { gameType: 'ludo', maxPlayers: mode } },
    select: { roomId: true, seatIndex: true },
  })
  if (own) {
    const room = await db.spinRoom.findUnique({ where: { id: own.roomId }, select: { maxPlayers: true } })
    return { roomId: own.roomId, seatIndex: own.seatIndex, maxPlayers: room?.maxPlayers ?? mode, createdNewRoom: false }
  }
  throw new Error('ludo_seat_unavailable')
}

/**
 * Atomically claim one of `freeSeats` inside a Ludo room:
 *   BEGIN → re-validate occupancy against the room's OWN mode cap →
 *   claim seat → COMMIT.
 * The (roomId, userId) unique keeps reconnects idempotent (upsert);
 * P2002 on the seat index = seat raced → the caller tries the next room.
 * P2028 is retried (layer 2); P2003 (the room row vanished mid-transaction
 * — cleanup raced a zombie) is absorbed as "room gone" (layer 3).
 */
async function claimLudoSeat(roomId: string, freeSeats: number[], userId: string): Promise<number | null> {
  for (const seatIndex of freeSeats) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const ok = await db.$transaction(
          async (tx) => {
            // The room's OWN mode is the cap (2-player duel = 2 seats).
            const room = await tx.spinRoom.findUnique({
              where: { id: roomId },
              select: { status: true, maxPlayers: true },
            })
            if (!room || room.status === 'PLAYING' || room.status === 'CLOSING') {
              throw new Error('room_locked') // §98 — never seat into a running game
            }
            const activeCount = await tx.spinRoomPlayer.count({
              where: { roomId, isActive: true, leftAt: null },
            })
            if (activeCount >= room.maxPlayers) throw new Error('room_full')
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
          },
          TX_OPTS
        )
        if (ok) return seatIndex
      } catch (e: any) {
        if (e?.message === 'room_full' || e?.message === 'room_locked') return null
        if (e?.code === 'P2002') break // seat raced — try the next free seat
        // P2028 — the interactive transaction was reaped under pool
        // pressure: RETRY the same seat after a short backoff.
        if (e?.code === 'P2028') {
          if (attempt < 2) {
            await sleep(350 * (attempt + 1))
            continue
          }
          return null
        }
        // P2003 — the room row vanished between our read and the write
        // (cleanup deleted a zombie): treat exactly like "room deleted".
        if (e?.code === 'P2003' || e?.code === 'P2025') return null
        throw e
      }
    }
  }
  return null
}

export async function activeLudoPlayerCount(roomId: string): Promise<number> {
  return db.spinRoomPlayer.count({ where: { roomId, leftAt: null, isActive: true } })
}
