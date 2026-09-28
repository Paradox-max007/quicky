// Quicky — "How It Works" rules for the game screens (lifecycle PRD §50 +
// admin-console PRD §5 — per-game content)
// GET /api/quicky/games/spin-bottle/rules?gameType=<slug>
//
// Public read of ACTIVE + PUBLISHED rules for a game, sorted by the
// admin-defined sort_order (§49 — never creation date). DRAFT steps stay
// admin-only (admin-console PRD §5.1). The client rotates ONE rule at a
// time; an empty list falls back to the built-in copy on the client (§51).
// Default gameType = spin_the_bottle (backward compatible).
//
// Drift safety: if the local DB hasn't applied the `status` column yet
// (P2021/P2022 — see prisma/migration-sync-admin-prd.sql), the query falls
// back to the pre-PRD filter so the game screen never breaks during a
// half-synced `git pull`.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isPrismaSchemaDrift } from '@/lib/quicky/prisma-sync'

const SELECT = { id: true, title: true, description: true, icon: true, sortOrder: true }

export async function GET(req: NextRequest) {
  const gameType = (req.nextUrl.searchParams.get('gameType') ?? 'spin_the_bottle').trim().toLowerCase().slice(0, 40) || 'spin_the_bottle'
  let rules
  try {
    rules = await db.gameRule.findMany({
      where: { isActive: true, status: 'PUBLISHED', gameType },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: SELECT,
    })
  } catch (e) {
    // Unknown field/argument → stale client or DB missing the status column.
    if (!isPrismaSchemaDrift(e)) throw e
    rules = await db.gameRule.findMany({
      where: { isActive: true, gameType },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: SELECT,
    })
  }
  return NextResponse.json({ rules, gameType })
}
