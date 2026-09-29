// Quicky — DEV DEMO AD COMPLETION (Monetization PRD §3.4)
// POST /api/quicky/rewards/mock-complete  { sessionId }
//
// Exists ONLY for the env-gated dev/demo provider (ALLOW_MOCK_REWARDED_ADS,
// default: NODE_ENV === 'development'). The PRD forbids simulated ads as a
// production reward mechanism — when the mock provider is not allowed this
// route refuses, and the client shows the "No ads available" state instead.
// The session still flows through the SAME finalization path (amount rolled
// server-side, stored once, idempotent).
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { finalizeRewardSession } from '@/lib/quicky/rewards/sessions'
import { mockRewardedAdsAllowed } from '@/lib/quicky/rewards/config'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!mockRewardedAdsAllowed()) {
    return NextResponse.json({ error: 'mock_provider_disabled' }, { status: 403 })
  }
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const sessionId = String(body?.sessionId ?? '')
  if (!sessionId) return NextResponse.json({ error: 'invalid_session' }, { status: 400 })

  const result = await finalizeRewardSession({
    sessionId,
    provider: 'mock',
    providerTransactionId: `mock_${sessionId}`,
    allowMock: true,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  return NextResponse.json({
    ok: true,
    rewardAmount: result.rewardAmount,
    rewardType: result.rewardType,
    coinBalance: result.coinBalance,
    cyclePoints: result.cyclePoints,
    alreadyApplied: result.alreadyApplied,
  })
}
