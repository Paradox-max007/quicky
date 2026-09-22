// Quicky — ADMIN REALM CYCLES DASHBOARD (realm PRD §54-§55)
// GET /api/quicky/admin/realm-cycles                — current cycles per
//   realm level (start/end, players, cohort count) + definitions
// GET /api/quicky/admin/realm-cycles?cohortId=...   — one cohort's live
//   standings (rank / points / threshold flags) with point totals
// GET /api/quicky/admin/realm-cycles?settle=1       — run the idempotent
//   settlement job now (cron-style trigger)
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/quicky/admin'
import { ensureRealmBootstrap } from '@/lib/quicky/realm/realm-config'
import { settleDueCycles } from '@/lib/quicky/realm/realm-cycle'

export async function GET(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  await ensureRealmBootstrap()

  // Manual settlement trigger (idempotent — the SETTLING lock guards).
  if (req.nextUrl.searchParams.get('settle') === '1') {
    const settled = await settleDueCycles().catch(() => 0)
    return NextResponse.json({ ok: true, settled })
  }

  const cohortId = req.nextUrl.searchParams.get('cohortId')
  if (cohortId) {
    const cohort = await db.realmCohort.findUnique({ where: { id: cohortId } })
    if (!cohort) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const cycle = await db.realmCycle.findUnique({ where: { id: cohort.cycleId } })
    const members = await db.realmCohortMember.findMany({ where: { cohortId }, orderBy: { cyclePoints: 'desc' } })
    const users = await db.user.findMany({
      where: { id: { in: members.map((m) => m.userId) } },
      select: { id: true, name: true, photos: { where: { isPrivate: false }, take: 1, select: { url: true } } },
    })
    const byId = new Map(users.map((u) => [u.id, u]))
    return NextResponse.json({
      cohort: {
        id: cohort.id,
        realmLevel: cohort.realmLevel,
        isFinalized: cohort.isFinalized,
        cycleId: cohort.cycleId,
        threshold: cycle?.threshold ?? 0,
        status: cycle?.status ?? 'ACTIVE',
        endAt: cycle?.endAt.toISOString() ?? null,
        members: members.map((m, i) => ({
          rank: m.finalRank ?? i + 1,
          userId: m.userId,
          name: byId.get(m.userId)?.name ?? 'Player',
          avatar: byId.get(m.userId)?.photos[0]?.url ?? null,
          cyclePoints: m.cyclePoints,
          finalRank: m.finalRank,
          promoted: m.promoted,
          joinedAt: m.joinedAt.toISOString(),
        })),
      },
    })
  }

  // Dashboard: active cycles per level + player/cohort counts (grouped).
  const [defs, cycles, cohortAgg, memberAgg] = await Promise.all([
    db.realmDefinition.findMany({ orderBy: { level: 'asc' } }),
    db.realmCycle.findMany({ where: { status: { in: ['ACTIVE', 'SETTLING'] } }, orderBy: { realmLevel: 'asc' } }),
    db.realmCohort.groupBy({ by: ['realmLevel'], where: { isFinalized: false }, _count: { _all: true } }),
    db.realmCohortMember.groupBy({ by: ['cohortId'], _count: { _all: true } }),
  ])

  const memberCountByCohort = new Map(memberAgg.map((m) => [m.cohortId, m._count._all]))
  const cohortCountByLevel = new Map(cohortAgg.map((c) => [c.realmLevel, c._count._all]))
  const cycleByLevel = new Map(cycles.map((c) => [c.realmLevel, c]))

  const realmRows = defs.map((d) => {
    const cycle = cycleByLevel.get(d.level)
    return {
      level: d.level,
      name: d.name,
      isActive: d.isActive,
      promotionThreshold: d.promotionThreshold,
      cycleDurationDays: d.cycleDurationDays,
      rewards: d.rewards,
      cycle: cycle
        ? {
            id: cycle.id,
            status: cycle.status,
            startAt: cycle.startAt.toISOString(),
            endAt: cycle.endAt.toISOString(),
            thresholdSnapshot: cycle.threshold,
            cohorts: cohortCountByLevel.get(d.level) ?? 0,
            players: 0,
          }
        : null,
    }
  })

  // Fill per-level player counts from cohort membership (one grouped query).
  const activeCohorts = cycles.length
    ? await db.realmCohort.findMany({ where: { cycleId: { in: cycles.map((c) => c.id) } }, select: { id: true, realmLevel: true } })
    : []
  const memberAgg2 = await db.realmCohortMember.groupBy({ by: ['cohortId'], where: { cohortId: { in: activeCohorts.map((c) => c.id) } }, _count: { _all: true } })
  const playersByLevel = new Map<number, number>()
  for (const c of activeCohorts) {
    playersByLevel.set(c.realmLevel, (playersByLevel.get(c.realmLevel) ?? 0) + (memberAgg2.find((m) => m.cohortId === c.id)?._count._all ?? 0))
  }
  for (const row of realmRows) {
    if (row.cycle) row.cycle.players = playersByLevel.get(row.level) ?? 0
  }

  return NextResponse.json({
    realms: realmRows,
    totals: {
      activeCycles: cycles.length,
      cohorts: activeCohorts.length,
      players: Array.from(playersByLevel.values()).reduce((a, b) => a + b, 0),
    },
    memberCountByCohort: Object.fromEntries(memberCountByCohort),
  })
}
