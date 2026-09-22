// Quicky — ADMIN TEST ACCOUNT (admin-console PRD §3.2)
// GET  /api/quicky/admin/test-account   → config + environment status
// POST /api/quicky/admin/test-account   → { action }:
//        'save'     { userId, displayName, enabled, allowedEnvironments }
//        'reset-progress'  { userId }  → realm level/season → 1, claims cleared
//        'reset-inventory' { userId }  → items/stickers/cosmetics/grants cleared
//
// Security (PRD §3.2): the test-account flow is server-authorized and
// environment-restricted; credentials are NEVER exposed to frontend code.
// The actual session swap lives in /api/quicky/admin/test-account/open.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, logAdminAction, currentEnvironment } from '@/lib/quicky/admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const config = await db.adminTestAccount.findFirst()
  const user = config
    ? await db.user.findUnique({
        where: { id: config.userId },
        select: { id: true, name: true, phone: true, onboardedAt: true, coinBalance: true },
      })
    : null
  const env = currentEnvironment()
  const allowed = config ? parseAllowed(config.allowedEnvironments) : []
  return NextResponse.json({
    testAccount: config
      ? {
          id: config.id,
          userId: config.userId,
          displayName: config.displayName,
          enabled: config.enabled,
          allowedEnvironments: allowed,
          environment: env,
          environmentAllowed: allowed.includes(env),
          user: user ? { id: user.id, name: user.name, phone: user.phone, onboarded: !!user.onboardedAt, coinBalance: user.coinBalance } : null,
        }
      : null,
    environment: env,
  })
}

function parseAllowed(value: string): string[] {
  return value
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const body = await req.json().catch(() => null)
  const action = String(body?.action ?? '')

  if (action === 'save') {
    const userId = String(body?.userId ?? '').trim()
    if (!userId) return NextResponse.json({ error: 'user_id_required' }, { status: 400 })
    const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, isAdmin: true } })
    if (!user) return NextResponse.json({ error: 'user_not_found' }, { status: 404 })
    if (user.isAdmin) return NextResponse.json({ error: 'cannot_use_admin_account' }, { status: 400 })
    const displayName = String(body?.displayName ?? 'Quicky Tester').trim().slice(0, 40) || 'Quicky Tester'
    const enabled = body?.enabled === true
    const allowedRaw = String(body?.allowedEnvironments ?? 'development').toLowerCase()
    const allowed = parseAllowed(allowedRaw).filter((v) => ['development', 'preview', 'staging', 'production'].includes(v))
    const allowedEnvironments = allowed.length ? allowed.join(',') : 'development'

    const saved = await db.adminTestAccount.upsert({
      where: { userId },
      create: { userId, displayName, enabled, allowedEnvironments },
      update: { displayName, enabled, allowedEnvironments },
    })
    await logAdminAction(gate.me.id, 'update', 'test_account', saved.id, { userId, enabled, allowedEnvironments })
    return NextResponse.json({ ok: true })
  }

  if (action === 'reset-progress' || action === 'reset-inventory') {
    const userId = String(body?.userId ?? '').trim()
    if (!userId) return NextResponse.json({ error: 'user_id_required' }, { status: 400 })
    if (action === 'reset-progress') {
      await db.$transaction(async (tx) => {
        await tx.userRealm.deleteMany({ where: { userId } })
        await tx.realmRewardClaim.deleteMany({ where: { userId } })
        await tx.userRewardGrant.deleteMany({ where: { userId, status: 'PENDING' } })
      })
    } else {
      await db.$transaction(async (tx) => {
        await tx.userItem.deleteMany({ where: { userId } })
        await tx.userGameStickerBundle.deleteMany({ where: { userId } })
        await tx.userCosmetic.deleteMany({ where: { userId } })
        await tx.userRewardGrant.deleteMany({ where: { userId } })
      })
    }
    await logAdminAction(gate.me.id, action, 'test_account', userId, {})
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
}
