// Quicky — Spin the Bottle landing stats (Game Hub PRD §59/§60/§74)
// EVERYTHING here is database-driven — no placeholders. Stats read from the
// PERMANENT user record (User.kissPoints / kissesGiven / gamesPlayed /
// giftsSentCount / giftsReceivedCount), NOT from room-scoped rows: rooms and
// their cascaded data (spins, kiss rows, in-room gifts) are deleted when the
// room closes, but a player's lifetime totals must never change (§20/§21).
//
// §59 records: Kiss Points / Games / Streak / Quicky Points / Gifts
// §60 progress: League / Streak / Chemistry / Points
// §74 groups: DATING (likes, matches) · GAMES (games, kiss points, gifts)
//             · QUICKY (streak, points, chemistry)
// Chemistry comes from the CENTRAL service (§20 — never frontend-computed).
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { computeOverallChemistry } from '@/lib/quicky/chemistry'

export async function GET(_req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [me2, streak, chemistry, likesReceived, matches] = await Promise.all([
    db.user.findUnique({
      where: { id: me.id },
      select: {
        quickyScore: true,
        coinBalance: true,
        kissPoints: true,
        kissesGiven: true,
        gamesPlayed: true,
        giftsSentCount: true,
        giftsReceivedCount: true,
      },
    }),
    db.gameQuickyStreak.findUnique({ where: { userId: me.id } }),
    computeOverallChemistry(me.id),
    db.swipe.count({ where: { toUserId: me.id, type: { in: ['like', 'superlike'] } } }),
    db.match.count({ where: { OR: [{ userAId: me.id }, { userBId: me.id }], status: 'active' } }),
  ])

  const points = me2?.quickyScore ?? 0
  const level = Math.max(1, Math.floor(points / 50) + 1)

  // §75: reuse the REAL Quicky progression — league tiers from GameLeague.
  const tiers = await db.gameLeague.findMany({ where: { isActive: true }, orderBy: { minimumPoints: 'asc' } })
  let league: {
    name: string
    minimumPoints: number
    nextName: string | null
    nextMinimumPoints: number | null
  } | null = null
  if (tiers.length > 0) {
    let idx = 0
    for (let i = 0; i < tiers.length; i++) {
      if (points >= tiers[i].minimumPoints) idx = i
    }
    league = {
      name: tiers[idx].name,
      minimumPoints: tiers[idx].minimumPoints,
      nextName: tiers[idx + 1]?.name ?? null,
      nextMinimumPoints: tiers[idx + 1]?.minimumPoints ?? null,
    }
  }

  return NextResponse.json({
    // original record set (kept for the matchmaking modal + older callers)
    gamesPlayed: me2?.gamesPlayed ?? 0,
    kissesReceived: me2?.kissPoints ?? 0,
    kissesGiven: me2?.kissesGiven ?? 0,
    giftsSent: me2?.giftsSentCount ?? 0,
    giftsReceived: me2?.giftsReceivedCount ?? 0,
    coins: me2?.coinBalance ?? 0,
    level,
    // §59/§60 records + progress
    quickyPoints: points,
    streak: { current: streak?.currentStreak ?? 0, longest: streak?.longestStreak ?? 0 },
    league,
    chemistry,
    // §74 dating block
    dating: { likesReceived, matches },
  })
}
