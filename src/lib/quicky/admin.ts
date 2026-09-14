// Quicky — shared ADMIN API guard (lifecycle PRD §30/§35/§36)
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
