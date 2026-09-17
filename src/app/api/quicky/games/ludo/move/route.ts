// Quicky — LUDO MOVE API (Ludo PRD §49/§50/§105)
// POST /api/quicky/games/ludo/move { tokenId, actionId }
//
// Server verifies (§49): user owns the token → correct turn → dice exists →
// token is legally movable → exact distance valid (all re-checked through
// the SHARED pure engine — §85). Then: move token → capture if necessary →
// calculate extra turn → calculate winner → increment state version (§51).
// Repeat actionIds replay the stored result (§50 idempotency).
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { performMove } from '@/lib/quicky/ludo-server'
import { parseMoveRequest } from '@/lib/quicky/ludo/validation'
import { touchMemberActivity } from '@/lib/quicky/room-activity'

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const input = parseMoveRequest(body)
  if (!input) return NextResponse.json({ error: 'tokenId + actionId required' }, { status: 400 })

  const member = await db.spinRoomPlayer.findFirst({
    where: { roomId: body?.roomId ? String(body.roomId) : '', userId: me.id, leftAt: null, isActive: true },
    select: { roomId: true },
  })
  if (!member) return NextResponse.json({ error: 'not_a_member' }, { status: 403 })
  void touchMemberActivity(member.roomId, me.id).catch(() => {})

  const res = await performMove(member.roomId, me.id, input.tokenId, input.actionId)
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: res.status })
  }

  return NextResponse.json({
    ok: true,
    stateVersion: res.state.version,
    state: res.state,
  })
}
