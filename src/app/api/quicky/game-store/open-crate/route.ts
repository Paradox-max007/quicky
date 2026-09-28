// Quicky — CRATE OPEN (Game Economy PRD §45/§46/§56)
// POST /api/quicky/game-store/open-crate  { cratePurchaseId }
// Idempotent (OWNED → OPENED conditional update keys the grant). Realm
// points flow through the UNIFIED RealmPointService — never a separate
// crate point pipeline (§56/§57).
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { openCrate } from '@/lib/quicky/game-store'

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const cratePurchaseId = String(body?.cratePurchaseId ?? '')
  if (!cratePurchaseId) return NextResponse.json({ error: 'not_found' }, { status: 400 })

  const result = await openCrate(me.id, cratePurchaseId)
  if (!result.ok) {
    const status = result.error === 'already_opened' ? 409 : 404
    return NextResponse.json({ error: result.error }, { status })
  }
  return NextResponse.json(result)
}
