// Quicky — "How It Works" rules for the game screens (lifecycle PRD §50 +
// admin-console PRD §5 — per-game content)
// GET /api/quicky/games/spin-bottle/rules?gameType=<slug>
//
// Public read of ACTIVE rules for a game, sorted by the admin-defined
// sort_order (§49 — never creation date). The client rotates ONE rule at a
// time; an empty list falls back to the built-in copy on the client (§51).
// Default gameType = spin_the_bottle (backward compatible).
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  const gameType = (req.nextUrl.searchParams.get('gameType') ?? 'spin_the_bottle').trim().toLowerCase().slice(0, 40) || 'spin_the_bottle'
  const rules = await db.gameRule.findMany({
    where: { isActive: true, gameType },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, title: true, description: true, icon: true, sortOrder: true },
  })
  return NextResponse.json({ rules, gameType })
}
