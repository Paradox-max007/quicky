// Quicky — PURCHASE SYNC / RECOVERY (Game Economy PRD §70)
// GET /api/quicky/game-store/purchases
// "If payment successful but the app closes, on reopening: Sync purchases
// and restore the purchased entitlement." Returns pending payments and
// OWNED (paid, unopened) crates — the client surfaces them on store open.
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { syncPurchases } from '@/lib/quicky/game-store'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const data = await syncPurchases(me.id)
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ pending: [], ownedCrates: [] })
  }
}
