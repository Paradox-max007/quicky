// Quicky — WEB REWARDED-AD PROVIDER CALLBACK (Monetization PRD §4.2 / §7)
// POST /api/quicky/rewards/web/callback
//   headers: x-quicky-signature: hex hmac_sha256(WEB_REWARDED_AD_CALLBACK_SECRET, rawBody)
//   body:    { sessionId, transactionId }
//
// The web equivalent of AdMob SSV: a web ad provider that can verify
// completed views server-to-server pings this endpoint with an HMAC
// signature. When no web provider is configured the secret is absent and
// every call fails closed — the Watch Ad UI shows "No ads available"
// instead of pretending (PRD §1.1).
import { NextRequest, NextResponse } from 'next/server'
import { verifyWebCallbackSignature } from '@/lib/quicky/rewards/ssv'
import { finalizeRewardSession } from '@/lib/quicky/rewards/sessions'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const raw = await req.text()
  const sig = req.headers.get('x-quicky-signature')

  if (!verifyWebCallbackSignature(raw, sig)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 403 })
  }

  let body: { sessionId?: string; transactionId?: string }
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  if (!body.sessionId || !body.transactionId) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 })
  }

  const result = await finalizeRewardSession({
    sessionId: body.sessionId,
    provider: 'web_ad',
    providerTransactionId: body.transactionId,
  })

  if (result.ok) return NextResponse.json({ ok: true, alreadyApplied: result.alreadyApplied })
  switch (result.error) {
    case 'session_not_found':
      return NextResponse.json({ error: 'unknown_session' }, { status: 400 })
    case 'session_expired':
    case 'already_finalized':
    case 'provider_mismatch':
      return NextResponse.json({ ok: true, noop: result.error }, { status: 202 })
    case 'credit_failed':
      return NextResponse.json({ error: 'credit_failed' }, { status: 503 })
    default:
      return NextResponse.json({ error: 'unknown' }, { status: 503 })
  }
}
