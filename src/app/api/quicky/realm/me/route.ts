// Quicky — MY REALM STATUS (realm PRD §61)
// GET /api/quicky/realm/me — the authoritative realm snapshot for the
// viewer: realm level/name, active cycle + countdown, points, threshold,
// cohort rank/size, cohort leaderboard, lifetime points and any UNSEEN
// settled-cycle result (drives the Realm result screen, §58/§68).
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { getRealmStatus } from '@/lib/quicky/realm/realm-ranking'

export async function GET(_req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const status = await getRealmStatus(me.id).catch(() => null)
  if (!status) return NextResponse.json({ error: 'realm_unavailable' }, { status: 503 })

  return NextResponse.json({ realm: status })
}
