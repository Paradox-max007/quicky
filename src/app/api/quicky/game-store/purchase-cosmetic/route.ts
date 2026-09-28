// Quicky — COSMETIC PURCHASE WITH COINS (Game Economy PRD §34-§36/§54)
// POST /api/quicky/game-store/purchase-cosmetic  { rewardId, level? }
// Cosmetics are NEVER bought with real money directly (§4) — coins only.
// Race-safe conditional decrement + immutable ledger row; owned forever
// after (§35: one purchase per reward+level, 409 already_owned).
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { purchaseCosmetic, trackMonetizationEvent } from '@/lib/quicky/game-store'

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const rewardId = String(body?.rewardId ?? '')
  const level = Math.min(3, Math.max(1, Math.floor(Number(body?.level ?? 1)) || 1))
  if (!rewardId) return NextResponse.json({ error: 'invalid_cosmetic' }, { status: 400 })

  const result = await purchaseCosmetic(me.id, rewardId, level)
  if (!result.ok) {
    const status =
      result.error === 'insufficient_coins' ? 402 : result.error === 'already_owned' ? 409 : result.error === 'not_purchasable' ? 403 : 400
    return NextResponse.json({ error: result.error }, { status })
  }
  void trackMonetizationEvent(me.id, 'cosmetic_purchase_completed', { rewardId, priceCoins: result.priceCoins })
  return NextResponse.json(result)
}
