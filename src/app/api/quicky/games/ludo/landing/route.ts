// Quicky — LUDO landing stats (Ludo PRD §71/§74/§75)
// GET /api/quicky/games/ludo/landing
//
// Generic game statistics for the Quicky Ludo landing page — Ludo Games,
// Ludo Wins, Tokens Finished, Captures (§74) through the PERMANENT user
// record (rooms cascade away; lifetime totals never change). Coins +
// Quicky Points come from the same systems every other landing uses.
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const u = await db.user.findUnique({
    where: { id: me.id },
    select: {
      coinBalance: true,
      gamesPlayed: true,
      quickyScore: true,
      ludoWins: true,
      ludoTokensFinished: true,
      ludoCaptures: true,
    },
  })

  return NextResponse.json({
    coins: u?.coinBalance ?? 0,
    gamesPlayed: u?.gamesPlayed ?? 0,
    quickyPoints: u?.quickyScore ?? 0,
    ludoGames: u?.gamesPlayed ?? 0,
    ludoWins: u?.ludoWins ?? 0,
    tokensFinished: u?.ludoTokensFinished ?? 0,
    captures: u?.ludoCaptures ?? 0,
  })
}
