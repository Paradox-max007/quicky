// Quicky — MY PENDING REWARDS (admin-console PRD §12.1/§12.2)
// GET /api/quicky/rewards/pending
//
// The popup's data source. Online users get an instant `rewards_pending`
// push (realm channel); offline users fetch this on their next session —
// the grant rows persist either way, so nobody loses a reward.
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { getPendingGrants } from '@/lib/quicky/rewards/catalog'
import { getMyCosmetics } from '@/lib/quicky/rewards/cosmetics'

export const dynamic = 'force-dynamic'

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const [grants, cosmetics] = await Promise.all([
    getPendingGrants(me.id).catch(() => []),
    getMyCosmetics(me.id).catch(() => []),
  ])
  return NextResponse.json({ grants, cosmetics })
}
