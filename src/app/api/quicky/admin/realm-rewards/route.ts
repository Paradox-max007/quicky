// Quicky — ADMIN REALM REWARD RULES (admin-console PRD §10)
// GET /api/quicky/admin/realm-rewards            → rules + catalog rewards
// PUT /api/quicky/admin/realm-rewards            → REPLACE a realm's rules
//      { realmLevel, rules: [{ position, rewardId, level, quantity }] }
//
// Rules attach catalog rewards to winner positions (1st ≤ 5, 2nd ≤ 3,
// 3rd ≤ 1 — the realm PRD §53 place limits). Edits apply to FUTURE cycles:
// running cycles keep their creation-time snapshot (§26/§39).
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, logAdminAction } from '@/lib/quicky/admin'
import { COSMETIC_TYPES } from '@/lib/quicky/rewards/catalog'
import { serializeReward } from '@/lib/quicky/rewards/catalog'

export const dynamic = 'force-dynamic'

const PLACE_LIMITS: Record<number, number> = { 1: 5, 2: 3, 3: 1 }

export async function GET() {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const [rules, rewards] = await Promise.all([
    db.realmRewardRule.findMany({ orderBy: [{ realmLevel: 'asc' }, { position: 'asc' }] }),
    db.reward.findMany({ where: { status: 'ACTIVE' }, orderBy: [{ rewardType: 'asc' }, { name: 'asc' }] }),
  ])
  return NextResponse.json({
    rules: rules.map((r) => ({ id: r.id, realmLevel: r.realmLevel, position: r.position, rewardId: r.rewardId, level: r.level, quantity: r.quantity, isActive: r.isActive })),
    rewards: rewards.map((r) => serializeReward(r)),
    placeLimits: PLACE_LIMITS,
  })
}

type IncomingRule = { position: number; rewardId: string; level: number; quantity: number }

export async function PUT(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const body = await req.json().catch(() => null)
  const realmLevel = Number(body?.realmLevel)
  const incoming = Array.isArray(body?.rules) ? (body.rules as IncomingRule[]) : null
  if (!Number.isInteger(realmLevel) || realmLevel < 1 || realmLevel > 15) {
    return NextResponse.json({ error: 'invalid_realm_level' }, { status: 400 })
  }
  if (!incoming) return NextResponse.json({ error: 'rules_required' }, { status: 400 })

  // Validate the full replacement before touching the DB (§10.2).
  const byPosition: Record<number, IncomingRule[]> = { 1: [], 2: [], 3: [] }
  for (const rule of incoming) {
    const position = Number(rule.position)
    if (!PLACE_LIMITS[position]) return NextResponse.json({ error: 'invalid_position' }, { status: 400 })
    if (typeof rule.rewardId !== 'string' || !rule.rewardId) return NextResponse.json({ error: 'reward_required' }, { status: 400 })
    const level = Math.min(3, Math.max(1, Math.floor(Number(rule.level) || 1)))
    const quantity = Math.min(1000, Math.max(1, Math.floor(Number(rule.quantity) || 1)))
    byPosition[position].push({ position, rewardId: rule.rewardId, level, quantity })
  }
  for (const [position, list] of Object.entries(byPosition)) {
    const limit = PLACE_LIMITS[Number(position)]
    if (list.length > limit) {
      const label = position === '1' ? '1st' : position === '2' ? '2nd' : '3rd'
      return NextResponse.json({ error: 'place_limit', message: `${label} place allows at most ${limit} reward${limit > 1 ? 's' : ''}.` }, { status: 400 })
    }
  }
  const rewardIds = Array.from(new Set(incoming.map((r) => r.rewardId)))
  const rewards = rewardIds.length ? await db.reward.findMany({ where: { id: { in: rewardIds } }, select: { id: true, rewardType: true, status: true } }) : []
  const byId = new Map(rewards.map((r) => [r.id, r]))
  for (const rule of incoming) {
    const reward = byId.get(rule.rewardId)
    if (!reward) return NextResponse.json({ error: 'reward_not_found', rewardId: rule.rewardId }, { status: 400 })
    if (reward.status !== 'ACTIVE') return NextResponse.json({ error: 'reward_disabled', rewardId: rule.rewardId }, { status: 400 })
    // Cosmetic levels only apply to cosmetic types.
    if (!(COSMETIC_TYPES as string[]).includes(reward.rewardType) && (rule.level ?? 1) !== 1) {
      return NextResponse.json({ error: 'level_not_applicable', message: 'Levels apply to hats, frames, name decorators and chat bubbles only.' }, { status: 400 })
    }
  }
  // No duplicate reward at the same position + level.
  for (const list of Object.values(byPosition)) {
    const seen = new Set<string>()
    for (const rule of list) {
      const key = `${rule.rewardId}:${rule.level}`
      if (seen.has(key)) return NextResponse.json({ error: 'duplicate_rule', rewardId: rule.rewardId }, { status: 400 })
      seen.add(key)
    }
  }

  await db.$transaction(async (tx) => {
    await tx.realmRewardRule.deleteMany({ where: { realmLevel } })
    if (incoming.length > 0) {
      await tx.realmRewardRule.createMany({
        data: incoming.map((rule) => ({
          realmLevel,
          position: rule.position,
          rewardId: rule.rewardId,
          level: Math.min(3, Math.max(1, Math.floor(rule.level) || 1)),
          quantity: Math.min(1000, Math.max(1, Math.floor(rule.quantity) || 1)),
          isActive: true,
        })),
      })
    }
  })

  await logAdminAction(gate.me.id, 'update', 'realm_reward_rules', String(realmLevel), { count: incoming.length })
  return NextResponse.json({ ok: true, realmLevel, count: incoming.length })
}
