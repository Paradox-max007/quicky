// Quicky — Spin the Bottle landing stats
// V1: returns zero counters. The game engine is new so we have no historic
// data yet; the UI gracefully renders zeros until the first sessions complete.
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

export async function GET(_req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Count completed spins where the user was a target — that doubles as
  // "kisses received" for V1 (regardless of yes/no outcome).
  const [kissesReceived, gamesPlayed, kissesGiven] = await Promise.all([
    db.spinBottleSpin.count({ where: { targetId: me.id, status: 'completed' } }),
    db.spinRoomPlayer.count({ where: { userId: me.id, leftAt: { not: null } } }),
    db.spinBottleSpin.count({ where: { spinnerId: me.id, status: 'completed' } }),
  ])

  // Coins / level placeholders — V1 has no wallet; level is derived from
  // quickyScore for now.
  const me2 = await db.user.findUnique({ where: { id: me.id }, select: { quickyScore: true } })
  const level = Math.max(1, Math.floor((me2?.quickyScore ?? 0) / 50) + 1)

  return NextResponse.json({
    gamesPlayed,
    kissesReceived,
    kissesGiven,
    coins: 0,
    level,
  })
}
