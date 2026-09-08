// Quicky — Spin the Bottle game engine
// Server-authoritative. The client renders a 2D Three.js scene; the server
// picks the target, the start/end bottle rotation, and the kiss outcome.
//
// State machine per turn:
//   SPINNING (duration ms) → AWAITING (10 s) → RESULT (2 s) → SPINNING (next player)
//
// All timers are stored on the room via a WeakMap so we can cancel them
// (leave, close, manual end). Polling on the client is the V1 sync path;
// realtime is wired in joinRoomChannel but not yet pushed server-side.

import { db } from '@/lib/db'

export const SPIN_DURATION_MS = 3500
export const RESPONSE_TIMEOUT_MS = 10000
export const RESULT_PAUSE_MS = 2000

// Gender matching: pick the first eligible player whose gender differs
// from the spinner's. If "nonbinary"/"other" or both share the same gender,
// we still try the remaining pool (any non-self) so the game keeps flowing.
export function eligibleTargets(
  spinnerGender: string | null,
  players: { userId: string; gender: string | null; isActive: boolean; connection: string }[]
): { userId: string; gender: string | null }[] {
  const pool = players.filter(
    (p) => p.isActive && p.connection === 'online'
  )
  if (pool.length === 0) return []
  const opposite = pool.filter(
    (p) => spinnerGender && p.gender && p.gender !== spinnerGender
  )
  if (opposite.length > 0) return opposite
  // Fallback: any other player (same gender games shouldn't be totally stuck)
  return pool
}

// 12 fixed seats around a rectangular table (matches the PRD layout).
// Spinner is at the top of the table; the other 11 are around the edges.
// Returns the seat angle (radians, 0 = right) for a given seatIndex.
export function seatAngle(seatIndex: number, spinnerSeat = 0): number {
  // 12 seats total; spinner at index `spinnerSeat` (top). Others laid out
  // clockwise around a rectangle: 5 along the top, 3 on the right, 3 on the
  // bottom, 1 on the left. We use a polar angle so the bottle points at the
  // target's position when its rotation matches the target's angle.
  const POSITIONS = [
    { x: 0, y: -1 },  // 0 top center
    { x: -0.85, y: -0.7 },  // 1
    { x: -0.95, y: 0 },     // 2
    { x: -0.85, y: 0.7 },   // 3
    { x: -0.4, y: 1 },      // 4
    { x: 0.4, y: 1 },       // 5
    { x: 0.85, y: 0.7 },    // 6
    { x: 0.95, y: 0 },      // 7
    { x: 0.85, y: -0.7 },   // 8
    { x: 0.4, y: -0.85 },   // 9
    { x: -0.4, y: -0.85 },  // 10
    { x: 0, y: -0.5 },      // 11 (extra: top right of spinner)
  ]
  const p = POSITIONS[seatIndex % POSITIONS.length]
  return Math.atan2(p.y, p.x) // -π..π, 0 = right, -π/2 = up
}

// Pick a target and compute bottle rotation to land pointing at them.
// Adds 2–4 full rotations for visual momentum.
export function nextBottleRotation(
  currentRotation: number,
  spinnerSeat: number,
  targetSeat: number
): { startRotation: number; endRotation: number; duration: number } {
  const start = currentRotation
  const targetAngle = seatAngle(targetSeat, spinnerSeat)
  // The bottle's "pointer" sits at the top (-π/2) when rotation = 0, so the
  // effective landing angle is (targetAngle + rotation). Solve for the
  // smallest positive delta that lands on `targetAngle`.
  const currentPointer = -Math.PI / 2 + start
  let delta = targetAngle - currentPointer
  // Normalize to [0, 2π)
  while (delta <= 0) delta += Math.PI * 2
  // Add 2–4 full rotations for a satisfying spin
  const fullSpins = 2 + Math.floor(Math.random() * 3)
  const end = start + delta + fullSpins * Math.PI * 2
  return { startRotation: start, endRotation: end, duration: SPIN_DURATION_MS }
}

// ── Server-driven state machine ────────────────────────────────────────────
// `roomTimers` holds the in-flight timer for each room. Cancelled on leave/close.
const roomTimers = new Map<string, ReturnType<typeof setTimeout>[]>()
const roomCurrentSpin = new Map<string, { endRotation: number }>()

export function cancelRoomTimers(roomId: string) {
  const timers = roomTimers.get(roomId)
  if (timers) {
    timers.forEach((t) => clearTimeout(t))
    roomTimers.delete(roomId)
  }
  roomCurrentSpin.delete(roomId)
}

// Begin the spin loop for a room. Idempotent — safe to call when starting up
// a freshly created room. Each step writes the DB so the client polling sees
// the new state on its next tick.
export async function startSpinLoop(roomId: string) {
  cancelRoomTimers(roomId)
  // Mark room as PLAYING and the first turn
  await db.spinRoom.update({
    where: { id: roomId },
    data: { status: 'PLAYING', startedAt: new Date(), lastActivityAt: new Date() },
  })
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
  // Skip disconnected players by counting only online
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

  // Bottle rotation: angle the bottle so it points at the target's seat.
  const prevSpin = roomCurrentSpin.get(roomId)
  const prevEnd = prevSpin?.endRotation ?? 0
  const { startRotation, endRotation, duration } = nextBottleRotation(
    prevEnd,
    spinner.seatIndex,
    candidates.findIndex((c) => c.userId === target.userId)
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

  // Schedule SPINNING → AWAITING after `duration` ms
  const t1 = setTimeout(() => onSpinLanded(roomId, spin.id), duration)
  pushTimer(roomId, t1)
}

function pushTimer(roomId: string, t: ReturnType<typeof setTimeout>) {
  const list = roomTimers.get(roomId) ?? []
  list.push(t)
  roomTimers.set(roomId, list)
}

async function onSpinLanded(roomId: string, spinId: string) {
  const updated = await db.spinBottleSpin.updateMany({
    where: { id: spinId, status: 'spinning' },
    data: { status: 'awaiting' },
  })
  if (updated.count === 0) return
  const spin = await db.spinBottleSpin.findUnique({ where: { id: spinId } })
  if (!spin) return
  const target = await db.user.findUnique({ where: { id: spin.targetId! }, select: { name: true } })
  await db.spinRoomMessage.create({
    data: {
      roomId,
      userId: spin.spinnerId,
      text: `🎯 ${target?.name ?? 'Someone'} is up — Kiss ❤️ or No Thanks ❌`,
      kind: 'system',
    },
  })
  // If no response within 10s, treat as NO
  const t = setTimeout(() => onResponseTimeout(roomId, spinId), RESPONSE_TIMEOUT_MS)
  pushTimer(roomId, t)
}

export async function recordKissResponse(roomId: string, spinId: string, choice: 'yes' | 'no') {
  const updated = await db.spinBottleSpin.updateMany({
    where: { id: spinId, status: 'awaiting' },
    data: { status: 'completed', response: choice, completedAt: new Date() },
  })
  if (updated.count === 0) return false // already resolved
  const spin = await db.spinBottleSpin.findUnique({ where: { id: spinId } })
  if (!spin) return false
  await db.spinBottleEvent.create({
    data: {
      spinId,
      kind: choice === 'yes' ? 'kiss_yes' : 'kiss_no',
      fromUserId: spin.spinnerId,
      toUserId: spin.targetId,
    },
  })
  const target = await db.user.findUnique({ where: { id: spin.targetId! }, select: { name: true } })
  await db.spinRoomMessage.create({
    data: {
      roomId,
      userId: spin.targetId!,
      text: choice === 'yes'
        ? `💋 ${target?.name ?? 'They'} said YES!`
        : `❌ ${target?.name ?? 'They'} said no thanks.`,
      kind: 'system',
    },
  })
  // Schedule result → next turn
  const t = setTimeout(() => advanceTurn(roomId), RESULT_PAUSE_MS)
  pushTimer(roomId, t)
  return true
}

async function onResponseTimeout(roomId: string, spinId: string) {
  const updated = await db.spinBottleSpin.updateMany({
    where: { id: spinId, status: 'awaiting' },
    data: { status: 'completed', response: 'timeout', completedAt: new Date() },
  })
  if (updated.count === 0) return
  const spin = await db.spinBottleSpin.findUnique({ where: { id: spinId } })
  if (!spin) return
  await db.spinBottleEvent.create({
    data: { spinId, kind: 'kiss_timeout', toUserId: spin.targetId },
  })
  const target = await db.user.findUnique({ where: { id: spin.targetId! }, select: { name: true } })
  await db.spinRoomMessage.create({
    data: {
      roomId,
      userId: spin.targetId!,
      text: `⏰ ${target?.name ?? 'They'} didn't answer — auto NO.`,
      kind: 'system',
    },
  })
  const t = setTimeout(() => advanceTurn(roomId), RESULT_PAUSE_MS)
  pushTimer(roomId, t)
}

export async function advanceTurn(roomId: string) {
  const room = await db.spinRoom.findUnique({
    where: { id: roomId },
    include: { players: { where: { isActive: true, leftAt: null, connection: 'online' } } },
  })
  if (!room) return
  if (room.players.length < room.minPlayers) {
    // Not enough players to continue
    await db.spinRoom.update({ where: { id: roomId }, data: { status: 'WAITING' } })
    return
  }
  // Only online active players count for turn order
  const onlineCount = room.players.length
  if (onlineCount < room.minPlayers) return
  const next = (room.currentTurnIdx + 1) % onlineCount
  await db.spinRoom.update({
    where: { id: roomId },
    data: { currentTurnIdx: next, lastActivityAt: new Date() },
  })
  await beginSpin(roomId)
}
