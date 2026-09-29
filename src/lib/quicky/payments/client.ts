'use client'

// Quicky — CLIENT PURCHASE ROUTER (Monetization PRD §5.4)
//
// ONE entry point for every store purchase. The SERVER decides the provider
// per platform (GET /store/products → purchaseProvider); this module only
// executes the corresponding flow:
//   stripe      → POST /payments/stripe/checkout → redirect to Stripe
//   google_play → Play Billing via the native plugin (runtime-detected)
//   mock        → the existing instant sandbox endpoint (dev only)
//   apple_pending → disabled with a friendly note (Apple billing pending)
//
// The router NEVER credits anything itself — balances move only through
// server-verified provider events (webhook / verify route).

import { toast } from 'sonner'
import { api } from '@/lib/quicky/api-client'
import { isNative, getPlatform } from '@/lib/capacitor'

export type PurchaseOutcome =
  | { ok: true; mode: 'redirected' | 'completed' }
  | { ok: false; error: string; message?: string }

export function clientPaymentPlatform(): 'web' | 'android' | 'ios' {
  if (isNative()) return getPlatform()
  return 'web'
}

// ─── Google Play Billing (runtime plugin detection) ─────────────────────────

type PlayBillingProxy = {
  initialize(opts?: Record<string, unknown>): Promise<unknown>
  queryProductDetails(opts?: Record<string, unknown>): Promise<{ productDetailsList?: Array<Record<string, unknown>> }>
  launchBillingFlow(opts?: Record<string, unknown>): Promise<{ purchaseList?: Array<{ productId?: string; purchaseToken?: string }> }>
}

function getPlayBillingPlugin(): PlayBillingProxy | null {
  if (typeof window === 'undefined') return null
  try {
    const cap = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor
    const plugin = cap?.Plugins?.GooglePlayBilling as PlayBillingProxy | undefined
    if (!plugin || typeof plugin.launchBillingFlow !== 'function') return null
    return plugin
  } catch {
    return null
  }
}

async function purchaseViaGooglePlay(googlePlayProductId: string): Promise<PurchaseOutcome> {
  const plugin = getPlayBillingPlugin()
  if (!plugin) {
    return {
      ok: false,
      error: 'play_billing_unavailable',
      message: 'Google Play purchases are not available in this build yet.',
    }
  }
  try {
    await plugin.initialize({}).catch(() => {})
    await plugin.queryProductDetails({ productIds: [googlePlayProductId], productType: 'inapp' })
    const res = await plugin.launchBillingFlow({ productId: googlePlayProductId, productType: 'inapp' })
    const purchase = res.purchaseList?.[0]
    if (!purchase?.purchaseToken) return { ok: false, error: 'purchase_cancelled' }
    const verify = await api.payments.googlePlayVerify(googlePlayProductId, purchase.purchaseToken)
    if (!verify?.ok) return { ok: false, error: 'verify_failed', message: 'The purchase could not be verified.' }
    return { ok: true, mode: 'completed' }
  } catch (e) {
    return { ok: false, error: 'play_billing_error', message: e instanceof Error ? e.message : undefined }
  }
}

// ─── The router ─────────────────────────────────────────────────────────────

/**
 * Buy a catalog product on the CURRENT platform. Returns the outcome; the
 * caller refreshes wallets on `mode: 'completed'` (redirect mode ends the
 * page anyway — the webhook fulfills and the return page re-syncs).
 */
export async function purchaseStoreProduct(productId: string): Promise<PurchaseOutcome> {
  const platform = clientPaymentPlatform()
  try {
    const { products } = await api.store.products(platform)
    const product = products.find((p) => p.id === productId)
    if (!product) return { ok: false, error: 'invalid_product' }

    switch (product.purchaseProvider) {
      case 'stripe': {
        const { url } = await api.payments.stripeCheckout(productId)
        if (!url) return { ok: false, error: 'checkout_failed' }
        window.location.href = url
        return { ok: true, mode: 'redirected' }
      }
      case 'google_play': {
        return await purchaseViaGooglePlay(product.id)
      }
      case 'mock': {
        // Dev sandbox — the existing instant endpoint (server-gated).
        await api.gameStore.purchaseCoins(productId)
        return { ok: true, mode: 'completed' }
      }
      case 'apple_pending': {
        toast.info('Purchases are coming soon on iOS — soon! 💜')
        return { ok: false, error: 'apple_pending' }
      }
      default:
        return { ok: false, error: 'unavailable', message: 'This product is not purchasable here yet.' }
    }
  } catch (e: any) {
    return { ok: false, error: 'purchase_failed', message: e?.message }
  }
}
