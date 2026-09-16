// Quicky — GAMES CATALOG (Game Hub PRD §8-§11/§70)
// GET /api/quicky/games
// Returns every ACTIVE game definition, ordered — the Games screen renders
// FROM this endpoint; cards are never hardcoded into a page (§11).
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const games = await db.gameDefinition.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      slug: true,
      name: true,
      shortDescription: true,
      description: true,
      icon: true,
      artwork: true,
      supportedModes: true,
      minPlayers: true,
      maxPlayers: true,
      isPlayable: true,
      isFeatured: true,
      sortOrder: true,
    },
  })

  return NextResponse.json({ games })
}
