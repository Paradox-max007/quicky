// Quicky — REALM RESULT SEEN (realm PRD §58/§59)
// POST /api/quicky/realm/claim { cycleId? } — dismiss the settled-cycle
// result screen. Rewards were already granted into the inventory at
// settlement; this only marks the claim as seen.
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { markRealmResultSeen } from '@/lib/quicky/realm/realm-ranking'

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const cycleId = typeof body?.cycleId === 'string' ? body.cycleId : undefined
  const ok = await markRealmResultSeen(me.id, cycleId).catch(() => false)
  return NextResponse.json({ ok })
}
