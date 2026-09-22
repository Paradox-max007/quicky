// Quicky — ADMIN REWARD CATALOG (admin-console PRD §8/§10)
// GET    /api/quicky/admin/rewards            → full catalog (incl. disabled)
// POST   /api/quicky/admin/rewards            → create { rewardType, name, ...,
//                                                  metadata }
// PATCH  /api/quicky/admin/rewards            → update { id, data }
// DELETE /api/quicky/admin/rewards            → hard delete (only when no
//          realm rules or grants reference it — otherwise 409 + disable hint)
//
// The catalog is REUSABLE: rewards are created first, then assigned to realm
// positions through RealmRewardRule (see /admin/realm-rewards).
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, logAdminAction } from '@/lib/quicky/admin'
import { validateRewardInput, serializeReward, rewardIcon, parseRewardMetadata, REWARD_TYPES, RARITIES } from '@/lib/quicky/rewards/catalog'

export const dynamic = 'force-dynamic'

export async function GET() {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const [rewards, ruleCount, grantCount] = await Promise.all([
    db.reward.findMany({ orderBy: [{ rewardType: 'asc' }, { createdAt: 'desc' }] }),
    db.realmRewardRule.groupBy({ by: ['rewardId'], _count: { _all: true } }),
    db.userRewardGrant.groupBy({ by: ['rewardId'], _count: { _all: true } }),
  ])
  const rulesBy = new Map(ruleCount.map((r) => [r.rewardId, r._count._all]))
  const grantsBy = new Map(grantCount.map((g) => [g.rewardId, g._count._all]))

  return NextResponse.json({
    rewards: rewards.map((r) => ({
      ...serializeReward(r),
      icon: rewardIcon(parseRewardMetadata(r.metadata), r.rewardType),
      ruleCount: rulesBy.get(r.id) ?? 0,
      grantCount: grantsBy.get(r.id) ?? 0,
    })),
    rewardTypes: REWARD_TYPES,
    rarities: RARITIES,
  })
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'body_required' }, { status: 400 })
  const check = validateRewardInput(body)
  if (!check.ok) return NextResponse.json({ error: 'invalid_reward', message: check.message }, { status: 400 })

  const created = await db.reward.create({ data: check.data })
  await logAdminAction(gate.me.id, 'create', 'reward', created.id, { name: created.name, rewardType: created.rewardType })
  return NextResponse.json({ ok: true, reward: serializeReward(created) })
}

export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const body = await req.json().catch(() => null)
  const id = String(body?.id ?? '')
  const data = body?.data ?? {}
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })

  const existing = await db.reward.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // Merge patch into the existing row then re-validate the WHOLE reward.
  const merged = {
    rewardType: data.rewardType !== undefined ? String(data.rewardType) : existing.rewardType,
    name: data.name !== undefined ? data.name : existing.name,
    description: data.description !== undefined ? data.description : existing.description,
    rarity: data.rarity !== undefined ? data.rarity : existing.rarity,
    status: data.status !== undefined ? data.status : existing.status,
    metadata: data.metadata !== undefined ? data.metadata : parseRewardMetadata(existing.metadata),
  }
  const check = validateRewardInput(merged)
  if (!check.ok) return NextResponse.json({ error: 'invalid_reward', message: check.message }, { status: 400 })

  const updated = await db.reward.update({ where: { id }, data: check.data }).catch(() => null)
  if (!updated) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  await logAdminAction(gate.me.id, 'update', 'reward', id, { fields: Object.keys(data ?? {}) })
  return NextResponse.json({ ok: true, reward: serializeReward(updated) })
}

export async function DELETE(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const body = await req.json().catch(() => null)
  const id = String(body?.id ?? '')
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })

  const [rules, grants] = await Promise.all([
    db.realmRewardRule.count({ where: { rewardId: id } }),
    db.userRewardGrant.count({ where: { rewardId: id } }),
  ])
  if (rules > 0 || grants > 0) {
    // Referenced rewards keep their history — disable instead of delete.
    await db.reward.update({ where: { id }, data: { status: 'DISABLED' } }).catch(() => null)
    await logAdminAction(gate.me.id, 'disable', 'reward', id, { rules, grants })
    return NextResponse.json({ ok: true, disabled: true, rules, grants })
  }

  const gone = await db.reward.delete({ where: { id } }).catch(() => null)
  if (!gone) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  await logAdminAction(gate.me.id, 'delete', 'reward', id, { name: gone.name })
  return NextResponse.json({ ok: true, disabled: false })
}
