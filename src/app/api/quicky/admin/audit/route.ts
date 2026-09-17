// Quicky — ADMIN AUDIT LOG viewer (Games PRD §67)
// GET /api/quicky/admin/audit?take=100
// Every sensitive admin action (game config, gift price, sticker publish,
// role changes, …) lands in AdminAuditLog via logAdminAction; this endpoint
// exposes the trail to the console. Read-only.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/quicky/admin'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const takeRaw = Number(req.nextUrl.searchParams.get('take') ?? 100)
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.floor(takeRaw), 1), 200) : 100

  const entries = await db.adminAuditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take,
  })
  // AdminAuditLog has no FK by design (audit survives admin deletion) —
  // resolve display names separately.
  const adminNames = entries.length
    ? await db.user.findMany({
        where: { id: { in: [...new Set(entries.map((e) => e.adminId))] } },
        select: { id: true, name: true },
      })
    : []
  const nameById = new Map(adminNames.map((u) => [u.id, u.name]))

  return NextResponse.json({
    entries: entries.map((e) => ({
      id: e.id,
      adminId: e.adminId,
      adminName: nameById.get(e.adminId) ?? null,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      meta: e.meta,
      createdAt: e.createdAt.toISOString(),
    })),
  })
}
