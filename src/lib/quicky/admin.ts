// Quicky — shared ADMIN API guard (lifecycle PRD §30/§35/§36 + game-chat §127)
//
// Every protected backend operation resolves the caller's session, then
// re-reads `isAdmin` FRESH from the database on every request. Non-admins
// get 401/403 — frontend route hiding alone is never the security boundary.
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, type AuthUser } from '@/lib/quicky/auth'

export async function requireAdmin(): Promise<
  { error: NextResponse; me?: undefined } | { error?: undefined; me: AuthUser }
> {
  const me = await getCurrentUser()
  if (!me) return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) }
  const u = await db.user.findUnique({ where: { id: me.id }, select: { isAdmin: true } })
  if (!u?.isAdmin) return { error: NextResponse.json({ error: 'forbidden' }, { status: 403 }) }
  return { me }
}

// ─── Admin audit trail (game-chat PRD §120) ────────────────────────────────
// Record who changed what important configuration (gift price changes,
// activation toggles, sticker bundles, rules). Fire-and-forget safe: audit
// failures must never break the admin operation itself.
export async function logAdminAction(
  adminId: string,
  action: string,
  entityType: string,
  entityId: string,
  meta?: unknown
) {
  await db.adminAuditLog
    .create({
      data: {
        adminId,
        action,
        entityType,
        entityId,
        meta: meta === undefined ? null : JSON.stringify(meta).slice(0, 2000),
      },
    })
    .catch(() => {})
}

/** Deployment environment for admin allow-list checks (admin-console PRD §3.2). */
export function currentEnvironment(): string {
  return process.env.VERCEL_ENV || process.env.NODE_ENV || 'development'
}
