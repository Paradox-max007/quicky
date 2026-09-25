// Quicky — CRATE LEVEL PURCHASE (crate-pass PRD)
// POST /api/quicky/crates/buy  { crateId, levels }
//
// Buy N levels outright with coins (only once the crate is unlocked). The
// SERVER resolves which levels (the next N after currentLevel) and the price
// (sum of their configured per-level prices) — the client only sends the
// count. Race-safe conditional decrement; every newly reached level's prize
// is granted exactly once.
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { buyCrateLevels } from '@/lib/quicky/crates'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const crateId = String(body?.crateId ?? '')
  const levels = Number(body?.levels)
  if (!crateId || !Number.isInteger(levels) || levels < 1 || levels > 100) {
    return NextResponse.json({ error: 'invalid_levels' }, { status: 400 })
  }

  const result = await buyCrateLevels(me.id, crateId, levels)
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
