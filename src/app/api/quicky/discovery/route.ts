// Quicky — discovery feed
// GET /api/quicky/discovery
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { buildDiscoveryQueue, getRemainingLimits } from '@/lib/quicky/discovery'

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!me.onboardedAt) return NextResponse.json({ error: 'Onboard first' }, { status: 400 })

  const queue = await buildDiscoveryQueue({ userId: me.id, limit: 20 })
  const limits = await getRemainingLimits({ userId: me.id })

  return NextResponse.json({
    queue,
    limits: {
      likes: limits.likes === Infinity ? 'unlimited' : limits.likes,
      superLikes: limits.superLikes,
      quicky: limits.quicky === Infinity ? 'unlimited' : limits.quicky,
      isPremium: limits.isPremium,
    },
  })
}
