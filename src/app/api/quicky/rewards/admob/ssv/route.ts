// Quicky — ADMOB SERVER-SIDE VERIFICATION CALLBACK (Monetization PRD §4.3 / §7)
// GET /api/quicky/rewards/admob/ssv?<google ssv params>
//
// Google calls this endpoint directly when a rewarded ad completes (no user
// session cookie — authentication is the RSA signature on the query string).
// Configure the callback URL on the AdMob reward ad unit + pass
// custom_data=<sessionId> from the native provider before showing the ad.
//
// Responses:
//   200 — verified + credited (or verified replay: already credited)
//   202 — verified but session not pending (expired/unknown — acknowledge so
//         Google does not retry a completion that can never apply)
//   400/403/503 — invalid signature / unknown session / transient failure
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdMobSsvCallback } from '@/lib/quicky/rewards/ssv'
import { finalizeRewardSession } from '@/lib/quicky/rewards/sessions'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // 1. Signature verification against Google's rotating public keys.
  let payload
  try {
    payload = await verifyAdMobSsvCallback(req.nextUrl)
  } catch {
    // Key fetch failure — 503 makes Google retry the callback later.
    return NextResponse.json({ error: 'verification_unavailable' }, { status: 503 })
  }
  if (!payload) {
    // Bad signature / stale timestamp — fail CLOSED, do not credit.
    return NextResponse.json({ error: 'invalid_signature' }, { status: 403 })
  }

  // 2. Finalize the reward exactly once (unique provider transaction id +
  //    session idempotency make duplicate callbacks harmless).
  const result = await finalizeRewardSession({
    sessionId: payload.sessionId,
    provider: 'admob',
    providerTransactionId: payload.transactionId,
  })

  if (result.ok) {
    return NextResponse.json({ ok: true, alreadyApplied: result.alreadyApplied })
  }
  switch (result.error) {
    case 'session_not_found':
      return NextResponse.json({ error: 'unknown_session' }, { status: 400 })
    case 'session_expired':
    case 'already_finalized':
    case 'provider_mismatch':
      // Known session, nothing to apply — acknowledge so Google stops retrying.
      return NextResponse.json({ ok: true, noop: result.error }, { status: 202 })
    case 'credit_failed':
      return NextResponse.json({ error: 'credit_failed' }, { status: 503 })
    default:
      return NextResponse.json({ error: 'unknown' }, { status: 503 })
  }
}
