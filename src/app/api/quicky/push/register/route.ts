// Quicky — PUSH TOKEN REGISTRATION (FCM)
// POST   /api/quicky/push/register { token, platform } — upsert the device
//        token for the signed-in user (re-registering moves the token to the
//        current user — a token belongs to ONE install).
// DELETE /api/quicky/push/register { token } — retire the token (logout /
//        notification permission revoked on the device).
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

const PLATFORMS = new Set(['web', 'ios', 'android'])

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  if (!token || token.length < 20 || token.length > 512) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 400 })
  }
  const platform = typeof body?.platform === 'string' && PLATFORMS.has(body.platform) ? body.platform : 'web'

  // A token identifies one install: if the same token arrives under another
  // user (device handed over / re-login), re-point it at the current user.
  await db.pushToken.upsert({
    where: { token },
    create: { token, platform, userId: me.id, active: true, lastSeenAt: new Date() },
    update: { userId: me.id, platform, active: true, lastSeenAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  if (!token) return NextResponse.json({ error: 'invalid_token' }, { status: 400 })

  await db.pushToken.updateMany({ where: { token, userId: me.id }, data: { active: false } })
  return NextResponse.json({ ok: true })
}
