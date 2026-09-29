// Quicky — WALLET (Monetization PRD §7)
// GET /api/quicky/wallet → the authenticated user's balances.
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { getWallet } from '@/lib/quicky/wallet'

export const dynamic = 'force-dynamic'

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const wallet = await getWallet(me.id)
  return NextResponse.json({ wallet })
}
