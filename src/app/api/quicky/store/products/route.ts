// Quicky — STORE PRODUCTS (Monetization PRD §7)
// GET /api/quicky/store/products?platform=web|android|ios
// → active catalog with per-platform purchase availability. Prices shown in
// the UI come from THIS catalog (kept consistent with the provider dashboards);
// actual charges are always computed by Stripe/Play, never by the client.
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { listActiveProducts } from '@/lib/quicky/payments/fulfill'
import { stripeEnabled } from '@/lib/quicky/payments/stripe'
import { googlePlayEnabled } from '@/lib/quicky/payments/google-play'
import { resolvePurchaseProvider, type PurchasePlatform } from '@/lib/quicky/payments/platform'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const q = req.nextUrl.searchParams.get('platform')
  const platform: PurchasePlatform = q === 'android' || q === 'ios' ? q : 'web'

  const products = await listActiveProducts()
  const stripe = stripeEnabled()
  const play = googlePlayEnabled()

  // PRD §5.4 — provider routing per distribution channel. iOS digital
  // purchases stay disabled until Apple billing is implemented.
  return NextResponse.json({
    platform,
    products: products.map((p) => ({
      ...p,
      purchaseProvider: resolvePurchaseProvider(platform, p, { stripeConfigured: stripe, playConfigured: play }),
    })),
  })
}
