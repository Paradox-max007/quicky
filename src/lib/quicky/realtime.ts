// Quicky — Supabase Realtime wrapper
// Uses broadcast channels (typing, read receipts, new-message push) and a
// presence channel (online status). Requires NEXT_PUBLIC_SUPABASE_URL and
// NEXT_PUBLIC_SUPABASE_ANON_KEY; when they're missing every helper no-ops
// and the UI falls back to periodic polling.
//
// supabase-js returns the SAME channel instance when `channel(topic)` is
// called twice, and attaching callbacks to an already-subscribed channel
// throws. So the presence channel is a refcounted singleton here, and match
// channels are deduplicated per topic with a shared handler registry.

import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js'

let client: SupabaseClient | null | undefined

function getClient(): SupabaseClient | null {
  if (client !== undefined) return client
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  client = url && key ? createClient(url, key, { realtime: { params: { eventsPerSecond: 20 } } }) : null
  return client
}

export function realtimeConfigured(): boolean {
  return !!getClient()
}

// ─── Per-match channel: messages, typing, read receipts ────────────────────

export type MatchChannel = {
  channel: RealtimeChannel
  sendTyping: (isTyping: boolean) => void
  sendMessage: (message: unknown) => void
  sendRead: (messageIds: string[]) => void
  sendReaction: (payload: { messageId: string; userId: string; emoji: string | null }) => void
  unsubscribe: () => Promise<void>
}

type MatchHandlers = {
  onMessage?: (message: any) => void
  onTyping?: (isTyping: boolean) => void
  onRead?: (messageIds: string[]) => void
  onReaction?: (payload: { messageId: string; userId: string; emoji: string | null }) => void
}

const matchChannels = new Map<string, RealtimeChannel>()
const matchHandlerRegistry = new Map<string, Set<MatchHandlers>>()
const matchRefs = new Map<string, number>()

export function joinMatchChannel(
  matchId: string,
  handlers: MatchHandlers
): MatchChannel | null {
  const supabase = getClient()
  if (!supabase) return null

  const topic = `match:${matchId}`
  matchRefs.set(topic, (matchRefs.get(topic) ?? 0) + 1)
  if (!matchHandlerRegistry.has(topic)) matchHandlerRegistry.set(topic, new Set())
  matchHandlerRegistry.get(topic)!.add(handlers)

  let channel = matchChannels.get(topic)
  if (!channel) {
    channel = supabase.channel(topic)
    matchChannels.set(topic, channel)

    channel
      .on('broadcast', { event: 'message' }, ({ payload }) =>
        matchHandlerRegistry.get(topic)?.forEach((h) => h.onMessage?.(payload))
      )
      .on('broadcast', { event: 'typing' }, ({ payload }) =>
        matchHandlerRegistry.get(topic)?.forEach((h) => h.onTyping?.(!!(payload as any)?.isTyping))
      )
      .on('broadcast', { event: 'read' }, ({ payload }) =>
        matchHandlerRegistry.get(topic)?.forEach((h) => h.onRead?.((payload as any)?.messageIds ?? []))
      )
      .on('broadcast', { event: 'reaction' }, ({ payload }) =>
        matchHandlerRegistry.get(topic)?.forEach((h) =>
          h.onReaction?.({
            messageId: (payload as any)?.messageId,
            userId: (payload as any)?.userId,
            emoji: (payload as any)?.emoji ?? null,
          })
        )
      )
      .subscribe()
  }

  return {
    channel,
    sendTyping: (isTyping) => {
      channel!.send({ type: 'broadcast', event: 'typing', payload: { isTyping } })
    },
    sendMessage: (message) => {
      channel!.send({ type: 'broadcast', event: 'message', payload: message })
    },
    sendRead: (messageIds) => {
      channel!.send({ type: 'broadcast', event: 'read', payload: { messageIds } })
    },
    sendReaction: (payload) => {
      channel!.send({ type: 'broadcast', event: 'reaction', payload })
    },
    unsubscribe: async () => {
      matchHandlerRegistry.get(topic)?.delete(handlers)
      const refs = (matchRefs.get(topic) ?? 1) - 1
      matchRefs.set(topic, refs)
      if (refs <= 0) {
        matchHandlerRegistry.delete(topic)
        matchChannels.delete(topic)
        await supabase.removeChannel(channel!)
      }
    },
  }
}

// ─── Presence: online status ───────────────────────────────────────────────
// One shared channel for the whole app: `trackOnline` (announce me) and
// `watchOnline` (observe everyone) may be mounted any number of times and in
// any order — callbacks are always attached before the single subscribe().

const PRESENCE_CHANNEL = 'quicky:online'

type PresenceListener = (onlineUserIds: Set<string>) => void

const presenceListeners = new Set<PresenceListener>()
// userId → how many mounted components track this user
const trackedRefs = new Map<string, number>()
let presenceChannel: RealtimeChannel | null = null

function collectOnlineIds(channel: RealtimeChannel): Set<string> {
  const ids = new Set<string>()
  for (const presences of Object.values(channel.presenceState())) {
    for (const p of presences as any[]) {
      if (p?.userId) ids.add(p.userId)
    }
  }
  return ids
}

function ensurePresenceChannel(): RealtimeChannel | null {
  const supabase = getClient()
  if (!supabase) return null
  if (presenceChannel) return presenceChannel

  const channel = supabase.channel(PRESENCE_CHANNEL)
  channel.on('presence', { event: 'sync' }, () => {
    const ids = collectOnlineIds(channel)
    presenceListeners.forEach((fn) => fn(ids))
  })
  channel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      // (Re-)announce everyone whose ref is still outstanding
      for (const userId of trackedRefs.keys()) {
        try {
          await channel.track({ userId, onlineAt: new Date().toISOString() })
        } catch {}
      }
      const ids = collectOnlineIds(channel)
      presenceListeners.forEach((fn) => fn(ids))
    }
  })
  presenceChannel = channel
  return channel
}

function releasePresenceChannelIfIdle() {
  if (trackedRefs.size > 0 || presenceListeners.size > 0) return
  if (!presenceChannel) return
  const supabase = getClient()
  const channel = presenceChannel
  presenceChannel = null
  if (supabase) void supabase.removeChannel(channel)
}

// Announce this user as online. Multiple callers (or remounts) share the
// underlying channel; the user is untracked when the last ref unmounts.
export function trackOnline(userId: string): () => void {
  const channel = ensurePresenceChannel()
  if (!channel) return () => {}
  trackedRefs.set(userId, (trackedRefs.get(userId) ?? 0) + 1)
  if (channel.state === 'joined') {
    void channel.track({ userId, onlineAt: new Date().toISOString() })
  }
  return () => {
    const n = (trackedRefs.get(userId) ?? 1) - 1
    if (n <= 0) trackedRefs.delete(userId)
    else trackedRefs.set(userId, n)
    if (trackedRefs.size === 0 && presenceChannel?.state === 'joined') {
      void presenceChannel.untrack()
    }
    releasePresenceChannelIfIdle()
  }
}

// Observe who is online. The listener fires on every presence sync and once
// immediately if the channel is already joined.
export function watchOnline(
  onPresence: PresenceListener
): () => void {
  const channel = ensurePresenceChannel()
  if (!channel) return () => {}
  presenceListeners.add(onPresence)
  if (channel.state === 'joined') {
    onPresence(collectOnlineIds(channel))
  }
  return () => {
    presenceListeners.delete(onPresence)
    releasePresenceChannelIfIdle()
  }
}
