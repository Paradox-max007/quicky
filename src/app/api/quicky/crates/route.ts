// Quicky — CRATE CATALOG (crate-pass PRD — the realm-pass store list)
// GET  /api/quicky/crates            — every active crate + my ownership state
// POST /api/quicky/crates            — action: purchase (unlock) a crate
//
// Purchases are server-priced and race-safe (conditional coin decrement);
// the client only ever sends the crateId.
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { getCrateCatalog, purchaseCrate } from '@/lib/quicky/crates'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const crates = await getCrateCatalog(me.id)
    return NextResponse.json({ crates })
  } catch {
    return NextResponse.json({ error: 'crates_unavailable' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const action = String(body?.action ?? 'purchase')
  const crateId = String(body?.crateId ?? '')
  if (!crateId) return NextResponse.json({ error: 'crate_required' }, { status: 400 })

  if (action === 'purchase') {
    const result = await purchaseCrate(me.id, crateId)
    if (!result.ok) {
      const status = result.error === 'insufficient_coins' ? 402 : result.error === 'not_found' ? 404 : 409
      return NextResponse.json({ error: result.error, coinBalance: result.coinBalance ?? undefined }, { status })
    }
    return NextResponse.json({
      ok: true,
      coinBalance: result.coinBalance,
      currentLevel: result.currentLevel,
      newLevels: result.newLevels,
    })
  }
  return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
}
