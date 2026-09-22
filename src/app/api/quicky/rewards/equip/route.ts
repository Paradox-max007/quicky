// Quicky — EQUIP COSMETIC (admin-console PRD §8.2/§9)
// POST /api/quicky/rewards/equip { rewardId, level, equip }
//
// One equipped cosmetic per reward TYPE — equipping a hat unequips every
// other hat. Only cosmetics the user OWNS can be equipped (server-checked).
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { equipCosmetic } from '@/lib/quicky/rewards/cosmetics'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const rewardId = String(body?.rewardId ?? '')
  const level = Math.min(3, Math.max(1, Math.floor(Number(body?.level) || 1)))
  const equip = body?.equip !== false
  if (!rewardId) return NextResponse.json({ error: 'rewardId_required' }, { status: 400 })

  try {
    const cosmetics = await equipCosmetic(me.id, rewardId, level, equip)
    return NextResponse.json({ ok: true, cosmetics })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'equip_failed'
    const status = message === 'cosmetic_not_owned' || message === 'not_a_cosmetic' ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
