// Quicky — In-app game invitations (realtime)
// Flow: starting a game broadcasts an invite on the recipient's personal
// channel (`qk:invites:<userId>`), so the popup reaches them wherever they
// are in the app — not only on the chat screen. Their Join/Cancel reply is
// broadcast back on the inviter's own channel.
//
// Channels are created ad-hoc per outbound message; the inbound channel is a
// single long-lived subscription owned by AppRoot for the signed-in user,
// with all callbacks attached before subscribe() (same rule as presence).

import { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js'
import { getClient } from './realtime'

export type GameInvitePayload = {
  matchId: string
  gameType: 'truth_or_dare' | 'never_have_i_ever' | 'ludo'
  fromId: string
  fromName: string
}

export type InviteResponsePayload = {
  accepted: boolean
  matchId: string
  gameType: string
  fromId: string
  fromName: string
}

const GAME_LABELS: Record<string, string> = {
  truth_or_dare: 'Truth or Dare',
  never_have_i_ever: 'Never Have I Ever',
  ludo: 'Ludo',
}

export function gameLabel(t: string): string {
  return GAME_LABELS[t] ?? t
}

// One-off fire-and-forget broadcast onto another user's invite channel
function postToUser(userId: string, event: string, payload: unknown) {
  const supabase = getClient()
  if (!supabase) return
  const topic = `qk:invites:${userId}`
  const channel = supabase.channel(topic)
  // Sending requires an active subscription — attach a throwaway callback,
  // wait for SUBSCRIBED, deliver, then clean up.
  void channel.subscribe(async (status) => {
    if (status !== 'SUBSCRIBED') return
    try {
      await channel.send({ type: 'broadcast', event, payload })
    } finally {
      await supabase.removeChannel(channel)
    }
  })
}

export function notifyGameInvite(toUserId: string, invite: GameInvitePayload) {
  postToUser(toUserId, 'game_invite', invite)
}

export function respondToGameInvite(toInviterId: string, response: InviteResponsePayload) {
  postToUser(toInviterId, 'game_invite_response', response)
}

// ─── Receiving side ────────────────────────────────────────────────────────

type InviteHandlers = {
  onInvite?: (invite: GameInvitePayload) => void
  onResponse?: (response: InviteResponsePayload) => void
}

let inboundChannel: RealtimeChannel | null = null
const inboundHandlers = new Set<InviteHandlers>()
const inboundRefs = new Map<string, number>()

/** Subscribe this device to my invite stream. Returns an unmount cleanup. */
export function watchGameInvites(
  myUserId: string,
  handlers: InviteHandlers
): () => void {
  const supabase = getClient()
  if (!supabase) return () => {}
  inboundHandlers.add(handlers)
  inboundRefs.set(myUserId, (inboundRefs.get(myUserId) ?? 0) + 1)

  if (!inboundChannel) {
    const channel = supabase.channel(`qk:invites:${myUserId}`)
    channel
      .on('broadcast', { event: 'game_invite' }, ({ payload }) =>
        inboundHandlers.forEach((h) => h.onInvite?.(payload as GameInvitePayload))
      )
      .on('broadcast', { event: 'game_invite_response' }, ({ payload }) =>
        inboundHandlers.forEach((h) => h.onResponse?.(payload as InviteResponsePayload))
      )
      .subscribe()
    inboundChannel = channel
  }

  return () => {
    inboundHandlers.delete(handlers)
    const n = (inboundRefs.get(myUserId) ?? 1) - 1
    if (n <= 0) {
      inboundRefs.delete(myUserId)
      inboundHandlers.clear()
      if (inboundChannel) {
        void supabase.removeChannel(inboundChannel)
        inboundChannel = null
      }
    }
  }
}
