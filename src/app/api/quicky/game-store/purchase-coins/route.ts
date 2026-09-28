// Quicky — COIN PURCHASE (Game Economy PRD §9/§13/§14/§67)
// POST /api/quicky/game-store/purchase-coins  { packageId, platform }
// The payment runs through PaymentService → the platform adapter (sandbox
// today; Stripe / Play billing / StoreKit slot in behind the same seam).
// Crediting is ALWAYS server-side inside the purchase transaction — the
// client's "success" report is never trusted (§9).
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { purchaseCoinPackage, trackMonetizationEvent } from '@/lib/quicky/game-store'

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const packageId = String(body?.packageId ?? '')
  const platform = body?.platform === 'android' || body?.platform === 'ios' ? body.platform : 'web'
  if (!packageId) return NextResponse.json({ error: 'invalid_package' }, { status: 400 })

  void trackMonetizationEvent(me.id, 'checkout_started', { productType: 'COIN_PACK', packageId, platform })
  const result = await purchaseCoinPackage(me.id, packageId, platform as 'web' | 'android' | 'ios')

  if (!result.ok) {
    const status = result.error === 'premium_only' ? 403 : result.error === 'invalid_package' ? 400 : 402
    return NextResponse.json({ error: result.error }, { status })
  }
  return NextResponse.json({ ...result, mock: true })
}
