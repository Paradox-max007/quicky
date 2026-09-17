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

  // Refactor PRD §16/§17: live active-player count per game. The rooms
  // table is the server-authoritative presence store; a player row still
  // attached to a non-closed room counts as active right now.
  // Ludo PRD §73 — per-game presence: Ludo rooms live in the SAME room
  // table, filtered by gameType. The count = players inside active Ludo
  // rooms, not the number of rooms.
  const [activeSpinPlayers, activeLudoPlayers] = await Promise.all([
    db.spinRoomPlayer.count({
      where: { room: { gameType: 'spin_bottle', status: { in: ['WAITING', 'STARTING', 'PLAYING'] } }, leftAt: null },
    }),
    db.spinRoomPlayer.count({
      where: { room: { gameType: 'ludo', status: { in: ['WAITING', 'STARTING', 'PLAYING'] } }, leftAt: null },
    }),
  ])

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

  return NextResponse.json({
    games: games.map((g) => ({
      ...g,
      activePlayers:
        g.slug === 'spin-the-bottle'
          ? activeSpinPlayers
          : g.slug === 'ludo'
            ? activeLudoPlayers
            : 0,
    })),
  })
}
