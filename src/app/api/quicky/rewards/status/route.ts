// Quicky — REWARDED-AD ELIGIBILITY (Monetization PRD §7)
// GET /api/quicky/rewards/status?platform=web|android|ios
// → provider availability, limits, cooldown and remaining ads today.
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { getAdEligibility } from '@/lib/quicky/rewards/sessions'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const q = req.nextUrl.searchParams.get('platform')
  const platform = q === 'android' || q === 'ios' ? q : 'web'

  const e = await getAdEligibility(me.id, platform)
  return NextResponse.json({
    canWatch: e.canWatch,
    reason: e.reason ?? null,
    provider: e.provider,
    nextAdAtMs: e.nextAdAtMs ?? null,
    cooldownRemainingMs: e.cooldownRemainingMs ?? null,
    adsToday: e.adsToday ?? null,
    dailyLimit: e.config.dailyLimit,
    config: {
      minReward: e.config.minReward,
      maxReward: e.config.maxReward,
      coinsEnabled: e.config.coinsEnabled,
      pointsEnabled: e.config.pointsEnabled,
      cooldownSeconds: e.config.cooldownSeconds,
      timezone: e.config.timezone,
    },
  })
}
