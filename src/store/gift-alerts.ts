// Quicky — GIFT ALERT STORE (gifting-revision: gift-received notifications)
//
// ONE module-level inbox for "you received a gift" events, fed by the room
// realtime channel's onGift handler (both room games) and mirrored by the
// snapshot path (resilience when realtime is down). Two presentation
// surfaces read it and each decides INDEPENDENTLY whether it is the right
// notifier for the user's current surface:
//
//   · GameGiftAlert (global top drawer, AppRoot) — the user is NOT on the
//     game screen (mobile/Capacitor/mobile web) or NOT in a room at all
//     (desktop shell).
//   · RoomChatPanel's panel-top drawer — the user IS in a room but the chat
//     shell is showing contacts/personal (NOT the Room Chat list). When the
//     Room Chat list is open, the special gift card in the timeline is the
//     notification itself (no drawer, per "do not overly disturb").
//
// Dedupe by event id (roomMessageId/giftMessageId) — a realtime + snapshot
// double-delivery alerts exactly once. Consecutive gifts from the same
// sender + same item COALESCE (quantity merges) so a gifting spree cannot
// queue drawer after drawer. Events expire after ~12s (the drawers are
// transient notifications, never a backlog).

import { create } from 'zustand'

export type GiftReceivedEvent = {
  /** Dedupe key — the gift chat message id (realtime + snapshot paths agree). */
  id: string
  roomId: string
  senderId: string
  senderName: string
  senderAvatar?: string | null
  itemId?: string
  itemName?: string
  itemIcon: string
  itemIconType?: string | null
  quantity: number
  receivedAt: number
}

type GiftAlertState = {
  events: GiftReceivedEvent[]
  /** Deduped registration; coalesces same sender+item within 12s. */
  register: (e: GiftReceivedEvent) => void
  dismiss: (id: string) => void
}

const g = globalThis as unknown as { __quickyGiftAlertIds?: Set<string> }
const seenIds: Set<string> = (g.__quickyGiftAlertIds ??= new Set())

const EVENT_TTL_MS = 12_000
const COALESCE_MS = 12_000

export const useGiftAlertStore = create<GiftAlertState>((set, get) => ({
  events: [],

  register: (e) => {
    if (!e?.id || seenIds.has(e.id)) return
    seenIds.add(e.id)
    if (seenIds.size > 400) {
      let n = 200
      for (const id of seenIds) {
        if (n-- <= 0) break
        seenIds.delete(id)
      }
    }
    const now = Date.now()
    // Coalesce: a gift from the same sender + same item inside the window
    // bumps the quantity instead of queueing another drawer.
    const existing = get().events.find(
      (x) =>
        x.senderId === e.senderId &&
        x.itemId === e.itemId &&
        now - x.receivedAt < COALESCE_MS
    )
    if (existing) {
      set((prev) => ({
        events: prev.events.map((x) =>
          x.id === existing.id ? { ...x, quantity: x.quantity + e.quantity, receivedAt: now, id: e.id } : x
        ),
      }))
      return
    }
    set((prev) => ({ events: [...prev.events.slice(-2), e] }))
    setTimeout(() => {
      set((prev) => ({ events: prev.events.filter((x) => x.id !== e.id) }))
    }, EVENT_TTL_MS)
  },

  dismiss: (id) => set((prev) => ({ events: prev.events.filter((x) => x.id !== id) })),
}))

/** Snapshot-path registration helper (id-keyed dedupe identical to realtime). */
export function registerGiftEvent(e: GiftReceivedEvent) {
  useGiftAlertStore.getState().register(e)
}
