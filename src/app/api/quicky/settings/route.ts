// Quicky — User Settings
// GET   /api/quicky/settings              -> fetch current user's settings (auto-creates if missing)
// PATCH /api/quicky/settings              -> partial update of any settings fields
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

// Default settings used when a row doesn't exist yet
const DEFAULT_SETTINGS = {
  notifMessages: true,
  notifConnectionReqs: true,
  notifLikes: true,
  notifProfileViews: true,
  notifSnackbars: true,
  privacyHideAge: false,
  privacyHideDistance: false,
  privacyHideOnline: false,
  privacyHideTyping: false,
  theme: 'dark' as const,
}

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let settings = await db.userSettings.findUnique({ where: { userId: me.id } })
  if (!settings) {
    settings = await db.userSettings.create({
      data: { userId: me.id, ...DEFAULT_SETTINGS },
    })
  }

  return NextResponse.json({ settings })
}

export async function PATCH(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  // Premium gates: online status + typing indicator hide are premium-only
  if (!me.isPremium) {
    if (body.privacyHideOnline === true || body.privacyHideTyping === true) {
      return NextResponse.json(
        { error: 'premium_required', paywall: 'privacy_premium' },
        { status: 402 }
      )
    }
  }

  // Whitelist allowed fields
  const allowed: Record<string, any> = {}
  const boolFields = [
    'notifMessages', 'notifConnectionReqs', 'notifLikes', 'notifProfileViews', 'notifSnackbars',
    'privacyHideAge', 'privacyHideDistance', 'privacyHideOnline', 'privacyHideTyping',
  ]
  for (const f of boolFields) {
    if (body[f] !== undefined) allowed[f] = Boolean(body[f])
  }
  if (body.theme !== undefined) {
    const theme = String(body.theme)
    if (['dark', 'light', 'midnight', 'coral', 'lavender', 'gold'].includes(theme)) {
      allowed.theme = theme
    }
  }

  // Upsert — create the row if missing, then update
  const updated = await db.userSettings.upsert({
    where: { userId: me.id },
    update: allowed,
    create: { userId: me.id, ...DEFAULT_SETTINGS, ...allowed },
  })

  return NextResponse.json({ ok: true, settings: updated })
}
