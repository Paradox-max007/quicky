// Quicky — ADMIN CONSOLE SETTINGS + INFO (admin-console PRD §3.2/§4.1/§17)
// GET  /api/quicky/admin/console-settings → settings + storage + season/reward
//                                        KPIs (dashboard cards, §4.1) + web app URL
// POST /api/quicky/admin/console-settings → { key, value } (webAppUrl etc.)
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, logAdminAction } from '@/lib/quicky/admin'
import { storageInfo } from '@/lib/quicky/storage'

export const dynamic = 'force-dynamic'

const ALLOWED_KEYS = ['webAppUrl']

export async function GET() {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const [settings, seasons, activeSeason, rewardCount, stickerCount, giftCount, pendingGrants, claimedGrants, uploadErrors] = await Promise.all([
    db.adminSetting.findMany({ where: { key: { in: ALLOWED_KEYS } } }),
    db.realmSeason.count(),
    db.realmSeason.findFirst({ where: { isActive: true }, orderBy: { seasonNumber: 'desc' } }),
    db.reward.count({ where: { status: 'ACTIVE' } }),
    db.gameStickerBundle.count({ where: { isActive: true } }),
    db.gameItem.count({ where: { isActive: true, category: 'gift' } }),
    db.userRewardGrant.count({ where: { status: 'PENDING' } }),
    db.userRewardGrant.count({ where: { status: 'CLAIMED' } }),
    db.adminAuditLog.count({ where: { action: 'upload', createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } } }),
  ])

  const byKey = new Map(settings.map((s) => [s.key, s.value]))
  return NextResponse.json({
    settings: {
      webAppUrl: byKey.get('webAppUrl') ?? '',
    },
    storage: storageInfo(),
    stats: {
      seasons,
      activeSeason: activeSeason ? { seasonNumber: activeSeason.seasonNumber, name: activeSeason.name } : null,
      activeRewards: rewardCount,
      activeStickerSets: stickerCount,
      activeGifts: giftCount,
      pendingGrants,
      claimedGrants,
      recentUploads: uploadErrors,
    },
  })
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const body = await req.json().catch(() => null)
  const key = String(body?.key ?? '')
  if (!ALLOWED_KEYS.includes(key)) return NextResponse.json({ error: 'invalid_key' }, { status: 400 })
  const value = String(body?.value ?? '').trim().slice(0, 300)
  if (key === 'webAppUrl' && value && !/^https?:\/\//i.test(value) && !value.startsWith('/')) {
    return NextResponse.json({ error: 'invalid_url', message: 'Use an absolute http(s) URL or an app-relative path like /.' }, { status: 400 })
  }

  await db.adminSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  })
  await logAdminAction(gate.me.id, 'update', 'admin_setting', key, { value })
  return NextResponse.json({ ok: true })
}
