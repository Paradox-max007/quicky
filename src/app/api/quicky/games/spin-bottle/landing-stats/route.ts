// Quicky — Spin the Bottle landing stats (v3 PRD §15-§18 + lifecycle PRD §20)
// EVERYTHING here is database-driven — no placeholders. Stats read from the
// PERMANENT user record (User.kissPoints / kissesGiven / gamesPlayed /
// giftsSentCount / giftsReceivedCount), NOT from room-scoped rows: rooms and
// their cascaded data (spins, kiss rows, in-room gifts) are deleted when the
// room closes, but a player's lifetime totals must never change (§20/§21).
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

export async function GET(_req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const me2 = await db.user.findUnique({
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
  })

  const level = Math.max(1, Math.floor((me2?.quickyScore ?? 0) / 50) + 1)

  return NextResponse.json({
    gamesPlayed: me2?.gamesPlayed ?? 0,
    kissesReceived: me2?.kissPoints ?? 0,
    kissesGiven: me2?.kissesGiven ?? 0,
    giftsSent: me2?.giftsSentCount ?? 0,
    giftsReceived: me2?.giftsReceivedCount ?? 0,
    coins: me2?.coinBalance ?? 0,
    level,
  })
}
