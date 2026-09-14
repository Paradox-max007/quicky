// Quicky — GAME CHAT SSE STREAM (game-chat PRD §19/§20/§21/§91)
// GET /api/quicky/game-chat/stream
//
// ONE stream per client covers every conversation the user belongs to (§91):
// message pushes, conversation-list reorder nudges, read receipts and
// reaction updates. Heartbeats keep intermediaries from idling the
// connection out; EventSource auto-reconnect handles drops (§21) — the
// client refetches "everything since its last known message" on reopen, so
// a missed event is never lost. No polling anywhere (§19).
import { NextRequest } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { subscribeGameChatUser, type GameChatPushEvent } from '@/lib/quicky/game-chat-events'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return new Response('Unauthorized', { status: 401 })

  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      const send = (event: GameChatPushEvent) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch {
          closed = true
        }
      }

      send({ type: 'hello' })
      const unsubscribe = subscribeGameChatUser(me.id, send)

      const heartbeat = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`: hb ${Date.now()}\n\n`))
        } catch {
          closed = true
        }
      }, 25_000)

      const cleanup = () => {
        if (closed) return
        closed = true
        unsubscribe()
        clearInterval(heartbeat)
        try {
          controller.close()
        } catch {}
      }
      _req.signal?.addEventListener?.('abort', cleanup)
    },
    cancel() {
      // handled via the abort listener above; close() guards the rest
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
