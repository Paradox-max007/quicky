// Quicky — REALM POINT HISTORY (realm PRD §57/§61)
// GET /api/quicky/realm/points/history?limit=50 — the viewer's immutable
// ledger: every point is explainable (source gift, multiplier, calculation).
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { getRealmPointHistory } from '@/lib/quicky/realm/realm-ranking'

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const limit = Number(req.nextUrl.searchParams.get('limit') ?? 50)
  const history = await getRealmPointHistory(me.id, Number.isFinite(limit) ? limit : 50).catch(() => [])
  return NextResponse.json({ history })
}
