// Quicky — CRATE PRIZE CLAIM (crate-tracks PRD)
// POST /api/quicky/crates/claim  { crateId, level, track }
//
// The user taps an UNLOCKED prize tile → the claim modal → this endpoint.
// Validations: the level must be REACHED (level 1 always is — the pass starts
// unlocked at login), the CRATE track needs the pack bought, and the prize
// must be unclaimed. Grants the prize exactly once (CrateLevelGrant unique
// key) and returns the prize payload for the modal's success state.
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { claimCratePrize } from '@/lib/quicky/crates'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const crateId = String(body?.crateId ?? '')
  const level = Number(body?.level)
  const track = body?.track === 'CRATE' ? 'CRATE' : body?.track === 'FREE' ? 'FREE' : null
  if (!crateId || !Number.isInteger(level) || !track) {
    return NextResponse.json({ error: 'invalid_level' }, { status: 400 })
  }

  const result = await claimCratePrize(me.id, crateId, level, track)
  if (!result.ok) {
    const status =
      result.error === 'invalid_level'
        ? 400
        : result.error === 'not_found'
          ? 404
          : result.error === 'level_locked'
            ? 412
            : result.error === 'crate_locked'
              ? 403
              : 409 // already_claimed | no_prize
    return NextResponse.json({ error: result.error }, { status })
  }
  return NextResponse.json(result)
}
