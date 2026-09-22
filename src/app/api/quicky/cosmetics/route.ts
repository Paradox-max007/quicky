// Quicky — MY COSMETICS WARDROBE (admin-console PRD §8.2/§9)
// GET /api/quicky/cosmetics → owned cosmetics + equip state (wardrobe UI)
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { getMyCosmetics } from '@/lib/quicky/rewards/cosmetics'

export const dynamic = 'force-dynamic'

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const cosmetics = await getMyCosmetics(me.id).catch(() => [])
  return NextResponse.json({ cosmetics })
}
