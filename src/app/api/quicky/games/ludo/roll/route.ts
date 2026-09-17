// Quicky — LUDO ROLL API (Ludo PRD §14/§48/§105/§106)
// POST /api/quicky/games/ludo/roll { actionId }
//
// The client sends ONLY an actionId (§106 — the server generates the dice;
// a client-sent dice value is structurally impossible to smuggle in).
// Server validates: authenticated user → room membership → game type →
// game status → current turn → no pending dice (§48) → CAS-commits the
// transition (§51) → responds with the dice + legal tokens (§48).
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { performRoll } from '@/lib/quicky/ludo-server'
import { parseRollRequest } from '@/lib/quicky/ludo/validation'
import { touchMemberActivity } from '@/lib/quicky/room-activity'

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const input = parseRollRequest(body)
  if (!input) return NextResponse.json({ error: 'actionId required' }, { status: 400 })

  // Membership + presence (the roll itself is an activity signal).
  const member = await db.spinRoomPlayer.findFirst({
    where: { roomId: body?.roomId ? String(body.roomId) : '', userId: me.id, leftAt: null, isActive: true },
    select: { roomId: true },
  })
  if (!member) return NextResponse.json({ error: 'not_a_member' }, { status: 403 })
  void touchMemberActivity(member.roomId, me.id).catch(() => {})

  const res = await performRoll(member.roomId, me.id, input.actionId)
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: res.status })
  }

  return NextResponse.json({
    ok: true,
    dice: res.dice ?? null,
    legalMoves: (res.legalMoves ?? []).map((m) => m.tokenId),
    stateVersion: res.state.version,
    state: res.state,
  })
}
