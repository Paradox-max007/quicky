// Quicky — ADMIN: REWARDED ADS (Monetization PRD §9.1)
// GET  /api/quicky/admin/rewarded-ads            → config + stats + recent sessions
// GET  /api/quicky/admin/rewarded-ads?userId=..  → sessions for one user (search)
// POST /api/quicky/admin/rewarded-ads { key, value } → update a reward setting
//
// (Deliberately NOT /admin/rewards — that path is the cosmetics reward
// CATALOG. This one is the rewarded-ads configuration surface.)
//
// Config lives in AdminSetting; every change is validated + audit-logged and
// NEVER retroactively modifies completed sessions (PRD §9.1).
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, logAdminAction } from '@/lib/quicky/admin'
import { getRewardAdConfig, clampRewardSetting } from '@/lib/quicky/rewards/config'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const userId = req.nextUrl.searchParams.get('userId')?.trim() || null
  const since = new Date(Date.now() - 30 * 24 * 3600_000)

  const [config, sessions, stats] = await Promise.all([
    getRewardAdConfig(),
    db.rewardAdSession.findMany({
      where: userId ? { userId } : { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true, userId: true, rewardType: true, status: true, provider: true,
        rewardAmount: true, createdAt: true, completedAt: true, expiresAt: true,
      },
    }),
    db.rewardAdSession.groupBy({
      by: ['status'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
  ])

  const [impressions, completions, rewardsIssued] = await Promise.all([
    db.rewardAdSession.count({ where: { createdAt: { gte: since }, status: { not: 'CANCELLED' } } }),
    db.rewardAdSession.count({ where: { createdAt: { gte: since }, status: 'COMPLETED' } }),
    db.walletTransaction.aggregate({
      where: { transactionType: 'AD_REWARD', createdAt: { gte: since } },
      _count: { _all: true },
    }),
  ])

  return NextResponse.json({
    config,
    stats: {
      windowDays: 30,
      impressions,
      completions,
      verificationFailureRate: impressions > 0 ? +(1 - completions / impressions).toFixed(3) : 0,
      rewardsIssuedCount: rewardsIssued._count._all,
      byStatus: Object.fromEntries(stats.map((s) => [s.status, s._count._all])),
    },
    sessions: sessions.map((s) => ({ ...s, createdAt: s.createdAt.toISOString(), completedAt: s.completedAt?.toISOString() ?? null, expiresAt: s.expiresAt.toISOString() })),
    userFilter: userId,
  })
}

const BOOL_KEYS = ['rewards.ads.enabled', 'rewards.ads.coinsEnabled', 'rewards.ads.pointsEnabled']
const NUMBER_KEYS = ['rewards.ads.minReward', 'rewards.ads.maxReward', 'rewards.ads.dailyLimit', 'rewards.ads.cooldownSeconds']
const TZ_KEY = 'rewards.ads.timezone'

export async function POST(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const body = await req.json().catch(() => null)
  const key = String(body?.key ?? '')
  const value = body?.value

  if (![...BOOL_KEYS, ...NUMBER_KEYS, TZ_KEY].includes(key)) {
    return NextResponse.json({ error: 'invalid_key' }, { status: 400 })
  }

  let stored: string
  if (BOOL_KEYS.includes(key)) {
    if (typeof value !== 'boolean') return NextResponse.json({ error: 'invalid_value' }, { status: 400 })
    stored = value ? 'true' : 'false'
  } else if (NUMBER_KEYS.includes(key)) {
    const n = Number(value)
    if (!Number.isFinite(n)) return NextResponse.json({ error: 'invalid_value' }, { status: 400 })
    const clamped = clampRewardSetting(key, n)
    if (clamped === null) return NextResponse.json({ error: 'invalid_value' }, { status: 400 })
    stored = String(clamped)
    // min <= max enforced as a pair on read; reject obvious inversions here.
    if (key.endsWith('minReward') || key.endsWith('maxReward')) {
      const cfg = await getRewardAdConfig()
      const isMin = key.endsWith('minReward')
      const other = isMin ? cfg.maxReward : cfg.minReward
      if (isMin && clamped > other) return NextResponse.json({ error: 'min_exceeds_max' }, { status: 400 })
      if (!isMin && clamped < other) return NextResponse.json({ error: 'max_below_min' }, { status: 400 })
    }
  } else {
    const tz = String(value ?? 'UTC').trim()
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz })
    } catch {
      return NextResponse.json({ error: 'invalid_timezone' }, { status: 400 })
    }
    stored = tz
  }

  await db.adminSetting.upsert({
    where: { key },
    update: { value: stored },
    create: { key, value: stored },
  })
  await logAdminAction(gate.me.id, 'update', 'reward_config', key, { value: stored })

  return NextResponse.json({ ok: true, key, value: stored, config: await getRewardAdConfig() })
}
