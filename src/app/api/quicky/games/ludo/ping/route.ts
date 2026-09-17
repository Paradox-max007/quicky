// Quicky — LUDO presence ping (lifecycle §12/§13 — same contract as the
// Spin Bottle ping; the shared runtime pings while the Ludo room is open).
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
