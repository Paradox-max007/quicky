// Quicky — ADMIN REALM REWARD RULES (admin-console PRD §10)
// GET /api/quicky/admin/realm-rewards            → rules + catalog + bundles
// PUT /api/quicky/admin/realm-rewards            → REPLACE a realm's rules
//      { realmLevel, entries: [{ position, kind, … }] }
//
// ONE reward system, ONE set of rewards per won place. Entry kinds:
//   · COINS        { amount }                      → auto-managed reward row
//   · CRATE_POINTS { amount }                      → auto-managed reward row
//   · STICKER_SET  { bundleId }                    → auto-managed reward row
//   · REWARD       { rewardId, level? }            → Frames / Hats / Name
//                                                    Icons catalog reference
//                                                    (level 1-3 for cosmetics)
//
// Auto-managed rows use deterministic ids (rmw-<level>-p<pos>-<kind>) so a
// re-save upserts the same row — amount edits rewrite the reward, grants stay
// stable. Place limits (realm PRD §53): 1st ≤ 5, 2nd ≤ 3, 3rd ≤ 1. Edits
// apply to FUTURE cycles: running cycles keep their creation-time snapshot.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, logAdminAction } from '@/lib/quicky/admin'
import { serializeReward } from '@/lib/quicky/rewards/catalog'

export const dynamic = 'force-dynamic'

const PLACE_LIMITS: Record<number, number> = { 1: 5, 2: 3, 3: 1 }
/** Cosmetic kinds pickable directly in the Realms screen (with a level). */
const PICKABLE_TYPES = ['PROFILE_FRAME', 'HAT', 'NAME_DECORATOR'] as const

export async function GET() {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const [rules, rewards, stickerBundles] = await Promise.all([
    db.realmRewardRule.findMany({ orderBy: [{ realmLevel: 'asc' }, { position: 'asc' }] }),
    db.reward.findMany({ where: { status: 'ACTIVE' }, orderBy: [{ rewardType: 'asc' }, { name: 'asc' }] }),
    db.gameStickerBundle.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }).catch(() => []),
  ])
  return NextResponse.json({
    rules: rules.map((r) => ({ id: r.id, realmLevel: r.realmLevel, position: r.position, rewardId: r.rewardId, level: r.level, quantity: r.quantity, isActive: r.isActive })),
    rewards: rewards.map((r) => serializeReward(r)),
    stickerBundles,
    placeLimits: PLACE_LIMITS,
  })
}

type IncomingEntry = {
  position: number
  kind: 'COINS' | 'CRATE_POINTS' | 'STICKER_SET' | 'REWARD'
  amount?: number
  bundleId?: string
  rewardId?: string
  level?: number
}

export async function PUT(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const body = await req.json().catch(() => null)
  const realmLevel = Number(body?.realmLevel)
  const incoming = Array.isArray(body?.entries) ? (body.entries as IncomingEntry[]) : null
  if (!Number.isInteger(realmLevel) || realmLevel < 1 || realmLevel > 15) {
    return NextResponse.json({ error: 'invalid_realm_level' }, { status: 400 })
  }
  if (!incoming) return NextResponse.json({ error: 'entries_required' }, { status: 400 })
  if (incoming.length > 15) return NextResponse.json({ error: 'too_many_entries' }, { status: 400 })

  // Validate the full replacement before touching the DB (§10.2).
  const byPosition: Record<number, IncomingEntry[]> = { 1: [], 2: [], 3: [] }
  for (const entry of incoming) {
    const position = Number(entry.position)
    if (!PLACE_LIMITS[position]) return NextResponse.json({ error: 'invalid_position' }, { status: 400 })
    const kind = String(entry.kind ?? '')
    if (!['COINS', 'CRATE_POINTS', 'STICKER_SET', 'REWARD'].includes(kind)) {
      return NextResponse.json({ error: 'invalid_kind', message: `Unknown reward kind "${kind}".` }, { status: 400 })
    }
    if (kind === 'COINS') {
      const amount = Number(entry.amount)
      if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000) {
        return NextResponse.json({ error: 'invalid_amount', message: 'Coins need an amount between 1 and 1,000,000.' }, { status: 400 })
      }
    }
    if (kind === 'CRATE_POINTS') {
      const amount = Number(entry.amount)
      if (!Number.isInteger(amount) || amount < 1 || amount > 100_000) {
        return NextResponse.json({ error: 'invalid_amount', message: 'Crate points need an amount between 1 and 100,000.' }, { status: 400 })
      }
    }
    if (kind === 'STICKER_SET' && (typeof entry.bundleId !== 'string' || !entry.bundleId)) {
      return NextResponse.json({ error: 'bundle_required', message: 'Sticker-set entries need a bundle.' }, { status: 400 })
    }
    if (kind === 'REWARD' && (typeof entry.rewardId !== 'string' || !entry.rewardId)) {
      return NextResponse.json({ error: 'reward_required', message: 'Cosmetic entries need a catalog reward.' }, { status: 400 })
    }
    byPosition[position].push({ ...entry, position, kind: kind as IncomingEntry['kind'] })
  }
  for (const [position, list] of Object.entries(byPosition)) {
    const limit = PLACE_LIMITS[Number(position)]
    if (list.length > limit) {
      const label = position === '1' ? '1st' : position === '2' ? '2nd' : '3rd'
      return NextResponse.json({ error: 'place_limit', message: `${label} place allows at most ${limit} reward${limit > 1 ? 's' : ''}.` }, { status: 400 })
    }
    // One entry per managed kind per place (amount edits rewrite the row) —
    // two coin entries at the same place would silently overwrite each other.
    const managedSeen = new Set<string>()
    const rewardSeen = new Set<string>()
    for (const entry of list) {
      if (entry.kind !== 'REWARD') {
        if (managedSeen.has(entry.kind)) {
          return NextResponse.json({ error: 'duplicate_kind', message: 'Only one coins / crate-points / sticker-set entry per place.' }, { status: 400 })
        }
        managedSeen.add(entry.kind)
      } else {
        const key = `${entry.rewardId}:${entry.level ?? 1}`
        if (rewardSeen.has(key)) return NextResponse.json({ error: 'duplicate_rule', rewardId: entry.rewardId }, { status: 400 })
        rewardSeen.add(key)
      }
    }
  }

  // Validate catalog references: sticker bundles exist, cosmetic rewards are
  // ACTIVE frames / hats / name icons (levels apply to cosmetics only).
  const bundleIds = incoming.filter((e) => e.kind === 'STICKER_SET').map((e) => String(e.bundleId))
  const rewardIds = Array.from(new Set(incoming.filter((e) => e.kind === 'REWARD').map((e) => String(e.rewardId))))
  const [bundles, rewards] = await Promise.all([
    bundleIds.length
      ? db.gameStickerBundle.findMany({ where: { id: { in: bundleIds } }, select: { id: true, name: true } })
      : Promise.resolve([] as { id: string; name: string }[]),
    rewardIds.length
      ? db.reward.findMany({ where: { id: { in: rewardIds } }, select: { id: true, rewardType: true, status: true } })
      : Promise.resolve([] as { id: string; rewardType: string; status: string }[]),
  ])
  const bundleById = new Map(bundles.map((b) => [b.id, b]))
  const rewardById = new Map(rewards.map((r) => [r.id, r]))
  for (const entry of incoming) {
    if (entry.kind === 'STICKER_SET' && !bundleById.has(String(entry.bundleId))) {
      return NextResponse.json({ error: 'bundle_not_found', bundleId: entry.bundleId }, { status: 400 })
    }
    if (entry.kind === 'REWARD') {
      const reward = rewardById.get(String(entry.rewardId))
      if (!reward) return NextResponse.json({ error: 'reward_not_found', rewardId: entry.rewardId }, { status: 400 })
      if (reward.status !== 'ACTIVE') return NextResponse.json({ error: 'reward_disabled', rewardId: entry.rewardId }, { status: 400 })
      if (!(PICKABLE_TYPES as readonly string[]).includes(reward.rewardType)) {
        return NextResponse.json(
          { error: 'reward_not_pickable', message: 'Realm rewards can reference frames, hats and name icons (coins / crate points / sticker sets are their own entry kinds).' },
          { status: 400 }
        )
      }
    }
  }

  // Resolve every entry to a concrete Reward row (creating/updating the
  // auto-managed ones), then REPLACE the realm's rules in one transaction.
  const ruleRows: { position: number; rewardId: string; level: number; quantity: number }[] = []
  await db.$transaction(async (tx) => {
    for (const entry of incoming) {
      const position = Number(entry.position)
      if (entry.kind === 'COINS') {
        const amount = Math.floor(Number(entry.amount))
        const id = `rmw-${realmLevel}-p${position}-coins`
        await tx.reward.upsert({
          where: { id },
          create: { id, rewardType: 'COINS', name: `${amount.toLocaleString()} Coins`, description: `Realm ${realmLevel} · ${position === 1 ? '1st' : position === 2 ? '2nd' : '3rd'} place prize`, rarity: 'COMMON', status: 'ACTIVE', metadata: JSON.stringify({ coinAmount: amount }) },
          update: { name: `${amount.toLocaleString()} Coins`, metadata: JSON.stringify({ coinAmount: amount }), status: 'ACTIVE' },
        })
        ruleRows.push({ position, rewardId: id, level: 1, quantity: 1 })
      } else if (entry.kind === 'CRATE_POINTS') {
        const amount = Math.floor(Number(entry.amount))
        const id = `rmw-${realmLevel}-p${position}-cratepts`
        await tx.reward.upsert({
          where: { id },
          create: { id, rewardType: 'CRATE_POINTS', name: `${amount.toLocaleString()} Crate Points`, description: `Realm ${realmLevel} · ${position === 1 ? '1st' : position === 2 ? '2nd' : '3rd'} place prize`, rarity: 'RARE', status: 'ACTIVE', metadata: JSON.stringify({ cratePoints: amount }) },
          update: { name: `${amount.toLocaleString()} Crate Points`, metadata: JSON.stringify({ cratePoints: amount }), status: 'ACTIVE' },
        })
        ruleRows.push({ position, rewardId: id, level: 1, quantity: 1 })
      } else if (entry.kind === 'STICKER_SET') {
        const bundle = bundleById.get(String(entry.bundleId))
        const id = `rmw-${realmLevel}-p${position}-stickers`
        await tx.reward.upsert({
          where: { id },
          create: { id, rewardType: 'STICKER_SET', name: `${bundle?.name ?? 'Sticker Set'} (set)`, description: `Realm ${realmLevel} · ${position === 1 ? '1st' : position === 2 ? '2nd' : '3rd'} place prize`, rarity: 'EPIC', status: 'ACTIVE', metadata: JSON.stringify({ bundleId: bundle?.id }) },
          update: { name: `${bundle?.name ?? 'Sticker Set'} (set)`, metadata: JSON.stringify({ bundleId: bundle?.id }), status: 'ACTIVE' },
        })
        ruleRows.push({ position, rewardId: id, level: 1, quantity: 1 })
      } else {
        const level = Math.min(3, Math.max(1, Math.floor(Number(entry.level) || 1)))
        ruleRows.push({ position, rewardId: String(entry.rewardId), level, quantity: 1 })
      }
    }

    await tx.realmRewardRule.deleteMany({ where: { realmLevel } })
    if (ruleRows.length > 0) {
      await tx.realmRewardRule.createMany({
        data: ruleRows.map((rule) => ({
          realmLevel,
          position: rule.position,
          rewardId: rule.rewardId,
          level: rule.level,
          quantity: rule.quantity,
          isActive: true,
        })),
      })
    }
  })

  await logAdminAction(gate.me.id, 'update', 'realm_reward_rules', String(realmLevel), { count: ruleRows.length })
  return NextResponse.json({ ok: true, realmLevel, count: ruleRows.length })
}
