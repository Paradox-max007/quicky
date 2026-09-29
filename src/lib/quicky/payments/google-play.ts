// Quicky — GOOGLE PLAY BILLING VERIFICATION (Monetization PRD §5.3 / §10)
//
// Server-side purchase verification through the Google Play Developer API.
// The client sends (productId, purchaseToken); we verify with Google before
// anything is credited — a modified client can never mint currency
// (PRD: "Do not grant currency from a client-side purchase-success
// callback alone").
//
// Auth: service-account JWT (RS256) exchanged for an OAuth access token.
// Everything is plain fetch + node:crypto — no googleapis dependency.
//
// Required env:
//   GOOGLE_PLAY_PACKAGE_NAME            e.g. com.quicky.app
//   GOOGLE_PLAY_SERVICE_ACCOUNT_JSON    the FULL service-account JSON key

import crypto from 'crypto'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const PLAY_API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications'
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher'

type ServiceAccount = {
  client_email: string
  private_key: string
  token_uri?: string
}

export function googlePlayEnabled(): boolean {
  return !!(process.env.GOOGLE_PLAY_PACKAGE_NAME && process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON)
}

function loadServiceAccount(): ServiceAccount {
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON
  if (!raw) throw new Error('google_play_not_configured')
  const sa = JSON.parse(raw) as ServiceAccount
  if (!sa.client_email || !sa.private_key) throw new Error('google_play_invalid_service_account')
  return { ...sa, private_key: sa.private_key.replace(/\\n/g, '\n') }
}

// ─── OAuth: service-account JWT → access token (cached until expiry) ────────

let tokenCache: { token: string; expiresAt: number } | null = null

async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) return tokenCache.token

  const sa = loadServiceAccount()
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const claims = {
    iss: sa.client_email,
    scope: SCOPE,
    aud: sa.token_uri ?? TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }
  const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const unsigned = `${b64(header)}.${b64(claims)}`
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url')
  const assertion = `${unsigned}.${signature}`

  const res = await fetch(sa.token_uri ?? TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
    cache: 'no-store',
  })
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number }
  if (!res.ok || !data.access_token) throw new Error('google_play_token_failed')

  tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 }
  return tokenCache.token
}

async function playApi<T>(
  method: 'GET' | 'POST',
  path: string,
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const pkg = encodeURIComponent(process.env.GOOGLE_PLAY_PACKAGE_NAME!)
  try {
    const token = await getAccessToken()
    const res = await fetch(`${PLAY_API}/${pkg}/${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } }
    if (!res.ok) return { ok: false, status: res.status, error: data?.error?.message ?? `play_api_${res.status}` }
    return { ok: true, data }
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : 'play_api_failed' }
  }
}

// ─── One-time products (coins / points packs) ────────────────────────────────

export type PlayProductPurchase = {
  purchaseState: number // 0 = PURCHASED, 1 = CANCELED, 2 = PENDING
  consumptionState: number // 0 = yet to be consumed, 1 = consumed
  acknowledged: boolean
  orderId?: string
  purchaseToken?: string
  productId?: string
  quantity?: number
  purchaseTimeMillis?: string
  obfuscatedExternalAccountId?: string
}

export type VerifiedProduct = { purchase: PlayProductPurchase; orderId: string }

/**
 * Verify a one-time purchase. Only purchaseState === 0 (PURCHASED) passes —
 * PENDING purchases stay pending until Google confirms (PRD §5.3).
 */
export async function verifyProductPurchase(productId: string, purchaseToken: string): Promise<VerifiedProduct | { error: string }> {
  const res = await playApi<PlayProductPurchase>(
    'GET',
    `purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`
  )
  if (!res.ok) return { error: res.error }
  const p = res.data
  if (p.purchaseState !== 0) return { error: `purchase_state_${p.purchaseState}` }
  if (p.productId && p.productId !== productId) return { error: 'product_mismatch' }
  return { purchase: p, orderId: p.orderId ?? purchaseToken }
}

/** Consume a consumable (COIN_PACK / REALM_POINTS_PACK) so it can be bought again. */
export async function consumeProductPurchase(productId: string, purchaseToken: string): Promise<boolean> {
  const res = await playApi('POST', `purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:consume`)
  return res.ok
}

/** Acknowledge a non-consumable purchase (required within 3 days). */
export async function acknowledgeProductPurchase(productId: string, purchaseToken: string): Promise<boolean> {
  const res = await playApi('POST', `purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`)
  return res.ok
}

// ─── Subscriptions (subscriptionsv2) ─────────────────────────────────────────

export type PlaySubscriptionPurchase = {
  subscriptionState?: string // SUBSCRIPTION_STATE_ACTIVE, _CANCELED, _EXPIRED, ...
  lineItems?: Array<{
    productId?: string
    expiryTime?: string
    autoRenewingPlan?: { autoRenewEnabled?: boolean }
  }>
  linkedPurchaseToken?: string
  acknowledgementState?: number // 0 = pending, 1 = acknowledged
}

export async function verifySubscriptionPurchase(purchaseToken: string): Promise<PlaySubscriptionPurchase | { error: string }> {
  const res = await playApi<PlaySubscriptionPurchase>('GET', `purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`)
  if (!res.ok) return { error: res.error }
  return res.data
}

export async function acknowledgeSubscription(purchaseToken: string): Promise<boolean> {
  const res = await playApi('POST', `purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`)
  return res.ok
}

/** Test-only hook for unit tests. */
export function __resetPlayTokenCache(): void {
  tokenCache = null
}
