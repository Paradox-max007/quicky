// Quicky — OPEN AS TEST USER (admin-console PRD §3.2)
// GET /api/quicky/admin/test-account/open
//
// Server-authorized test-session swap: requires an ADMIN session, an enabled
// test-account config, and an allowed environment. Creates a session FOR the
// test user server-side (no credentials ever reach the frontend) and
// redirects to the user app. The admin's own browser session is replaced —
// the button in the console labels this behavior explicitly.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, logAdminAction, currentEnvironment } from '@/lib/quicky/admin'
import { createSession, setSessionCookie } from '@/lib/quicky/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const config = await db.adminTestAccount.findFirst()
  const env = currentEnvironment()
  const allowed = (config?.allowedEnvironments ?? '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)

  const redirect = (to: string) => NextResponse.redirect(new URL(to, req.url))

  if (!config || !config.enabled) return redirect('/?testAccount=unavailable')
  if (!allowed.includes(env)) return redirect('/?testAccount=environment')
  const user = await db.user.findUnique({ where: { id: config.userId }, select: { id: true, onboardedAt: true } })
  if (!user) return redirect('/?testAccount=unavailable')

  // The test session replaces this browser's admin session (server-side).
  const token = await createSession(user.id)
  await setSessionCookie(token)
  await logAdminAction(gate.me.id, 'open_test_session', 'test_account', config.userId, { environment: env })
  return redirect(user.onboardedAt ? '/?testAccount=1' : '/onboarding?testAccount=1')
}
