// Quicky — Spin the Bottle game-state stream (PRD STEP 3, §2/§60/§63)
// GET /api/quicky/games/spin-bottle/stream?roomId=...
//
// Server-Sent Events "controlled broadcast layer": the server state machine
// (spin-bottle.ts) emits room updates on the in-process bus (spin-events.ts);
// every connected room member receives a FRESH SNAPSHOT the instant the DB
// changes — round started, target selected, response submitted, round
// resolved, player joined/left. This replaces the old ~2s polling as the
// PRIMARY sync path. Polling remains client-side only as a RECOVERY
// mechanism (EventSource reconnect / missed events, PRD §63).
//
// Why SSE and not Supabase Postgres Changes: the round state machine is
// authoritative in this Node process; pushing its transitions directly is
// simpler, transactional, and works identically on web + Capacitor.
import { NextRequest } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { buildRoomSnapshot } from '@/lib/quicky/spin-snapshot'
import { subscribeRoom } from '@/lib/quicky/spin-events'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return new Response('Unauthorized', { status: 401 })
  const roomId = req.nextUrl.searchParams.get('roomId') ?? ''
  if (!roomId) return new Response('roomId required', { status: 400 })

  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let sendTimer: ReturnType<typeof setTimeout> | null = null
  let closed = false

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          )
        } catch {
          // controller already closed — client vanished
        }
      }

      const pushSnapshot = async () => {
        if (closed) return
        try {
          const snap = await buildRoomSnapshot(roomId, me.id)
          if (!snap) {
            send('room_gone', { roomId })
            cleanup()
            return
          }
          send('snapshot', snap)
        } catch {
          // transient DB error — keep the stream alive, recovery poll covers it
        }
      }

      const scheduleSnapshot = (event = 'ROOM_UPDATED', payload?: unknown) => {
        // PRD §16/§70 — discrete realtime events (PLAYER_LEFT, ROUND_CANCELLED,
        // …) are forwarded to the client AS THEY HAPPEN; the fresh snapshot
        // (authoritative state) follows right behind.
        if (event !== 'ROOM_UPDATED') send('room_event', { event, payload })
        if (closed || sendTimer) return
        // Coalesce bursts (multiple emits inside one transaction window)
        sendTimer = setTimeout(() => {
          sendTimer = null
          pushSnapshot()
        }, 60)
      }

      const cleanup = () => {
        if (closed) return
        closed = true
        unsubscribe?.()
        if (heartbeat) clearInterval(heartbeat)
        if (sendTimer) clearTimeout(sendTimer)
        try {
          controller.close()
        } catch {}
      }

      // Initial state, then live updates
      await pushSnapshot()
      unsubscribe = subscribeRoom(roomId, scheduleSnapshot)

      // Keep intermediaries from closing the idle connection
      heartbeat = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`))
        } catch {
          cleanup()
        }
      }, 20000)

      req.signal.addEventListener('abort', cleanup)
    },
    cancel() {
      closed = true
      unsubscribe?.()
      if (heartbeat) clearInterval(heartbeat)
      if (sendTimer) clearTimeout(sendTimer)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Never buffer the stream (dev proxy / CDN safety)
      'X-Accel-Buffering': 'no',
    },
  })
}
