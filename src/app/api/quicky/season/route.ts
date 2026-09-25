// Quicky — SEASON STATUS (crate-pass PRD)
// GET /api/quicky/season
//
// The viewer's MONTHLY season state (the ❤ room chip refresh + season strip):
// active season (name/image/window), my points, the running season-event
// boost, upcoming events and the featured seasonal gifts.
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { getSeasonStatus } from '@/lib/quicky/season'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const status = await getSeasonStatus(me.id)
    return NextResponse.json(status)
  } catch {
    return NextResponse.json({ error: 'season_unavailable' }, { status: 500 })
  }
}
