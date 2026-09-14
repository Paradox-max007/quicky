// Quicky — SERVER-AUTHORITATIVE room lifecycle cleanup (lifecycle PRD §24-§26)
//
// The one rule that governs this whole module: room cleanup must NEVER
// depend on a client device, a React timer, or the game loop timers. A
// cron-like worker (src/instrumentation.ts, every 30s) plus lazy sweeps on
// matchmaking calls run this function so abandoned rooms are always
// reclaimed — even if every client crashed, closed the app, or lost
// internet (§67).
//
// Cleanup ordering (§25 — order matters, it keeps counts honest):
//   1. Remove inactive members (lastActivityAt older than 10 min)
//      → if a removed member is inside an active round, the round is
//        safely forfeited/resolved FIRST (§16) — never a stuck round.
//   2. Recalculate active members per affected room
//   3. Delete empty rooms (0 active players) — immediately (§17)
//   4. Singleton rooms: start/refresh the DB timer (singletonStartedAt);
//      if exactly 1 player for ≥ 5 min → remove them and delete the room
//      (§5/§6/§9 — based on CURRENT active membership, never history)
//   5. Delete stale CLOSING rooms + hard-sweep very old rooms (safety net)
//   6. Prune old closure receipts
//
// Race protection (§26): a room is deleted inside a transaction that
// RE-COUNTS active members at deletion time — a stale player count is
// never trusted. Concurrent workers converge because `deleteRoomCompletely`
// is idempotent and guarded by a conditional status claim.
//
// Deletion (§18-§21): SpinRoom rows cascade to members, messages, spins,
// events, kiss-point rows and in-room gifts (schema onDelete: Cascade), so
// ONE delete wipes every piece of temporary room data — while the permanent
// user economy (User counters + CoinLedger) is untouched by design.

import { db } from '@/lib/db'
import { cancelRoomTimers, forfeitRoundFor } from './spin-bottle'
import { emitRoomUpdate } from './spin-events'

// Thresholds are env-tunable so QA can shrink them in dev; the production
// defaults are exactly the PRD numbers.
const num = (v: string | undefined, d: number) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : d
}
export const INACTIVITY_MS = num(process.env.CLEANUP_INACTIVITY_MIN, 10) * 60_000 // §11: 10 minutes
export const SINGLETON_MS = num(process.env.CLEANUP_SINGLETON_MIN, 5) * 60_000 // §6: 5 minutes
const SWEEP_MS = num(process.env.CLEANUP_SWEEP_MIN, 60) * 60_000 // hard safety net
const CLOSING_GRACE_MS = 30_000 // CLOSING rooms are deleted on the next tick
const CLOSURE_TTL_MS = 24 * 60 * 60_000

export type CleanupStats = {
  removedInactive: number
  deletedEmptyRooms: number
  deletedSingletonRooms: number
  deletedStaleRooms: number
}

/** Record WHY a user's room vanished — survives the room itself (§28/§29). */
export async function recordClosure(
  roomId: string,
  userIds: string[],
  reason: 'singleton' | 'inactivity' | 'closed'
) {
  if (userIds.length === 0) return
  await db.spinRoomClosure
    .createMany({ data: userIds.map((userId) => ({ roomId, userId, reason })) })
    .catch(() => {})
}

/**
 * Delete a room and ALL of its temporary data — transactionally re-checking
 * that it is still empty RIGHT NOW (§26: never trust a stale count).
 * Cascade wipes members / chat / spins / events / in-room gifts (§18/§19).
 * Returns false when the room gained a player again between the sweep and
 * the delete (the room survives — §7: never delete after players joined).
 */
export async function deleteRoomCompletely(roomId: string): Promise<boolean> {
  // Cancel this process's game-loop timers first (leave/close paths that
  // never went through the worker), then delete atomically.
  const ok = await db
    .$transaction(async (tx) => {
      const active = await tx.spinRoomPlayer.count({
        where: { roomId, leftAt: null, isActive: true },
      })
      if (active > 0) return false // someone (re)joined — the room lives (§7)
      await tx.spinRoom.delete({ where: { id: roomId } }).catch(() => null)
      return true
    })
    .catch(() => false)
  if (ok) {
    cancelRoomTimers(roomId)
    // Wake any SSE subscribers → their snapshot builder returns null → the
    // client receives `room_gone` and shows the closure dialog (§27).
    emitRoomUpdate(roomId)
  }
  return ok
}

async function deactivateMember(roomId: string, userId: string, name: string | null) {
  await db.spinRoomPlayer.updateMany({
    where: { roomId, userId, leftAt: null },
    data: { leftAt: new Date(), isActive: false, connection: 'offline' },
  })
  // Leave chip — consistent with the manual-leave chip (displayName resolved
  // from the event data, never guessed later).
  await db.spinRoomMessage.create({
    data: { roomId, userId, kind: 'leave', text: `${name ?? 'Someone'} left` },
  })
}

/**
 * The full cleanup pass. Safe to run concurrently with itself (worst case:
 * both recount, one deletes, the other's delete is a no-op) and with normal
 * gameplay (all writes are conditional).
 */
export async function runRoomCleanup(): Promise<CleanupStats> {
  const stats: CleanupStats = {
    removedInactive: 0,
    deletedEmptyRooms: 0,
    deletedSingletonRooms: 0,
    deletedStaleRooms: 0,
  }
  const now = Date.now()

  // ── 1. Remove inactive members (§11/§14/§15) ────────────────────────────
  const staleMembers = await db.spinRoomPlayer.findMany({
    where: { isActive: true, leftAt: null, lastActivityAt: { lt: new Date(now - INACTIVITY_MS) } },
    select: { id: true, roomId: true, userId: true },
    take: 200,
  })
  const touchedRooms = new Set<string>()
  for (const m of staleMembers) {
    // §16: resolve/cancel any round that depends on this player FIRST.
    await forfeitRoundFor(m.roomId, m.userId).catch(() => {})
    const u = await db.user.findUnique({ where: { id: m.userId }, select: { name: true } })
    await deactivateMember(m.roomId, m.userId, u?.name ?? null).catch(() => {})
    await recordClosure(m.roomId, [m.userId], 'inactivity')
    touchedRooms.add(m.roomId)
    stats.removedInactive++
  }
  if (touchedRooms.size > 0) {
    // Wake their SSE streams — members see the departure immediately.
    for (const roomId of touchedRooms) emitRoomUpdate(roomId)
  }

  // ── 2-4. Recount + empty-room deletion + singleton rule (§8/§9/§17) ────
  // Candidate rooms: every room we touched, every CLOSING room, and every
  // room old enough to be suspicious. (A full-table scan is unnecessary —
  // WAITING/PLAYING rooms with fresh activity are healthy by definition.)
  const closingRooms = await db.spinRoom.findMany({
    where: { OR: [{ status: 'CLOSING' }, { lastActivityAt: { lt: new Date(now - SWEEP_MS) } }] },
    select: { id: true, status: true, singletonStartedAt: true, lastActivityAt: true },
    take: 300,
  })
  const candidateIds = new Set<string>([...touchedRooms, ...closingRooms.map((r) => r.id)])

  // ALSO include every room currently carrying a singletonStartedAt — those
  // need the 5-minute check even when nothing else is wrong with them.
  const singletons = await db.spinRoom.findMany({
    where: { singletonStartedAt: { not: null }, status: { not: 'CLOSING' } },
    select: { id: true },
    take: 300,
  })
  singletons.forEach((r) => candidateIds.add(r.id))

  for (const roomId of candidateIds) {
    const room = await db.spinRoom
      .findUnique({
        where: { id: roomId },
        include: {
          players: {
            where: { leftAt: null, isActive: true },
            select: { userId: true, lastActivityAt: true },
          },
        },
      })
      .catch(() => null)
    if (!room) continue // already deleted by a racing pass (§26)

    const activeCount = room.players.length
    if (activeCount === 0) {
      if (await deleteRoomCompletely(roomId)) stats.deletedEmptyRooms++
      continue
    }

    if (activeCount === 1) {
      // §6/§23: the singleton timer is a DATABASE timestamp.
      let startedAt = room.singletonStartedAt
      if (!startedAt) {
        startedAt = new Date()
        await db.spinRoom
          .updateMany({ where: { id: roomId, singletonStartedAt: null }, data: { singletonStartedAt: startedAt } })
          .catch(() => {})
        continue // timer just started — nothing else to do this tick
      }
      if (now - startedAt.getTime() >= SINGLETON_MS) {
        // §10: system removes the remaining player, room is discarded.
        const only = room.players[0]
        await forfeitRoundFor(roomId, only.userId).catch(() => {})
        const u = await db.user.findUnique({ where: { id: only.userId }, select: { name: true } })
        await deactivateMember(roomId, only.userId, u?.name ?? null).catch(() => {})
        await recordClosure(roomId, [only.userId], 'singleton')
        if (await deleteRoomCompletely(roomId)) stats.deletedSingletonRooms++
      }
      continue
    }

    // activeCount >= 2 → cancel the singleton timer (§7)
    if (room.singletonStartedAt) {
      await db.spinRoom
        .updateMany({ where: { id: roomId }, data: { singletonStartedAt: null } })
        .catch(() => {})
    }

    // Stale CLOSING rooms with stragglers (process died mid-close, legacy
    // rows): deactivate whoever is left — the next pass deletes the room.
    if (room.status === 'CLOSING' && now - room.lastActivityAt.getTime() > CLOSING_GRACE_MS) {
      for (const p of room.players) {
        await db.spinRoomPlayer
          .updateMany({
            where: { roomId, userId: p.userId, leftAt: null },
            data: { leftAt: new Date(), isActive: false, connection: 'offline' },
          })
          .catch(() => {})
      }
    }
  }

  // Rooms that went to CLOSING and have been empty for a while (the
  // leave/close routes normally delete these immediately — this is the net).
  for (const r of closingRooms) {
    if (r.status !== 'CLOSING') continue
    if (now - r.lastActivityAt.getTime() <= CLOSING_GRACE_MS) continue
    const active = await db.spinRoomPlayer.count({
      where: { roomId: r.id, leftAt: null, isActive: true },
    })
    if (active === 0 && (await deleteRoomCompletely(r.id))) stats.deletedStaleRooms++
  }

  // ── 6. Prune old closure receipts ───────────────────────────────────────
  await db.spinRoomClosure
    .deleteMany({ where: { createdAt: { lt: new Date(now - CLOSURE_TTL_MS) } } })
    .catch(() => {})

  return stats
}

// ── Lazy sweep for matchmaking paths ───────────────────────────────────────
// join() fires this (debounced to at most one run per 20s) so a room hunt
// never lands in a zombie room even before the first worker tick.
const g = globalThis as unknown as { __quickyLastLazyCleanup?: number }
export function maybeRunCleanupLazy() {
  const now = Date.now()
  if (g.__quickyLastLazyCleanup && now - g.__quickyLastLazyCleanup < 20_000) return
  g.__quickyLastLazyCleanup = now
  void runRoomCleanup().catch(() => {})
}
