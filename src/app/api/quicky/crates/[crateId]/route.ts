// Quicky — CRATE DETAIL (crate-pass PRD)
// GET /api/quicky/crates/[crateId]
//
// One crate's full track: the 100 levels (prize + price + reached state),
// my progress (unlocked / currentLevel / cratePoints) and the computed packs
// (bundles of next-N levels priced as the sum of their level prices).
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { getCrateDetail } from '@/lib/quicky/crates'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ crateId: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { crateId } = await params
  try {
    const detail = await getCrateDetail(me.id, crateId)
    if (!detail) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    return NextResponse.json(detail)
  } catch {
    return NextResponse.json({ error: 'crate_unavailable' }, { status: 500 })
  }
}
