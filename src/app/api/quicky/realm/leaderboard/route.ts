// Quicky — REALM LEADERBOARD (realm PRD §61/§43)
// GET /api/quicky/realm/leaderboard — the viewer's OWN cohort standings
// (cohort-scoped, never global — PRD §29). Top-3 rows flag promotion
// qualification (rank ≤ 3 AND threshold) without promising promotion.
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { getRealmStatus } from '@/lib/quicky/realm/realm-ranking'

export async function GET(_req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const status = await getRealmStatus(me.id).catch(() => null)
  if (!status) return NextResponse.json({ error: 'realm_unavailable' }, { status: 503 })

  return NextResponse.json({
    realm: { level: status.realm.level, name: status.realm.name },
    cycle: status.cycle,
    threshold: status.threshold,
    cohortSize: status.cohortSize,
    rows: status.leaderboard,
  })
}
