// Quicky — Spin the Bottle game engine (server-authoritative, PRD v2)
//
// Round lifecycle owned by the SERVER (PRD §7):
//   SPINNING → TARGET_SELECTED/AWAITING → (both responses | 10s deadline)
//     → RESOLVING → RESULT (server-computed) → RETURNING/advance → next round
//
// Two-party response model (PRD §3/§4/§5/§28): BOTH the spinner and the
// target independently answer ❤️ Kiss / 💔 No Thanks. Results:
//   spinner ❤️ + target ❤️   → mutual_kiss    (+1 Kiss Point each, §5)
//   one ❤️ + one 💔/timeout  → partial_kiss   (+1 to the kissed party only:
//                                               "a user receives a Kiss Point
//                                               when another participant
//                                               chooses ❤️ for them")
//   both 💔/timeout          → full_rejection (0 points)
//
// Every state transition is written to the DB first, then broadcast via the
// room event bus (spin-events.ts) so SSE subscribers get the new snapshot
// instantly. Clients never transition states themselves (§7/§8) and never
// compute results or points (§5/§61).
//
// Timers live in a per-room WeakMap-ish registry so they can be cancelled
// (leave, close, manual end). Disconnect recovery (§67-§69): if a
// participant leaves/drops mid-round their response is recorded as reject
// and the round resolves — a room can never stall forever because the
// responseDeadline timeout always fires.

import { db } from '@/lib/db'
import { seatAngle, seatVector } from './spin-geometry'
import { emitRoomUpdate } from './spin-events'

export const SPIN_DURATION_MS = 3500
export const RESPONSE_TIMEOUT_MS = 10000
// Result reveal on the client is ~2.6s (cards return + brief idle); the next
// spin starts right after so the table never sits dead (PRD §32).
export const RESULT_PAUSE_MS = 3000

// ── Seat geometry (server side uses the SAME canonical ring as the client,
// PRD §76-§77 — the bottle's landing angle is the seat's ray by construction)
export function seatAngleFor(seatIndex: number): number {
  return seatAngle(seatIndex)
}

export function seatVectorFor(seatIndex: number): { x: number; y: number } {
  return seatVector(seatIndex)
}

// Gender matching: pick the first eligible player whose gender differs
// from the spinner's. If "nonbinary"/"other" or both share the same gender,
// we still try the remaining pool (any non-self) so the game keeps flowing.
export function eligibleTargets(
  spinnerGender: string | null,
  players: { userId: string; gender: string | null; isActive: boolean; connection: string }[]
): { userId: string; gender: string | null }[] {
  const pool = players.filter((p) => p.isActive && p.connection === 'online')
  if (pool.length === 0) return []
  const opposite = pool.filter(
    (p) => spinnerGender && p.gender && p.gender !== spinnerGender
  )
  if (opposite.length > 0) return opposite
  // Fallback: any other player (same gender games shouldn't be totally stuck)
  return pool
}

// Compute the bottle rotation that lands pointing at the target's seat ray.
// The pointer sits at the top (-π/2) when rotation = 0, and the target seat's
// canonical angle comes from the shared geometry engine, so the bottle always
// stops on the SAME ray the target card is rendered on.
export function nextBottleRotation(
  currentRotation: number,
  spinnerSeat: number,
  targetSeat: number
): { startRotation: number; endRotation: number; duration: number } {
  const start = currentRotation
  const targetAngle = seatAngle(targetSeat)
  const currentPointer = -Math.PI / 2 + start
  let delta = targetAngle - currentPointer
  // Normalize to (0, 2π]
  while (delta <= 0) delta += Math.PI * 2
  // Add 2–4 full rotations for a satisfying spin
  const fullSpins = 2 + Math.floor(Math.random() * 3)
  const end = start + delta + fullSpins * Math.PI * 2
  return { startRotation: start, endRotation: end, duration: SPIN_DURATION_MS }
}

// ── Server-driven state machine ────────────────────────────────────────────
const roomTimers = new Map<string, ReturnType<typeof setTimeout>[]>()
const roomCurrentSpin = new Map<string, { endRotation: number }>()
// Debounce guard: advanceTurn can be triggered from several paths (result
// timer, player leave) within the same window — only the first call counts,
// so a player never silently loses their turn.
const roomLastAdvance = new Map<string, number>()

export function cancelRoomTimers(roomId: string) {
  const timers = roomTimers.get(roomId)
  if (timers) {
    timers.forEach((t) => clearTimeout(t))
    roomTimers.delete(roomId)
  }
  roomCurrentSpin.delete(roomId)
  roomLastAdvance.delete(roomId)
}

function pushTimer(roomId: string, t: ReturnType<typeof setTimeout>) {
  const list = roomTimers.get(roomId) ?? []
  list.push(t)
  roomTimers.set(roomId, list)
}

// Begin the spin loop for a room. Idempotent — safe to call when starting up
// a freshly created room.
export async function startSpinLoop(roomId: string) {
  cancelRoomTimers(roomId)
  await db.spinRoom.update({
    where: { id: roomId },
    data: { status: 'PLAYING', startedAt: new Date(), lastActivityAt: new Date() },
  })
  emitRoomUpdate(roomId)
  await beginSpin(roomId)
}

export async function beginSpin(roomId: string) {
  const room = await db.spinRoom.findUnique({
    where: { id: roomId },
    include: {
      players: { where: { isActive: true, leftAt: null }, orderBy: { turnIndex: 'asc' } },
    },
  })
  if (!room) return
  const active = room.players.filter((p) => p.connection === 'online' || p.connection === 'reconnecting')
  if (active.length < room.minPlayers) return
  const online = active.filter((p) => p.connection === 'online')
  if (online.length < room.minPlayers) return

  // Find the spinner by currentTurnIdx
  const turnIdx = room.currentTurnIdx % online.length
  const spinner = online[turnIdx]
  if (!spinner) return

  // Pick a target from the opposite-gender pool
  const spinnerUser = await db.user.findUnique({ where: { id: spinner.userId }, select: { gender: true } })
  const candidates = eligibleTargets(
    spinnerUser?.gender ?? null,
    online
      .filter((p) => p.userId !== spinner.userId)
      .map((p) => ({ userId: p.userId, gender: null as string | null, isActive: true, connection: 'online' as const }))
  )
  if (candidates.length === 0) return
  const target = candidates[Math.floor(Math.random() * candidates.length)]
  // Resolve the chosen target's actual seat from the room's player rows
  const targetRow = online.find((p) => p.userId === target.userId)
  const targetSeatIndex = targetRow?.seatIndex ?? 0

  // Bottle rotation: land exactly on the target's canonical seat ray.
  const prevSpin = roomCurrentSpin.get(roomId)
  const prevEnd = prevSpin?.endRotation ?? 0
  const { startRotation, endRotation, duration } = nextBottleRotation(
    prevEnd,
    spinner.seatIndex,
    targetSeatIndex
  )
  roomCurrentSpin.set(roomId, { endRotation })

  const spin = await db.spinBottleSpin.create({
    data: {
      roomId,
      turnIndex: room.currentTurnIdx,
      spinnerId: spinner.userId,
      targetId: target.userId,
      startRotation,
      endRotation,
      duration,
      status: 'spinning',
    },
  })
  await db.spinRoom.update({
    where: { id: roomId },
    data: { currentSpinId: spin.id, lastActivityAt: new Date() },
  })
  await db.spinRoomMessage.create({
    data: {
      roomId,
      userId: spinner.userId,
      text: '🍾 The bottle is spinning…',
      kind: 'system',
    },
  })
  emitRoomUpdate(roomId)

  // SPINNING → AWAITING after `duration` ms
  const t1 = setTimeout(() => onSpinLanded(roomId, spin.id), duration)
  pushTimer(roomId, t1)
}

async function onSpinLanded(roomId: string, spinId: string) {
  // TARGET_SELECTED: open the two-party response window with a server deadline
  const updated = await db.spinBottleSpin.updateMany({
    where: { id: spinId, status: 'spinning' },
    data: {
      status: 'awaiting',
      responseDeadline: new Date(Date.now() + RESPONSE_TIMEOUT_MS),
    },
  })
  if (updated.count === 0) return
  const spin = await db.spinBottleSpin.findUnique({ where: { id: spinId } })
  if (!spin) return
  const target = await db.user.findUnique({ where: { id: spin.targetId! }, select: { name: true } })
  await db.spinRoomMessage.create({
    data: {
      roomId,
      userId: spin.spinnerId,
      text: `🎯 ${target?.name ?? 'Someone'} is up — both decide: Kiss ❤️ or No Thanks 💔`,
      kind: 'system',
    },
  })
  emitRoomUpdate(roomId)
  // Deadline watchdog — timeout = reject for whoever hasn't answered (§30)
  const t = setTimeout(() => onResponseTimeout(roomId, spinId), RESPONSE_TIMEOUT_MS)
  pushTimer(roomId, t)
}

/**
 * Record one participant's round response (PRD §28).
 * Returns 'resolved' when this was the second answer (round over),
 * 'submitted' when the other party still hasn't answered, or false when the
 * response is invalid (wrong phase / already answered / not a participant).
 */
export async function recordRoundResponse(
  roomId: string,
  spinId: string,
  responderId: string,
  choice: 'yes' | 'no'
): Promise<'resolved' | 'submitted' | false> {
  const spin = await db.spinBottleSpin.findUnique({ where: { id: spinId } })
  if (!spin || spin.status !== 'awaiting') return false
  const isSpinner = spin.spinnerId === responderId
  const isTarget = spin.targetId === responderId
  if (!isSpinner && !isTarget) return false
  if (isSpinner && spin.spinnerResponse) return false // locked after first answer
  if (isTarget && spin.targetResponse) return false

  const data = isSpinner ? { spinnerResponse: choice } : { targetResponse: choice }
  const updated = await db.spinBottleSpin.updateMany({
    where: { id: spinId, status: 'awaiting' },
    data,
  })
  if (updated.count === 0) return false

  await db.spinBottleEvent.create({
    data: {
      spinId,
      kind: choice === 'yes' ? 'kiss_yes' : 'kiss_no',
      fromUserId: responderId,
      toUserId: isSpinner ? spin.targetId : spin.spinnerId,
    },
  })

  // Second answer in → resolve server-side (PRD §5/§7)
  const fresh = await db.spinBottleSpin.findUnique({ where: { id: spinId } })
  if (fresh && fresh.spinnerResponse && fresh.targetResponse) {
    await resolveRound(roomId, fresh)
    return 'resolved'
  }

  // First answer in — the round continues; others see "waiting" (§28)
  emitRoomUpdate(roomId)
  return 'submitted'
}

/**
 * Compute the round result + award Kiss Points, all server-side (§5/§31).
 * A user receives a point whenever ANOTHER participant chooses ❤️ for them:
 *   mutual_kiss    → +1 each
 *   partial_kiss   → +1 only for the kissed party
 *   full_rejection → 0
 */
async function resolveRound(roomId: string, spin: {
  id: string
  spinnerId: string
  targetId: string | null
  spinnerResponse: string | null
  targetResponse: string | null
}) {
  const spinnerResponse = spin.spinnerResponse ?? 'timeout'
  const targetResponse = spin.targetResponse ?? 'timeout'
  // Result table (PRD §5/§30): any ❤️ in the round makes it a kiss (mutual
  // when both, partial when one); timeout counts as No Thanks (§30).
  const result =
    spinnerResponse === 'yes' && targetResponse === 'yes'
      ? 'mutual_kiss'
      : spinnerResponse === 'yes' || targetResponse === 'yes'
        ? 'partial_kiss'
        : 'full_rejection'

  const updated = await db.spinBottleSpin.updateMany({
    where: { id: spin.id, status: 'awaiting' },
    data: {
      status: 'completed',
      spinnerResponse,
      targetResponse,
      result,
      completedAt: new Date(),
    },
  })
  if (updated.count === 0) return false // already resolved by a racing path

  // Kiss Point ledger + counter — only when someone chose ❤️ FOR the other.
  const awards: { to: string; from: string }[] = []
  if (spinnerResponse === 'yes' && spin.targetId)
    awards.push({ to: spin.targetId, from: spin.spinnerId }) // target was chosen
  if (targetResponse === 'yes')
    awards.push({ to: spin.spinnerId, from: spin.targetId! }) // spinner was chosen
  for (const a of awards) {
    await db.kissPointTransaction.create({
      data: { roundId: spin.id, fromUserId: a.from, toUserId: a.to, points: 1, reason: 'round_kiss' },
    })
    await db.user.update({ where: { id: a.to }, data: { kissPoints: { increment: 1 } } })
  }

  await db.spinBottleEvent.create({
    data: {
      spinId: spin.id,
      kind: 'system',
      meta: JSON.stringify({ result, spinnerResponse, targetResponse }),
    },
  })

  // Result chat copy (§31 semantics)
  const [spinnerUser, targetUser] = await Promise.all([
    db.user.findUnique({ where: { id: spin.spinnerId }, select: { name: true } }),
    spin.targetId
      ? db.user.findUnique({ where: { id: spin.targetId }, select: { name: true } })
      : null,
  ])
  const sName = spinnerUser?.name ?? 'Someone'
  const tName = targetUser?.name ?? 'Someone'
  const word = (r: string) => (r === 'yes' ? '❤️ Kiss' : r === 'no' ? '💔 No Thanks' : "didn't answer")
  const text =
    result === 'mutual_kiss'
      ? `❤️ MUTUAL KISS — ${sName} ❤️ ${tName}! +1 Kiss Point each`
      : result === 'partial_kiss'
        ? `💋 PARTIAL KISS — ${sName} chose ${word(spinnerResponse)}, ${tName} chose ${word(targetResponse)}`
        : `💔 FULL REJECTION — ${
            spinnerResponse === 'timeout' || targetResponse === 'timeout'
              ? `${spinnerResponse === 'timeout' ? sName : tName} didn't answer in time`
              : 'both said No Thanks'
          }`
  await db.spinRoomMessage.create({ data: { roomId, userId: spin.spinnerId, text, kind: 'system' } })

  emitRoomUpdate(roomId)
  // RESULT → next round
  const t = setTimeout(() => advanceTurn(roomId), RESULT_PAUSE_MS)
  pushTimer(roomId, t)
  return true
}

async function onResponseTimeout(roomId: string, spinId: string) {
  const spin = await db.spinBottleSpin.findUnique({ where: { id: spinId } })
  if (!spin || spin.status !== 'awaiting') return
  // Missing response = reject (PRD §30). resolveRound fills both fields.
  const timedOut: string[] = []
  if (!spin.spinnerResponse) timedOut.push(spin.spinnerId)
  if (!spin.targetResponse && spin.targetId) timedOut.push(spin.targetId)
  if (timedOut.length > 0) {
    await db.spinBottleEvent.create({
      data: { spinId, kind: 'kiss_timeout', toUserId: timedOut.join(',') },
    })
    await db.spinRoomMessage.create({
      data: {
        roomId,
        userId: spin.spinnerId,
        text: `⏰ Time's up — ${timedOut.length === 2 ? 'nobody answered' : 'one answer missing'}, auto No Thanks.`,
        kind: 'system',
      },
    })
  }
  await resolveRound(roomId, spin)
}

export async function advanceTurn(roomId: string) {
  // Debounce: ignore advances within 2s of the last one (leave + result
  // timer racing in the RESULT window)
  const now = Date.now()
  if (now - (roomLastAdvance.get(roomId) ?? 0) < 2000) return
  roomLastAdvance.set(roomId, now)
  const room = await db.spinRoom.findUnique({
    where: { id: roomId },
    include: { players: { where: { isActive: true, leftAt: null, connection: 'online' } } },
  })
  if (!room) return
  if (room.players.length < room.minPlayers) {
    // Not enough players to continue
    await db.spinRoom.update({ where: { id: roomId }, data: { status: 'WAITING' } })
    emitRoomUpdate(roomId)
    return
  }
  const onlineCount = room.players.length
  if (onlineCount < room.minPlayers) return
  const next = (room.currentTurnIdx + 1) % onlineCount
  await db.spinRoom.update({
    where: { id: roomId },
    data: { currentTurnIdx: next, lastActivityAt: new Date() },
  })
  await beginSpin(roomId)
}

/**
 * Disconnect/leave recovery (PRD §67-§69). If a round participant drops out
 * mid-round their response is recorded as reject and the round resolves —
 * the room must never stall on a missing player. Returns whether the
 * caller is a participant of an ACTIVE (spinning/awaiting) round.
 */
export async function activeRoundParticipant(roomId: string, userId: string): Promise<boolean> {
  const room = await db.spinRoom.findUnique({ where: { id: roomId } })
  if (!room?.currentSpinId) return false
  const spin = await db.spinBottleSpin.findUnique({ where: { id: room.currentSpinId } })
  if (!spin || (spin.status !== 'spinning' && spin.status !== 'awaiting')) return false
  return spin.spinnerId === userId || spin.targetId === userId
}

/**
 * Force-finish the current round because a participant left (§68/§69).
 * Their response becomes reject; the rest resolves normally.
 */
export async function forfeitRoundFor(roomId: string, userId: string) {
  const room = await db.spinRoom.findUnique({ where: { id: roomId } })
  if (!room?.currentSpinId) return
  const spin = await db.spinBottleSpin.findUnique({ where: { id: room.currentSpinId } })
  if (!spin || (spin.status !== 'spinning' && spin.status !== 'awaiting')) return
  if (spin.spinnerId !== userId && spin.targetId !== userId) return
  const data = spin.spinnerId === userId ? { spinnerResponse: 'no' } : { targetResponse: 'no' }
  await db.spinBottleSpin.update({ where: { id: spin.id }, data })
  const fresh = await db.spinBottleSpin.findUnique({ where: { id: spin.id } })
  if (fresh && fresh.spinnerResponse && fresh.targetResponse) {
    await resolveRound(roomId, fresh)
  } else {
    // Mid-spin departure: resolve immediately with reject for the leaver
    await db.spinBottleSpin.updateMany({
      where: { id: spin.id, status: 'spinning' },
      data: { status: 'awaiting', responseDeadline: new Date() },
    })
    emitRoomUpdate(roomId)
    const t = setTimeout(() => onResponseTimeout(roomId, spin.id), 2500)
    pushTimer(roomId, t)
  }
}
