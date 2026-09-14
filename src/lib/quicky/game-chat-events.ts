// Quicky — GAME CHAT EVENT BUS (game-chat PRD §19/§32/§90/§91)
//
// The push layer for private player-to-player Game Chat. Mirrors the room
// bus (spin-events.ts): an in-process pub/sub keyed by USER, consumed by the
// SSE stream route (/api/quicky/game-chat/stream). One lightweight stream
// per client serves ALL of that user's conversations (§91 — never a
// subscription per historical conversation).
//
// Delivery model (the repo's equivalent of Supabase Realtime for this
// feature): a write lands in Postgres → emitGameChatUser() pokes BOTH
// members' streams → clients apply the payload instantly. No polling
// anywhere (§19/§121); EventSource auto-reconnect + a fetch of everything
// since the last known message covers reconnects (§21).

export type GameChatPushEvent =
  | { type: 'message'; conversationId: string; message: unknown }
  | { type: 'conversation'; conversationId: string } // list-level nudge (order/unread)
  | { type: 'read'; conversationId: string; userId: string; lastReadAt: string }
  | { type: 'reaction'; conversationId: string; messageId: string }
  | { type: 'hello' }

type ChatListener = (event: GameChatPushEvent) => void

const g = globalThis as unknown as {
  __quickyGameChatBus?: Map<string, Set<ChatListener>>
}

const bus: Map<string, Set<ChatListener>> = (g.__quickyGameChatBus ??= new Map())

/** Push an event to ONE user's open streams. */
export function emitGameChatUser(userId: string, event: GameChatPushEvent) {
  const set = bus.get(userId)
  if (!set) return
  for (const fn of set) {
    try {
      fn(event)
    } catch {
      // a dead SSE subscriber must never break the write path
    }
  }
}

/** Push to BOTH members of a conversation (canonical or not). */
export function emitGameChatPair(userAId: string, userBId: string, event: GameChatPushEvent) {
  emitGameChatUser(userAId, event)
  if (userBId !== userAId) emitGameChatUser(userBId, event)
}

/** Subscribe to a user's game-chat stream. Returns an unsubscribe fn. */
export function subscribeGameChatUser(userId: string, fn: ChatListener): () => void {
  let set = bus.get(userId)
  if (!set) {
    set = new Set()
    bus.set(userId, set)
  }
  set.add(fn)
  return () => {
    set!.delete(fn)
    if (set!.size === 0) bus.delete(userId)
  }
}
