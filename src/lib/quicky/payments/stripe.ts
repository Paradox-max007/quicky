// Quicky — STRIPE REST CLIENT (Monetization PRD §5.2 / §10)
//
// A minimal, dependency-free Stripe client. Only the two operations the
// monetization flow needs, implemented against Stripe's stable REST API:
//   · createCheckoutSession() — server-side Checkout Session creation
//   · retrieveSession()       — payment_status check on fulfillment
// plus webhook-signature verification (timing-safe, per Stripe's spec).
//
// Why no SDK: keeps the Vercel bundle small and the surface auditable. The
// secret key NEVER leaves the server; the client is only imported by routes.
//
// Form-encoding follows Stripe's convention: metadata[purchaseId]=x.

import crypto from 'crypto'

const STRIPE_API = 'https://api.stripe.com'

export function stripeEnabled(): boolean {
  return !!process.env.STRIPE_SECRET_KEY
}

// ─── form encoding ───────────────────────────────────────────────────────────

type StripeParams = Record<string, string | number | boolean | undefined | Record<string, string | number>>

function flatten(params: StripeParams, prefix = '', out: URLSearchParams = new URLSearchParams()): URLSearchParams {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue
    const name = prefix ? `${prefix}[${key}]` : key
    if (value !== null && typeof value === 'object') {
      flatten(value as Record<string, string | number>, name, out)
    } else {
      out.set(name, String(value))
    }
  }
  return out
}

async function stripeRequest<T>(path: string, params?: StripeParams, method: 'POST' | 'GET' = 'POST'): Promise<T> {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params ? flatten(params).toString() : undefined,
    cache: 'no-store',
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } }
  if (!res.ok) {
    throw new Error(data?.error?.message ?? `stripe_error_${res.status}`)
  }
  return data
}

// ─── Checkout Sessions ───────────────────────────────────────────────────────

export type StripeCheckoutSession = {
  id: string
  object: 'checkout.session'
  payment_status: 'paid' | 'unpaid' | 'no_payment_required'
  status: 'open' | 'complete' | 'expired'
  mode: 'payment' | 'subscription'
  payment_intent?: string | null
  subscription?: string | null
  amount_total?: number | null
  currency?: string | null
  url?: string | null
  metadata?: Record<string, string> | null
}

export async function createCheckoutSession(input: {
  priceId: string
  mode: 'payment' | 'subscription'
  quantity?: number
  successUrl: string
  cancelUrl: string
  clientReferenceId: string
  metadata: Record<string, string>
}): Promise<StripeCheckoutSession> {
  return stripeRequest<StripeCheckoutSession>('/v1/checkout/sessions', {
    mode: input.mode,
    'line_items[0][price]': input.priceId,
    'line_items[0][quantity]': input.quantity ?? 1,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.clientReferenceId,
    metadata: input.metadata,
  })
}

export async function retrieveSession(sessionId: string): Promise<StripeCheckoutSession> {
  return stripeRequest<StripeCheckoutSession>(`/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, undefined, 'GET')
}

// ─── Webhook signature verification (Stripe documented scheme) ───────────────

const TOLERANCE_SECONDS = 300

/**
 * Verify the `stripe-signature` header against the raw request body.
 * Format: `t=<unix ts>,v1=<hex hmac>` (multiple v1 allowed — any match wins).
 * Timing-safe compare; fails closed on parse errors or stale timestamps.
 */
export function verifyStripeSignature(rawBody: string, signatureHeader: string | null, nowMs = Date.now()): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret || !signatureHeader) return false

  const parts = signatureHeader.split(',').map((s) => s.trim())
  let timestamp = ''
  const signatures: string[] = []
  for (const part of parts) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const k = part.slice(0, eq)
    const v = part.slice(eq + 1)
    if (k === 't') timestamp = v
    else if (k === 'v1') signatures.push(v)
  }
  if (!timestamp || signatures.length === 0) return false

  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > TOLERANCE_SECONDS) return false

  const payload = `${timestamp}.${rawBody}`
  const expected = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex')
  for (const sig of signatures) {
    const a = Buffer.from(expected, 'utf8')
    const b = Buffer.from(sig.toLowerCase(), 'utf8')
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true
  }
  return false
}
