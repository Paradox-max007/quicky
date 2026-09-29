// Quicky — PAYMENT PLATFORM ROUTING (Monetization PRD §5.4 / §1.2)
//
// Provider selection follows the DISTRIBUTION CHANNEL, never the checkout
// surface: web browser → Stripe; Play-distributed Android → Google Play
// Billing; iOS → Apple (disabled until implemented — never routed to
// Stripe for digital goods).
//
// The dev-only sandbox provider (instant, clearly labelled "mock" in the
// ledger) keeps local demos working when no real provider is configured.

export type PurchasePlatform = 'web' | 'android' | 'ios'
export type PurchaseProvider = 'stripe' | 'google_play' | 'apple_pending' | 'mock' | 'unavailable'

/** Purchases may fall back to the instant sandbox provider in dev only. */
export function mockPaymentsAllowed(): boolean {
  if (process.env.ALLOW_MOCK_PAYMENTS === 'true') return true
  if (process.env.ALLOW_MOCK_PAYMENTS === 'false') return false
  return process.env.NODE_ENV === 'development'
}

/**
 * Which provider a given catalog product + platform purchases through.
 * Mirrors the server-side availability in /api/quicky/store/products.
 */
export function resolvePurchaseProvider(
  platform: PurchasePlatform,
  product: { kind: string; stripePriceId?: string | null; googlePlayProductId?: string | null },
  opts: { stripeConfigured: boolean; playConfigured: boolean }
): PurchaseProvider {
  if (platform === 'ios') return 'apple_pending'
  if (platform === 'web') {
    if (product.stripePriceId && opts.stripeConfigured) return 'stripe'
    return mockPaymentsAllowed() ? 'mock' : 'unavailable'
  }
  if (platform === 'android') {
    if (product.googlePlayProductId && opts.playConfigured) return 'google_play'
    return mockPaymentsAllowed() ? 'mock' : 'unavailable'
  }
  return 'unavailable'
}
