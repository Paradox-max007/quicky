// Quicky — ADMOB SERVER-SIDE VERIFICATION (Monetization PRD §4.3)
//
// Google's rewarded-ad SSV callback is a GET with the verification payload in
// the query string. Verification procedure (Google documented):
//   1. take the raw query string UP TO (excluding) the signature parameter
//   2. base64-decode the signature (RFC 4648)
//   3. fetch Google's PUBLIC verifying keys (keyed by key_id — they ROTATE)
//   4. verify RSA-SHA256 over the unsigned query string
//   5. cross-check the custom_data session + transaction_id before crediting
//
// The pure `verifySsvSignature()` accepts an injected key map so it is fully
// unit-testable without network. `verifyAdMobSsvCallback()` is the production
// wrapper that fetches (and caches) Google's live keys.
//
// For local/staging tests without real AdMob traffic, set
// ADMOB_SSV_PUBLIC_KEY_OVERRIDE={"<keyId>":"<PEM>"} — the override ONLY
// applies to its exact key_id and never replaces Google's live key set.

import crypto from 'crypto'

export type SsvKeys = Map<string, string> // keyId (as string) → PEM

export type SsvPayload = {
  sessionId: string // custom_data
  transactionId: string // transaction_id
  timestampMs: number
  adUnit?: string
  raw: URL
}

/** Parse the query params we care about (absent ones → undefined). */
export function parseSsvPayload(url: URL): SsvPayload | null {
  const sessionId = url.searchParams.get('custom_data')
  const transactionId = url.searchParams.get('transaction_id')
  const ts = Number(url.searchParams.get('timestamp'))
  if (!sessionId || !transactionId || !Number.isFinite(ts)) return null
  return { sessionId, transactionId, timestampMs: ts * 1000, adUnit: url.searchParams.get('ad_unit') ?? undefined, raw: url }
}

/**
 * Rebuild the exact byte string Google signs: the query string up to and
 * EXCLUDING the "&signature=" separator (or "?signature=" when it is the
 * first parameter). Order of the remaining params must be preserved exactly.
 */
export function unsignedQueryString(search: string): string | null {
  const idx = search.indexOf('signature=')
  if (idx === -1) return null
  // Walk back to the separator ('?' or '&') before "signature=".
  let cut = idx
  if (cut > 0 && (search[cut - 1] === '&' || search[cut - 1] === '?')) cut -= 1
  else return null // signature glued to another param — not a valid SSV URL
  if (cut <= 0) return '' // signature was the only param
  return search.slice(0, cut)
}

/**
 * Verify one SSV callback signature. Pure + injectable keys — unit tested in
 * tests/rewards-payments.test.ts. Returns the parsed payload on success.
 *
 * Signed data: the query string WITHOUT the leading '?' and WITHOUT the
 * signature parameter — matching Google's documented procedure
 * (request.getQueryString() up to the &signature= delimiter).
 */
export function verifySsvSignature(search: string, keys: SsvKeys): SsvPayload | null {
  const unsigned = unsignedQueryString(search)
  if (unsigned === null) return null

  const tmp = new URL(`https://ssv.invalid/${search.startsWith('?') ? search : `?${search}`}`)
  const payload = parseSsvPayload(tmp)
  if (!payload) return null

  const keyId = tmp.searchParams.get('key_id')
  const sigB64 = tmp.searchParams.get('signature')
  if (!keyId || !sigB64) return null

  const pem = keys.get(keyId)
  if (!pem) return null

  let signature: Buffer
  try {
    signature = Buffer.from(sigB64, 'base64')
  } catch {
    return null
  }
  if (signature.length === 0) return null

  const data = unsigned.replace(/^\?/, '')
  const ok = crypto.verify('SHA256', Buffer.from(data, 'utf8'), pem, signature)
  return ok ? payload : null
}

// ─── Google public keys (fetch + cache, PRD §10 key rotation) ────────────────

const GOOGLE_KEYS_URL = 'https://www.googleadapis.com/admob/reward/verifying-keys.json'
const KEYS_TTL_MS = 24 * 60 * 60 * 1000

let keyCache: { at: number; keys: SsvKeys } | null = null

export function clearSsvKeyCache(): void {
  keyCache = null
}

/**
 * Google's verifying keys, cached for 24h. Format:
 *   { "keys": [ { "key": <number>, "pem": "-----BEGIN PUBLIC KEY-----..." } ] }
 * (Both "key" and "keyId" field names are accepted defensively.)
 */
export async function fetchAdMobSsvKeys(): Promise<SsvKeys> {
  if (keyCache && Date.now() - keyCache.at < KEYS_TTL_MS) return keyCache.keys

  const keys: SsvKeys = new Map()

  // Local override keys for dev/staging QA only — merged by exact key_id.
  const overrideRaw = process.env.ADMOB_SSV_PUBLIC_KEY_OVERRIDE
  if (overrideRaw) {
    try {
      const parsed = JSON.parse(overrideRaw) as Record<string, string>
      for (const [k, v] of Object.entries(parsed)) keys.set(String(k), v)
    } catch {
      // malformed override → ignored, live keys still load
    }
  }

  try {
    const res = await fetch(GOOGLE_KEYS_URL, { cache: 'no-store' })
    if (res.ok) {
      const data = (await res.json()) as { keys?: Array<Record<string, unknown>> }
      for (const entry of data.keys ?? []) {
        const id = entry.keyId ?? entry.key
        const pem = entry.pem
        if (id !== undefined && typeof pem === 'string') keys.set(String(id), pem)
      }
    }
  } catch {
    // Network failure: if we at least have override keys, QA can continue;
    // otherwise the callback verification fails closed (safe default).
    if (keys.size === 0) throw new Error('admob_ssv_keys_unavailable')
  }

  keyCache = { at: Date.now(), keys }
  return keys
}

/**
 * Full production verification: Google keys + signature + freshness.
 * Timestamps older than 5 minutes are rejected (clock skew allowance).
 */
export async function verifyAdMobSsvCallback(url: URL): Promise<SsvPayload | null> {
  const keys = await fetchAdMobSsvKeys()
  const payload = verifySsvSignature(url.search, keys)
  if (!payload) return null
  if (Math.abs(Date.now() - payload.timestampMs) > 5 * 60 * 1000) return null
  return payload
}

// ─── Signed web-provider callback (PRD §4.2 web verification) ───────────────

/**
 * HMAC-SHA256 verification for a web rewarded-ad provider's server-to-server
 * completion ping (the web equivalent of AdMob SSV). Contract:
 *   header  x-quicky-signature: hex(hmac_sha256(WEB_REWARDED_AD_CALLBACK_SECRET, rawBody))
 *   body    { sessionId, transactionId }
 * Timing-safe compare; fails closed when the secret is not configured.
 */
export function verifyWebCallbackSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.WEB_REWARDED_AD_CALLBACK_SECRET
  if (!secret || !signatureHeader) return false
  const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(signatureHeader.trim().toLowerCase(), 'utf8')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
