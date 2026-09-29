// Quicky — CREATE REWARD SESSION (Monetization PRD §7.1)
// POST /api/quicky/rewards/session  { rewardType: "coins" | "realm_points", platform }
// → { sessionId, status: "pending", rewardType, expiresAt }
// The reward amount is NOT returned here — it is rolled at finalization.
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { createRewardSession, expireStaleSessions } from '@/lib/quicky/rewards/sessions'
import { rateLimit } from '@/lib/quicky/rate-limit'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // Flood guard on session creation (PRD §7.3 rate limits).
  if (!rateLimit('rewards:session', me.id, 20, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  const body = await req.json().catch(() => null)
  const rewardType = body?.rewardType === 'realm_points' ? 'REALM_POINTS' : body?.rewardType === 'coins' ? 'COINS' : null
  if (!rewardType) return NextResponse.json({ error: 'invalid_reward_type' }, { status: 400 })
  const platform = body?.platform === 'android' || body?.platform === 'ios' ? body.platform : 'web'

  // Opportunistic housekeeping — no-op when nothing is stale.
  void expireStaleSessions().catch(() => {})

  const result = await createRewardSession(me.id, rewardType, platform)
  if (!result.ok) {
    const status =
      result.error === 'daily_limit' ? 429 :
      result.error === 'cooldown' ? 429 :
      result.error === 'session_in_progress' ? 409 :
      result.error === 'reward_type_disabled' ? 403 : 503
    return NextResponse.json(
      { error: result.error, retryAfterMs: result.retryAfterMs ?? null, adsToday: result.adsToday ?? null, dailyLimit: result.dailyLimit ?? null },
      { status }
    )
  }

  const s = result.session
  return NextResponse.json({
    sessionId: s.sessionId,
    status: 'pending',
    rewardType: s.rewardType,
    provider: s.provider,
    expiresAt: s.expiresAt,
  })
}
