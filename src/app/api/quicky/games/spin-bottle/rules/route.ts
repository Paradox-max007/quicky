// Quicky — "How It Works" rules for the Play Now screen (lifecycle PRD §50)
// GET /api/quicky/games/spin-bottle/rules
//
// Public read of ACTIVE rules only, sorted by the admin-defined sort_order
// (§49 — never creation date). The client rotates ONE rule at a time; an
// empty list falls back to the built-in copy on the client (§51).
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(_req: Request) {
  const rules = await db.gameRule.findMany({
    where: { isActive: true, gameType: 'spin_the_bottle' },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, title: true, description: true, icon: true, sortOrder: true },
  })
  return NextResponse.json({ rules })
}
