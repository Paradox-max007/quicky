// Quicky — ROOM ASSIGNMENT SERVICE (Games PRD §3-§11/§117)
//
// GenderSeatService + RoomAssignmentService + GenderSeatService in one
// server-only module. The client NEVER decides which room or seat it gets
// (§9: "the client must never make the final room assignment decision").
//
// Seat architecture (§3-§6):
//   · every room has maleCapacity (6) + femaleCapacity (6) = 12 seats
//   · a seat's GENDER SLOT is deterministic: seatIndex % 2 === 0 → male,
//     odd → female — so the two genders alternate around the table (§5)
//     instead of clustering on one side. Open seats render as "Open Seat";
//     the mapping is never exposed to users (§5).
//
// Join algorithm (§7): find active rooms → keep rooms with a FREE seat whose
// gender slot matches the user → rank (existing players → highest occupancy →
// recency → random tie-break) → claim ATOMICALLY inside a transaction that
// re-validates gender capacity (§10: two users racing for the last seat of a
// gender can never both win — the loser rolls back and tries the next room).
//
// A partial unique index on ("SpinRoomPlayer"."roomId","seatIndex") WHERE
// "isActive" AND "leftAt" IS NULL (migration-gender-balanced-rooms.sql) makes
// a seat physically un-claimable twice. P2002 on that index = seat raced →
// try the next free seat.
import { db } from '@/lib/db'

export type SeatGender = 'male' | 'female'

export const MALE_CAPACITY = 6
export const FEMALE_CAPACITY = 6
export const MAX_SEATS = MALE_CAPACITY + FEMALE_CAPACITY // 12

/** PRD §5/§6 — server-defined gender slot of a seat (deterministic). */
export function seatGenderForIndex(seatIndex: number): SeatGender {
  return seatIndex % 2 === 0 ? 'male' : 'female'
}

/** All seat indexes whose slot matches the given gender (0..11). */
export function seatsOfGender(gender: SeatGender): number[] {
  const first = gender === 'male' ? 0 : 1
  const seats: number[] = []
  for (let i = first; i < MAX_SEATS; i += 2) seats.push(i)
  return seats
}

/**
 * Normalize a user's profile gender into the seat-gender domain.
 * "male"/"female" map 1:1; anything else (nonbinary/other/null) returns null
 * and is treated as "either" — such a user may take ANY open seat.
 */
export function normalizeGender(gender: string | null | undefined): SeatGender | null {
  if (gender === 'male') return 'male'
  if (gender === 'female') return 'female'
  return null
}

/**
 * Effective seat gender of a player: profile gender when it maps cleanly,
 * otherwise the gender slot of the seat they already occupy. Used by the
 * spin gate + target selection so the round rules stay consistent with the
 * room architecture (PRD §11: male>0 AND female>0 AND total>1).
 */
export function effectiveSeatGender(
  profileGender: string | null | undefined,
  seatIndex: number | null | undefined
): SeatGender | null {
  return normalizeGender(profileGender) ?? (seatIndex != null ? seatGenderForIndex(seatIndex) : null)
}

type ClaimInput = {
  userId: string
  /** Normalized seat gender, or null for "any open seat". */
  seatGender: SeatGender | null
  /** Change Table (§9): never re-assign to this room. */
  excludeRoomId?: string
}

export type ClaimResult = {
  roomId: string
  seatIndex: number
  turnIndex: number
  createdNewRoom: boolean
}

type RoomCandidate = {
  id: string
  maxPlayers: number
  maleCapacity: number
  femaleCapacity: number
  players: { seatIndex: number }[]
}

function freeSeatsFor(cand: RoomCandidate, seatGender: SeatGender | null): number[] {
  const taken = new Set(cand.players.map((p) => p.seatIndex))
  const slots = seatGender ? seatsOfGender(seatGender) : Array.from({ length: MAX_SEATS }, (_, i) => i)
  return slots.filter((i) => !taken.has(i))
}

/**
 * Find a valid room + claim a gender-compatible seat (§7-§10).
 * Creates a fresh room when no candidate validates. Throws only on
 * unexpected DB failures — every expected race is handled internally.
 */
export async function assignRoomAndSeat(input: ClaimInput): Promise<ClaimResult> {
  const { userId, seatGender } = input

  // §9 — "Change Table" passes its current room here so it can never be
  // re-assigned to the table it just left.
  const candidates = (await db.spinRoom.findMany({
    where: {
      status: { in: ['WAITING', 'STARTING', 'PLAYING'] },
      ...(input.excludeRoomId ? { id: { not: input.excludeRoomId } } : {}),
    },
    include: { players: { where: { leftAt: null, isActive: true }, select: { seatIndex: true } } },
    orderBy: { lastActivityAt: 'desc' },
    take: 25,
  })) as RoomCandidate[]

  // §7 Step 3-4 — keep only rooms with a free gender-compatible seat, then
  // rank: rooms with existing players first, highest occupancy next, most
  // recent activity, then a random tie-break so users don't always land on
  // the same table.
  const valid = candidates
    .map((c) => ({ cand: c, free: freeSeatsFor(c, seatGender) }))
    .filter(({ cand, free }) => free.length > 0 && cand.players.length < cand.maxPlayers)
    .sort((a, b) => {
      const byOccupancy = b.cand.players.length - a.cand.players.length
      if (byOccupancy !== 0) return byOccupancy
      if (a.cand.players.length === 0 && b.cand.players.length > 0) return 1
      if (b.cand.players.length === 0 && a.cand.players.length > 0) return -1
      return Math.random() - 0.5 // random tie-break (§7)
    })

  for (const { cand, free } of valid) {
    const claimed = await claimSeatInRoom(cand, free, input)
    if (claimed) return { ...claimed, createdNewRoom: false }
  }

  // No candidate validated → fresh room (§7: appropriate new-room behavior).
  const room = await db.spinRoom.create({
    data: {
      status: 'WAITING',
      maxPlayers: MAX_SEATS,
      minPlayers: 2,
      maleCapacity: MALE_CAPACITY,
      femaleCapacity: FEMALE_CAPACITY,
      singletonStartedAt: new Date(),
    },
  })
  const seatIndex = freeSeatsFor({ ...room, players: [] }, seatGender)[0] ?? 0
  await claimSeatInRoom(
    { ...room, players: [] },
    [seatIndex],
    input
  )
  return { roomId: room.id, seatIndex, turnIndex: 0, createdNewRoom: true }
}

/**
 * Atomically claim one of `freeSeats` inside a room (§10):
 *   BEGIN → re-validate gender capacity → claim seat → recount → COMMIT.
 * Any failure (seat raced, room deleted, gender filled up) rolls the whole
 * thing back and returns null so the caller can try the next candidate.
 */
async function claimSeatInRoom(
  cand: RoomCandidate,
  freeSeats: number[],
  input: ClaimInput
): Promise<{ roomId: string; seatIndex: number; turnIndex: number } | null> {
  const { userId, seatGender } = input
  const paritySeats = seatGender ? seatsOfGender(seatGender) : null
  const capacity = seatGender === 'female' ? cand.femaleCapacity : seatGender === 'male' ? cand.maleCapacity : cand.maxPlayers

  for (const seatIndex of freeSeats) {
    try {
      const ok = await db.$transaction(async (tx) => {
        // §10 — gender-capacity re-check INSIDE the transaction: the seats
        // snapshot from the candidate query may already be stale.
        if (paritySeats) {
          const sameGender = await tx.spinRoomPlayer.count({
            where: {
              roomId: cand.id,
              isActive: true,
              leftAt: null,
              userId: { not: userId },
              seatIndex: { in: paritySeats },
            },
          })
          if (sameGender >= capacity) throw new Error('gender_full')
        }
        const activeCount = await tx.spinRoomPlayer.count({
          where: { roomId: cand.id, isActive: true, leftAt: null },
        })
        if (activeCount >= cand.maxPlayers) throw new Error('room_full')
        // Idempotent claim: a returning user (double-tap / reconnect /
        // change-table bounce) hits the (roomId,userId) unique → reactivate.
        await tx.spinRoomPlayer.upsert({
          where: { roomId_userId: { roomId: cand.id, userId } },
          create: {
            roomId: cand.id,
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
        await tx.spinRoom.update({
          where: { id: cand.id },
          data: { lastActivityAt: new Date() },
        })
        return true
      })
      if (ok) return { roomId: cand.id, seatIndex, turnIndex: -1 }
    } catch (e: any) {
      if (e?.message === 'gender_full' || e?.message === 'room_full') return null
      if (e?.code === 'P2002') continue // seat raced — try the next free seat
      if (e?.code === 'P2025') return null // room deleted by cleanup — next room
      throw e
    }
  }
  return null
}

/**
 * Membership count helpers used by the join route to decide whether the spin
 * loop should start (>= minPlayers) and the singleton timer must be cleared.
 */
export async function activePlayerCount(roomId: string): Promise<number> {
  return db.spinRoomPlayer.count({ where: { roomId, leftAt: null, isActive: true } })
}

/** End every other active membership for this user (single-room invariant). */
export async function endOtherMemberships(userId: string): Promise<void> {
  await db.spinRoomPlayer.updateMany({
    where: { userId, leftAt: null },
    data: { leftAt: new Date(), isActive: false },
  })
}
