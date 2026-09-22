// Quicky — CLAIM REWARDS (admin-console PRD §12.1 steps 7-9 + §12.3)
// POST /api/quicky/rewards/claim
//
// Collects ALL pending grants in ONE idempotent transaction (repeated taps /
// retries / concurrent devices can never double-credit coins or duplicate
// inventory). Only the server transitions PENDING → CLAIMED.
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { claimPendingRewards } from '@/lib/quicky/rewards/catalog'
import { getMyCosmetics } from '@/lib/quicky/rewards/cosmetics'

export const dynamic = 'force-dynamic'

export async function POST() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const result = await claimPendingRewards(me.id).catch(() => null)
  if (!result) return NextResponse.json({ error: 'claim_failed' }, { status: 500 })
  const cosmetics = await getMyCosmetics(me.id).catch(() => [])
  return NextResponse.json({ ok: true, ...result, cosmetics })
}
