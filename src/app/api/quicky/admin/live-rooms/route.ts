// Quicky — ADMIN LIVE TABLES monitor (Games PRD §64/§65)
// GET /api/quicky/admin/live-rooms
// Read-only inspection of every active Spin the Bottle room: players, gender
// distribution (aggregate — admin sees counts, the UI still never labels a
// user), current round state, timestamps. No game-state manipulation without
// an explicit moderation decision (§64).
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/quicky/admin'
import { effectiveSeatGender } from '@/lib/quicky/room-assignment'

export const dynamic = 'force-dynamic'

export async function GET() {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const rooms = await db.spinRoom.findMany({
    where: { status: { in: ['WAITING', 'STARTING', 'PLAYING'] } },
    include: {
      players: {
        where: { leftAt: null },
        orderBy: [{ turnIndex: 'asc' }],
        include: { user: { select: { id: true, name: true, gender: true } } },
      },
    },
    orderBy: { lastActivityAt: 'desc' },
    take: 100,
  })

  const currentSpinIds = rooms.map((r) => r.currentSpinId).filter((v): v is string => !!v)
  const spins = currentSpinIds.length
    ? await db.spinBottleSpin.findMany({
        where: { id: { in: currentSpinIds } },
        select: { id: true, status: true, result: true },
      })
    : []
  const spinById = new Map(spins.map((s) => [s.id, s]))

  const payload = rooms.map((r) => {
    const active = r.players.filter((p) => p.isActive)
    const maleCount = active.filter((p) => effectiveSeatGender(p.user.gender, p.seatIndex) === 'male').length
    const femaleCount = active.filter((p) => effectiveSeatGender(p.user.gender, p.seatIndex) === 'female').length
    return {
      id: r.id,
      status: r.status,
      maxPlayers: r.maxPlayers,
      maleCapacity: r.maleCapacity,
      femaleCapacity: r.femaleCapacity,
      playerCount: active.length,
      maleCount,
      femaleCount,
      canSpin: active.length > 1 && maleCount > 0 && femaleCount > 0,
      currentSpin: r.currentSpinId
        ? spinById.get(r.currentSpinId)
          ? {
              status: spinById.get(r.currentSpinId)!.status,
              result: spinById.get(r.currentSpinId)!.result,
            }
          : null
        : null,
      createdAt: r.createdAt.toISOString(),
      lastActivityAt: r.lastActivityAt.toISOString(),
      players: r.players.map((p) => ({
        userId: p.userId,
        name: p.user.name,
        gender: p.user.gender,
        seatIndex: p.seatIndex,
        connection: p.connection,
        isActive: p.isActive,
      })),
    }
  })

  return NextResponse.json({
    rooms: payload,
    totals: {
      rooms: payload.length,
      players: payload.reduce((sum, r) => sum + r.playerCount, 0),
    },
  })
}
