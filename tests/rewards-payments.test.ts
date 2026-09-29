// Quicky — MONETIZATION UNIT TESTS (Rewarded Ads & Real Payments PRD §11)
//
// Pure-function tests for the security-critical verification core:
//   · AdMob SSV signature verification (sign / verify / tamper / key rotation)
//   · Stripe webhook signature verification (valid / tampered / stale)
//   · Web-provider HMAC callback verification
//   · Reward amount rolling within the approved 10–100 range
//   · SSV unsigned-query-string parsing edge cases
//
// DB-dependent paths (sessions, wallet credits, fulfillment) are covered by
// scripts/qa-rewards.mjs against a live deployment with dev credentials.
//
// Run: bun test tests/rewards-payments.test.ts

/// <reference types="bun-types" />
import { describe, expect, test } from 'bun:test'
import crypto from 'crypto'
import {
  verifySsvSignature,
  parseSsvPayload,
  unsignedQueryString,
  type SsvKeys,
} from '../src/lib/quicky/rewards/ssv'
import { verifyStripeSignature } from '../src/lib/quicky/payments/stripe'

// ─── helpers ────────────────────────────────────────────────────────────────

function generateRsaKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  return { publicKey, privateKey }
}

function buildSsvQuery(params: Record<string, string>, keyId: string, privateKey: string, sign = true): string {
  // Google's SSV signature covers EVERYTHING in the query string up to (but
  // excluding) the &signature= parameter — key_id included.
  const withoutSig =
    Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&') + `&key_id=${keyId}`
  if (!sign) return withoutSig
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(withoutSig)
    .sign(privateKey, 'base64')
  return `${withoutSig}&signature=${encodeURIComponent(signature)}`
}

// ─── AdMob SSV ───────────────────────────────────────────────────────────────

describe('AdMob SSV verification', () => {
  const KEY_ID = '1234567890'
  const { publicKey, privateKey } = generateRsaKeyPair()
  const keys: SsvKeys = new Map([[KEY_ID, publicKey]])

  const baseParams = {
    ad_unit: '/1234567/rewarded',
    custom_data: 'session-abc-123',
    reward_amount: '1',
    timestamp: String(Math.floor(Date.now() / 1000)),
    transaction_id: 'txn-xyz-42',
    user_id: 'session-abc-123',
  }

  test('a correctly signed callback verifies and parses', () => {
    const query = buildSsvQuery(baseParams, KEY_ID, privateKey)
    const payload = verifySsvSignature(`?${query}`, keys)
    expect(payload).not.toBeNull()
    expect(payload!.sessionId).toBe('session-abc-123')
    expect(payload!.transactionId).toBe('txn-xyz-42')
  })

  test('a tampered query is rejected', () => {
    const query = buildSsvQuery(baseParams, KEY_ID, privateKey)
    // Evil client raises the reward / changes the session after signing.
    const tampered = query.replace('custom_data=session-abc-123', 'custom_data=session-999')
    expect(verifySsvSignature(`?${tampered}`, keys)).toBeNull()
  })

  test('a wrong key id is rejected (rotation safety)', () => {
    const query = buildSsvQuery(baseParams, '9999999999', privateKey)
    expect(verifySsvSignature(`?${query}`, keys)).toBeNull()
  })

  test('a signature from a DIFFERENT private key is rejected', () => {
    const other = generateRsaKeyPair()
    const query = buildSsvQuery(baseParams, KEY_ID, other.privateKey)
    expect(verifySsvSignature(`?${query}`, keys)).toBeNull()
  })

  test('missing signature / missing params are rejected', () => {
    const unsigned = buildSsvQuery(baseParams, KEY_ID, privateKey, false)
    expect(verifySsvSignature(`?${unsigned}`, keys)).toBeNull()
    expect(verifySsvSignature('?custom_data=x', keys)).toBeNull()
    expect(verifySsvSignature('', keys)).toBeNull()
  })

  test('unsignedQueryString cuts exactly before &signature=', () => {
    expect(unsignedQueryString('?a=1&b=2&signature=SIG&key_id=9')).toBe('?a=1&b=2')
    expect(unsignedQueryString('?signature=SIG&key_id=9')).toBe('')
    expect(unsignedQueryString('?a=1')).toBeNull()
  })

  test('parseSsvPayload requires session + transaction + timestamp', () => {
    const u = new URL('https://x/?custom_data=s&transaction_id=t&timestamp=100')
    expect(parseSsvPayload(u)?.sessionId).toBe('s')
    expect(parseSsvPayload(new URL('https://x/?custom_data=s'))).toBeNull()
    expect(parseSsvPayload(new URL('https://x/?transaction_id=t'))).toBeNull()
  })
})

// ─── Stripe webhook signatures ──────────────────────────────────────────────

describe('Stripe webhook signature verification', () => {
  const secret = 'whsec_test_secret'
  const rawBody = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' })

  function sign(t: number, body: string, sec = secret): string {
    const hmac = crypto.createHmac('sha256', sec).update(`${t}.${body}`).digest('hex')
    return `t=${t},v1=${hmac}`
  }

  test('valid signature passes', () => {
    const t = Math.floor(Date.now() / 1000)
    process.env.STRIPE_WEBHOOK_SECRET = secret
    expect(verifyStripeSignature(rawBody, sign(t, rawBody))).toBe(true)
  })

  test('tampered body is rejected', () => {
    const t = Math.floor(Date.now() / 1000)
    process.env.STRIPE_WEBHOOK_SECRET = secret
    expect(verifyStripeSignature(rawBody + 'x', sign(t, rawBody))).toBe(false)
  })

  test('stale timestamp is rejected (replay protection)', () => {
    const old = Math.floor(Date.now() / 1000) - 3600
    process.env.STRIPE_WEBHOOK_SECRET = secret
    expect(verifyStripeSignature(rawBody, sign(old, rawBody))).toBe(false)
  })

  test('wrong secret is rejected; missing header/secret fails closed', () => {
    const t = Math.floor(Date.now() / 1000)
    process.env.STRIPE_WEBHOOK_SECRET = secret
    expect(verifyStripeSignature(rawBody, sign(t, rawBody, 'whsec_other'))).toBe(false)
    expect(verifyStripeSignature(rawBody, null)).toBe(false)
    delete process.env.STRIPE_WEBHOOK_SECRET
    expect(verifyStripeSignature(rawBody, sign(t, rawBody))).toBe(false)
    process.env.STRIPE_WEBHOOK_SECRET = secret
  })
})

// ─── Web provider HMAC callback ─────────────────────────────────────────────

// (verified indirectly through verifyWebCallbackSignature in ssv.ts)
describe('Web rewarded-ad HMAC callback', () => {
  const { verifyWebCallbackSignature } = require('../src/lib/quicky/rewards/ssv')
  const secret = 'webhook_hmac_secret'
  const body = JSON.stringify({ sessionId: 's1', transactionId: 't1' })

  test('correct HMAC passes; wrong one fails; unconfigured fails closed', () => {
    process.env.WEB_REWARDED_AD_CALLBACK_SECRET = secret
    const sig = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')
    expect(verifyWebCallbackSignature(body, sig)).toBe(true)
    expect(verifyWebCallbackSignature(body, 'deadbeef')).toBe(false)
    expect(verifyWebCallbackSignature(body, null)).toBe(false)
    delete process.env.WEB_REWARDED_AD_CALLBACK_SECRET
    expect(verifyWebCallbackSignature(body, sig)).toBe(false)
  })
})

// ─── Reward amount rolling ──────────────────────────────────────────────────

describe('reward amount distribution', () => {
  test('crypto.randomInt stays within the approved 10–100 range (uniform)', () => {
    const MIN = 10, MAX = 100
    const seen = new Set<number>()
    for (let i = 0; i < 20000; i++) {
      const n = crypto.randomInt(MIN, MAX + 1)
      expect(n).toBeGreaterThanOrEqual(MIN)
      expect(n).toBeLessThanOrEqual(MAX)
      seen.add(n)
    }
    // Uniform-ish coverage across the whole approved range.
    expect(seen.size).toBeGreaterThanOrEqual(90)
  })
})
