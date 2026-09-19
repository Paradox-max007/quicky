// Quicky — LUDO RUNTIME TICK (ROUND-4 multiplayer PRD §30/§47 — "there
// should never be an apparently frozen game")
// POST /api/quicky/games/ludo/tick  { roomId }
//
// A deliberately TINY keepalive endpoint the attached clients hit every few
// seconds. It runs the lazy runtime recovery (ensureLudoRuntime): if the
// in-process watchdog chain ever dies — dev hot reload, process restart,
// lost timer — the NEXT tick heals the room within seconds: a stalled roll
// is thrown server-side, a stalled move is skipped, STARTING flips to
// PLAYING. One cheap room read per beat; the authoritative snapshot itself
// still travels over the SSE stream (this endpoint never returns state).
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { ensureLudoRuntime } from '@/lib/quicky/ludo-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const roomId = String(body?.roomId ?? '')
  if (!roomId) return NextResponse.json({ error: 'roomId required' }, { status: 400 })

  // Heal FIRST — a room the watchdog lost MUST advance even if the caller
  // vanished right after this line.
  await ensureLudoRuntime(roomId).catch(() => {})

  return NextResponse.json({ ok: true })
}
