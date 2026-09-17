// Quicky — LIVE ACTIVE-PLAYER COUNTS (Games PRD §39/§70)
// GET /api/quicky/games/active-players
// Returns the CURRENT active player count per game slug. "Active" = a
// SpinRoomPlayer row still attached to a non-closed room (presence is kept
// alive by pings + swept by the cleanup worker, so stale/disconnected users
// never count). The Games hub polls this every ~30s → near-realtime card
// badges without re-fetching the whole catalog.
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const games = await db.gameDefinition.findMany({
    where: { isActive: true },
    select: { slug: true },
  })

  // Presence source of truth: active membership rows in non-closed rooms.
  // Per-game counting is driven by the room's game — today only
  // spin-the-bottle owns rooms; future games plug in here.
  const activeSpinPlayers = await db.spinRoomPlayer.count({
    where: { room: { status: { in: ['WAITING', 'STARTING', 'PLAYING'] } }, leftAt: null },
  })

  const counts: Record<string, number> = {}
  for (const g of games) {
    counts[g.slug] = g.slug === 'spin-the-bottle' ? activeSpinPlayers : 0
  }

  return NextResponse.json({ counts, serverNow: Date.now() })
}
