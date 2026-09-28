// Quicky — CRATE PURCHASE (Game Economy PRD §37-§44/§46)
// POST /api/quicky/game-store/purchase-crate  { crateProductId, platform }
// Crates are REAL-MONEY products (never coins, §37). Payment verified →
// CratePurchase OWNED; opening is a SEPARATE step so the app dying right
// after payment never loses the entitlement (§46 — recovered by sync).
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { purchaseCrate, trackMonetizationEvent } from '@/lib/quicky/game-store'

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const crateProductId = String(body?.crateProductId ?? '')
  const platform = body?.platform === 'android' || body?.platform === 'ios' ? body.platform : 'web'
  if (!crateProductId) return NextResponse.json({ error: 'invalid_crate' }, { status: 400 })

  void trackMonetizationEvent(me.id, 'checkout_started', { productType: 'CRATE', crateProductId, platform })
  const result = await purchaseCrate(me.id, crateProductId, platform as 'web' | 'android' | 'ios')

  if (!result.ok) {
    const status = result.error === 'invalid_crate' ? 400 : 402
    return NextResponse.json({ error: result.error }, { status })
  }
  return NextResponse.json({ ...result, mock: true })
}
