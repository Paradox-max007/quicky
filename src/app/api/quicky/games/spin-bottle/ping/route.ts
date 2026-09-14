// Quicky — Presence activity ping (lifecycle PRD §12/§13/§14)
// POST /api/quicky/games/spin-bottle/ping { roomId }
//
// The room screen pings periodically while it is genuinely open. The write
// is throttled server-side (room-activity.ts) so a chatty client can never
// flood the DB. This is the ONLY keep-alive: if the app dies, the pings
// stop, and the cleanup worker auto-leaves the member after 10 minutes —
// exactly the "server is authoritative for inactivity" rule (§14).
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { touchMemberActivity } from '@/lib/quicky/room-activity'

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const roomId = String(body?.roomId ?? '')
  if (!roomId) return NextResponse.json({ error: 'roomId required' }, { status: 400 })

  const touched = await touchMemberActivity(roomId, me.id)
  return NextResponse.json({ ok: true, touched })
}
