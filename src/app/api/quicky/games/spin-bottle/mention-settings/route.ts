// Quicky — ROOM CHAT MENTION SETTINGS (room-chat-settings revision)
// POST /api/quicky/games/spin-bottle/mention-settings  { roomId, enabled }
//
// Flips the CALLER'S own membership row's mentionsEnabled for ONE room
// (shared by both room games — Spin Bottle and Ludo ride the same
// SpinRoomPlayer table). Server-side effects:
//   · enabled=false → the room-chat POST drops mention rows targeting the
//     caller (toolbox Mention action + @ picker entry are hidden on every
//     client via the snapshot mirror below).
//   · enabled=true  → mentions work again.
// After the write the room's SSE streams are woken (emitRoomUpdate) so
// EVERY member's snapshot re-renders with the fresh per-player flag — the
// toolbox/picker react within the usual push latency, no refresh needed.
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { emitRoomUpdate } from '@/lib/quicky/spin-events'

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const roomId = String(body?.roomId ?? '')
  const enabled = !!body?.enabled
  if (!roomId) return NextResponse.json({ error: 'missing_fields' }, { status: 400 })

  // Only MY OWN row — a player toggles their own mention privacy, never
  // anyone else's. The membership must be live (leftAt null + active).
  const member = await db.spinRoomPlayer.findFirst({
    where: { roomId, userId: me.id, leftAt: null, isActive: true },
    select: { id: true },
  })
  if (!member) return NextResponse.json({ error: 'not_in_room' }, { status: 403 })

  await db.spinRoomPlayer.update({
    where: { id: member.id },
    data: { mentionsEnabled: enabled },
  })

  // Wake every member's stream → fresh snapshot → toolboxes + pickers
  // re-render with the new flag.
  emitRoomUpdate(roomId)

  return NextResponse.json({ ok: true, roomId, mentionsEnabled: enabled })
}
