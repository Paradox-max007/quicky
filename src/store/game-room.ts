'use client'

// Quicky — SHARED GAME ROOM RUNTIME (game-chat PRD §2/§5/§6/§99)
//
// The single source of truth for an active Spin the Bottle session. It owns
// EVERYTHING that used to live inside SpinBottleRoom.tsx:
//
//   · room snapshot (players, current spin, round state, viewer economy)
//   · the SSE stream (primary sync) + recovery poll (stream-down only)
//   · the presence ping (lifecycle §12/§13 keep-alive)
//   · the room realtime channel (chat push + gift/balance nudges)
//   · server clock skew
//   · the optimistic round response (v2.1 §4-§13 semantics preserved)
//   · room chat state (optimistic send + realtime merge)
//   · room-closure state (lifecycle §27-§29)
//
// CRITICAL ARCHITECTURE (PRD §2): the game runtime is NOT the table screen.
// The runtime keeps running while the user reads Game Chat, opens a player
// profile or browses the chat list — the bottle never pauses (§4), the
// server stays authoritative (§4/§108), and both the table UI and the
// off-screen decision drawer consume THIS store (§110) so a Kiss pressed in
// chat hits the exact same respond API as a Kiss on the table (§38).
//
// Lifecycle: attach(roomId) on join, detach() on leave/room-deleted. Naviga-
// ting between game-section screens never detaches (§99).

import { create } from 'zustand'
import { toast } from 'sonner'
import { api } from '@/lib/quicky/api-client'
import { joinRoomChannel, type RoomChannel } from '@/lib/quicky/realtime'
import { useQuickyStore } from '@/store/quicky'
import { alertMentionOnce } from '@/lib/quicky/mention-alerts'
import { hapticNotification } from '@/lib/capacitor'
import { registerGiftEvent } from '@/store/gift-alerts'
import { launchGiftFly } from '@/components/quicky/gift-fly/GiftFlyLayer'
import type { RoomMessage, GiftChatMeta } from '@/components/quicky/RoomChatPanel'

export type RoomSnapshot = {
  roomId: string
  status: string
  maxPlayers: number
  minPlayers: number
  currentTurnIdx: number
  singletonStartedAt: string | null
  players: {
    userId: string
    seatIndex: number
    turnIndex: number
    connection: string
    isActive: boolean
    displayName: string
    avatar: string | null
    gender: string | null
    kissPoints: number
    /** Room-chat mention privacy: false → nobody in THIS room can mention
     *  this player (toolbox + picker hide them; the server drops the rows). */
    mentionsEnabled: boolean
  }[]
  /** Games PRD §11/§73 — server-mirrored spin gate (rendering only). */
  canSpin: boolean
  maleCount: number
  femaleCount: number
  currentSpin: {
    id: string
    spinnerId: string
    targetId: string | null
    startRotation: number
    endRotation: number
    duration: number
    status: string
    response: string | null
    spinnerResponse: string | null
    targetResponse: string | null
    result: string | null
    responseDeadline: string | null
  } | null
  myTurnIndex: number
  myTurnIs: boolean
  iAmTarget: boolean
  iAmSpinner: boolean
  serverNow: number
  viewer: { coinBalance: number; kissPoints: number; giftsReceived: number }
  recentMessages: {
    id: string
    userId: string
    text: string
    kind: string
    createdAt: string
    mentions?: { userId: string; displayName: string }[]
    metadata?: GiftChatMeta | null
  }[]
}

export type OptimisticResponse = { spinId: string; choice: 'yes' | 'no' } | null

type Economy = { coinBalance: number; kissPoints: number; giftsReceived: number }

type GameRoomState = {
  roomId: string | null
  snapshot: RoomSnapshot | null
  chat: RoomMessage[]
  streamOk: boolean
  closure: { reason: string } | null
  economy: Economy
  /** THIS client's optimistic answer for the current spin (v2.1 §6). */
  optimistic: OptimisticResponse
  /** Mentions §48: id of a message that mentions ME — the bubble flashes. */
  mentionFlashId: string | null

  attach: (roomId: string) => void
  /** End the runtime — leave / room deleted. Never called on navigation. */
  detach: () => void
  respond: (choice: 'yes' | 'no') => void
  sendChat: (
    text: string,
    replyTo?: RoomMessage['replyTo'],
    mentions?: { userId: string; displayName: string }[]
  ) => Promise<void>
  /** Send a sticker into the room chat — server re-validates ownership.
   *  Carries the active reply target: stickers can reply to chat bubbles
   *  and other stickers (the ref is persisted server-side). */
  sendSticker: (
    sticker: { id: string; name: string; assetUrl: string },
    replyTo?: RoomMessage['replyTo']
  ) => Promise<void>
  reconcile: () => Promise<void>
  bumpEconomy: (delta: Partial<Economy>) => void
  setCoinBalance: (n: number) => void
  /** Cosmetic gift push to the rest of the table via the room channel. */
  broadcastGift: (payload: Parameters<RoomChannel['sendGift']>[0]) => void
  /** Clear the closure dialog AND the runtime (BACK TO GAME path). */
  dismissClosure: () => void
  /** Mentions §48: the bubble highlight clears itself after the flash. */
  setMentionFlash: (id: string | null) => void
  getSkew: () => number
}

// ── Module controller — survives React unmounts (that's the whole point) ────
type Runtime = {
  roomId: string | null
  es: EventSource | null
  poll: ReturnType<typeof setInterval> | null
  ping: ReturnType<typeof setInterval> | null
  skew: number
  channel: RoomChannel | null
  closureHandled: boolean
  lastSpinId: string | null
  // optimistic internals (single-flight, v2.1 §13)
  optimisticRef: OptimisticResponse
  inflight: boolean
}

const g = globalThis as unknown as { __quickyGameRoomRuntime?: Runtime }
const ctl: Runtime = (g.__quickyGameRoomRuntime ??= {
  roomId: null,
  es: null,
  poll: null,
  ping: null,
  skew: 0,
  channel: null,
  closureHandled: false,
  lastSpinId: null,
  optimisticRef: null,
  inflight: false,
})

function stopStreams() {
  try {
    ctl.es?.close()
  } catch {}
  ctl.es = null
  if (ctl.poll) clearInterval(ctl.poll)
  ctl.poll = null
  if (ctl.ping) clearInterval(ctl.ping)
  ctl.ping = null
  void ctl.channel?.unsubscribe().catch(() => {})
  ctl.channel = null
}

export const useGameRoomStore = create<GameRoomState>((set, get) => {
  // ── snapshot application (shared by SSE, recovery poll, reconcile) ──────
  const applySnapshot = (s: RoomSnapshot) => {
    if (s.serverNow) ctl.skew = s.serverNow - Date.now()
    if (s.viewer) set({ economy: { coinBalance: s.viewer.coinBalance, kissPoints: s.viewer.kissPoints, giftsReceived: s.viewer.giftsReceived } })
    // New-spin detection: reset the optimistic answer (§88) exactly once.
    const spinId = s.currentSpin?.id ?? null
    if (spinId && spinId !== ctl.lastSpinId) {
      ctl.lastSpinId = spinId
      ctl.optimisticRef = null
      set({ optimistic: null })
    }
    if (!spinId) {
      // Games PRD §17 — ROUND_CANCELLED / between rounds: no stale
      // spinner/target/optimistic state may survive in any client.
      ctl.lastSpinId = null
      if (ctl.optimisticRef) {
        ctl.optimisticRef = null
        set({ optimistic: null })
      }
    }

    set((prev) => {
      // merge room chat — snapshot messages + optimistic/realtime items
      const prevMap = new Map(prev.chat.map((m) => [m.id, m]))
      const merged = s.recentMessages.map((m) => ({
        ...m,
        mentions: m.mentions ?? [],
        replyTo: prevMap.get(m.id)?.replyTo ?? null,
        metadata: m.metadata ?? null,
      }))
      const pending = prev.chat.filter((m) => m.id.startsWith('tmp_'))
      return { snapshot: s, chat: [...merged, ...pending] }
    })

    // Gifting-revision resilience: when the realtime broadcast was missed
    // (Supabase blip), the snapshot's gift rows still register the
    // recipient notification — deduped by message id, and only FRESH rows
    // (30s window) so historical timeline cards never re-alert on join.
    const meId = useQuickyStore.getState().user?.id ?? ''
    if (meId) {
      const now = Date.now()
      for (const m of s.recentMessages) {
        if (m.kind !== 'gift' || !m.metadata) continue
        const ids = m.metadata.recipientIds?.length
          ? m.metadata.recipientIds
          : m.metadata.recipientId
            ? [m.metadata.recipientId]
            : []
        if (!ids.includes(meId)) continue
        const ts = Date.parse(m.createdAt)
        if (!Number.isFinite(ts) || now - ts > 30_000) continue
        const sender = s.players.find((p) => p.userId === m.userId)
        registerGiftEvent({
          id: m.id,
          roomId: s.roomId,
          senderId: m.userId,
          senderName: sender?.displayName ?? 'Someone',
          senderAvatar: sender?.avatar ?? null,
          itemId: m.metadata.itemId,
          itemName: m.metadata.itemName,
          itemIcon: m.metadata.itemIcon ?? m.metadata.itemEmoji ?? '🎁',
          itemIconType: m.metadata.itemIconType ?? 'emoji',
          quantity: Math.max(1, m.metadata.quantity ?? 1),
          receivedAt: Number.isFinite(ts) ? ts : now,
        })
      }
    }
  }

  const handleRoomGone = async () => {
    if (ctl.closureHandled) return
    ctl.closureHandled = true
    let reason = 'closed'
    try {
      const st = await api.spinBottle.roomStatus(ctl.roomId ?? '')
      if (st?.closed && st.reason) reason = st.reason
    } catch {}
    set({ closure: { reason } })
  }

  return {
    roomId: null,
    snapshot: null,
    chat: [],
    streamOk: false,
    closure: null,
    economy: { coinBalance: 0, kissPoints: 0, giftsReceived: 0 },
    optimistic: null,
    mentionFlashId: null,

    attach: (roomId) => {
      // Idempotent: remounts / re-navigation never restart the stream.
      if (ctl.roomId === roomId && ctl.es) {
        set({ roomId })
        return
      }
      stopStreams()
      ctl.roomId = roomId
      ctl.closureHandled = false
      ctl.lastSpinId = null
      ctl.optimisticRef = null
      ctl.skew = 0
      set({
        roomId,
        snapshot: null,
        chat: [],
        streamOk: false,
        closure: null,
        optimistic: null,
        economy: { coinBalance: 0, kissPoints: 0, giftsReceived: 0 },
      })

      // PRIMARY sync — SSE push on every server transition (PRD §2/§60)
      try {
        const es = new EventSource(`/api/quicky/games/spin-bottle/stream?roomId=${encodeURIComponent(roomId)}`)
        es.addEventListener('snapshot', (e) => {
          try {
            const snap = JSON.parse((e as MessageEvent).data) as RoomSnapshot
            set({ streamOk: true })
            applySnapshot(snap)
          } catch {}
        })
        // Games PRD §16/§70 — discrete typed events (PLAYER_LEFT,
        // ROUND_CANCELLED, …). The authoritative snapshot follows right
        // behind; these signals only drive immediate UX reactions.
        es.addEventListener('room_event', (e) => {
          try {
            const { event } = JSON.parse((e as MessageEvent).data) as { event: string }
            if (event === 'ROUND_CANCELLED' && ctl.optimisticRef) {
              ctl.optimisticRef = null
              set({ optimistic: null })
            }
            // PLAYER_LEFT: the fresh snapshot removes the card + frees the
            // seat; no local player-list surgery is allowed (§14).
          } catch {}
        })
        es.addEventListener('room_gone', () => void handleRoomGone())
        es.onerror = () => set({ streamOk: false })
        ctl.es = es
      } catch {
        set({ streamOk: false })
      }

      // RECOVERY poll — only effective while the stream is down (§63)
      ctl.poll = setInterval(async () => {
        if (get().streamOk || ctl.closureHandled) return
        try {
          const res = await api.spinBottle.room(roomId)
          if (res?.snapshot) applySnapshot(res.snapshot)
        } catch (e: any) {
          if (e?.body?.closed || e?.status === 404) void handleRoomGone()
        }
      }, 3000)

      // PRESENCE keep-alive (lifecycle §12/§13) — runs while the runtime is
      // attached (table OR game chat OR profile), throttled server-side.
      const beat = () => void api.spinBottle.ping(roomId).catch(() => {})
      beat()
      ctl.ping = setInterval(beat, 60_000)

      // Room realtime channel — instant chat push + economy nudges (v3 §59)
      ctl.channel = joinRoomChannel(roomId, {
        onChat: (payload) => {
          const p = payload as any
          if (!p?.userId || (!p?.id && !p?.messageId)) return
          const kind = p.kind || 'user'
          if (kind !== 'user' && kind !== 'join' && kind !== 'leave' && kind !== 'sticker') return
          const mentions: { userId: string; displayName: string }[] = Array.isArray(p.mentions)
            ? p.mentions
            : []
          const msg: RoomMessage = {
            id: p.id || p.messageId || `rt_${Date.now()}`,
            userId: p.userId,
            text: p.text || '',
            kind,
            createdAt: p.createdAt || new Date().toISOString(),
            replyTo: p.replyTo ?? null,
            mentions,
            metadata:
              kind === 'sticker'
                ? (() => {
                    // the broadcast rides metadata as a JSON string
                    const raw = typeof p.metadata === 'string' ? p.metadata : JSON.stringify(p.metadata ?? null)
                    try {
                      const v = raw ? JSON.parse(raw) : null
                      return {
                        stickerId: typeof v?.stickerId === 'string' ? v.stickerId : undefined,
                        stickerName: typeof v?.stickerName === 'string' ? v.stickerName : undefined,
                        stickerAsset: typeof v?.stickerAsset === 'string' ? v.stickerAsset : undefined,
                      }
                    } catch {
                      return null
                    }
                  })()
                : null,
          }
          set((prev) => {
            const withoutTmp = prev.chat.filter(
              (m) => m.userId !== msg.userId || !m.id.startsWith('tmp_') || m.text !== msg.text
            )
            if (withoutTmp.some((m) => m.id === msg.id)) return prev
            return { chat: [...withoutTmp, msg] }
          })
          // ── Mentions §46/§47/§48: an in-room mention → lightweight visual
          // alert + haptic + a brief bubble highlight. The per-user stream
          // fires the SAME mention with the SAME id — alertMentionOnce makes
          // exactly one of the two paths alert (§55/§113).
          const meId = useQuickyStore.getState().user?.id ?? ''
          const mine = mentions.find((m) => m.userId === meId)
          if (mine) {
            const actorName =
              get().snapshot?.players.find((pl) => pl.userId === msg.userId)?.displayName ?? 'Someone'
            if (alertMentionOnce({ id: msg.id, actorName, textPreview: msg.text.slice(0, 80), inRoom: true })) {
              set({ mentionFlashId: msg.id })
            }
          }
        },
        onGift: (payload) => {
          const p = payload as any
          const meId = useQuickyStore.getState().user?.id ?? ''
          const recipientIds: string[] = Array.isArray(p?.recipientIds)
            ? p.recipientIds
            : p?.recipientId
              ? [p.recipientId]
              : []
          const forMe = !!meId && recipientIds.includes(meId)

          // 1) Synthesize the gift chat card with the REAL message id (the
          //    server's broadcast carries it) — the SSE snapshot merge that
          //    follows replaces it seamlessly, so there is no duplicate flash
          //    and offline clients still get the row through the snapshot.
          if (p?.giftMessageId && p?.senderId) {
            const giftMsg: RoomMessage = {
              id: String(p.giftMessageId),
              userId: String(p.senderId),
              text: p.text ?? '',
              kind: 'gift',
              createdAt: p.createdAt ?? new Date().toISOString(),
              replyTo: null,
              mentions: [],
              metadata: {
                itemId: p.itemId,
                itemName: p.itemName,
                itemEmoji: p.itemEmoji,
                itemIcon: p.itemIcon ?? p.itemEmoji,
                itemIconType: p.itemIconType ?? 'emoji',
                recipientId: p.recipientId ?? null,
                recipientName: p.recipientName ?? null,
                recipientIds,
                recipientNames: Array.isArray(p.recipientNames) ? p.recipientNames : [],
                recipientCount: Number.isFinite(p.recipientCount) ? p.recipientCount : recipientIds.length,
                quantity: Math.max(1, Number(p?.quantity ?? 1)),
                bulk: !!p.bulk,
              },
            }
            set((prev) => {
              if (prev.chat.some((m) => m.id === giftMsg.id)) return prev
              return { chat: [...prev.chat, giftMsg] }
            })
          }

          // 2) Recipient-side experience: economy bump + notification inbox
          //    (drawer surfaces decide per-view) + the fly animation from the
          //    SENDER's seat to MY seat. The SENDER skips the fly here — they
          //    already launched it locally at send time.
          if (forMe && p?.senderId !== meId) {
            get().bumpEconomy({ giftsReceived: Math.max(1, Number(p?.quantity ?? 1)) })
            void hapticNotification('warning')
            const sender = get().snapshot?.players.find((pl) => pl.userId === p?.senderId)
            registerGiftEvent({
              id: String(p?.giftMessageId ?? `gift_${Date.now()}_${Math.random()}`),
              roomId: ctl.roomId ?? '',
              senderId: String(p.senderId ?? ''),
              senderName: p?.senderName ?? sender?.displayName ?? 'Someone',
              senderAvatar: sender?.avatar ?? null,
              itemId: p?.itemId,
              itemName: p?.itemName,
              itemIcon: p?.itemIcon ?? p?.itemEmoji ?? '🎁',
              itemIconType: p?.itemIconType ?? 'emoji',
              quantity: Math.max(1, Number(p?.quantity ?? 1)),
              receivedAt: Date.now(),
            })
            launchGiftFly({
              fromUserId: p?.senderId,
              toUserIds: [meId],
              icon: p?.itemIcon ?? p?.itemEmoji ?? '🎁',
              iconType: p?.itemIconType ?? 'emoji',
              quantity: Math.max(1, Number(p?.quantity ?? 1)),
            })
          }
        },
        onBalance: (payload) => {
          const p = payload as any
          if (p?.userId === (useQuickyStore.getState().user?.id ?? '') && Number.isFinite(p?.coinBalance)) {
            set((prev) => ({ economy: { ...prev.economy, coinBalance: Number(p.coinBalance) } }))
          }
        },
      })
    },

    detach: () => {
      stopStreams()
      ctl.roomId = null
      ctl.closureHandled = false
      ctl.lastSpinId = null
      ctl.optimisticRef = null
      ctl.inflight = false
      ctl.skew = 0
      set({
        roomId: null,
        snapshot: null,
        chat: [],
        streamOk: false,
        closure: null,
        optimistic: null,
        economy: { coinBalance: 0, kissPoints: 0, giftsReceived: 0 },
        mentionFlashId: null,
      })
    },

    dismissClosure: () => {
      get().detach()
    },

    setMentionFlash: (id) => set({ mentionFlashId: id }),

    respond: (choice) => {
      const { snapshot, roomId } = get()
      const spin = snapshot?.currentSpin
      if (!spin || !roomId) return
      if (spin.status !== 'awaiting') return
      // §9: only the spinner or the target may respond
      if (!snapshot.iAmTarget && !snapshot.iAmSpinner) return
      // §13: single-flight — repeated taps ❤️ ❤️ ❤️ send ONE request
      if (ctl.inflight) return
      if (ctl.optimisticRef?.spinId === spin.id) return
      ctl.inflight = true
      ctl.optimisticRef = { spinId: spin.id, choice }
      set({ optimistic: { spinId: spin.id, choice } }) // §6: flips THIS frame
      void (async () => {
        try {
          const res = await api.spinBottle.respond(roomId, choice)
          if (res?.outcome === 'resolved') void get().reconcile()
        } catch (e: any) {
          // §10: server rejected (expired / resolved elsewhere / offline)
          if (ctl.optimisticRef?.spinId === spin.id) {
            ctl.optimisticRef = null
            set({ optimistic: null })
          }
          toast.error(e?.message ?? 'Failed to respond')
          void get().reconcile()
        } finally {
          ctl.inflight = false
        }
      })()
    },

    sendChat: async (text, replyTo, mentions) => {
      const body = text.trim()
      const { roomId, chat } = get()
      if (!body || !roomId) return
      const tmpId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      const meId = useQuickyStore.getState().user?.id ?? ''
      set({
        chat: [...chat, { id: tmpId, userId: meId, text: body, kind: 'user', createdAt: new Date().toISOString(), replyTo: replyTo ?? null, mentions: mentions ?? [] }],
      })
      try {
        // The reply id rides to the server, which re-resolves + persists
        // the reference (author name, snippet, sticker asset) — the ref
        // survives reloads and renders identically for every client.
        const res = await api.spinBottle.sendChat(roomId, body, mentions, undefined, replyTo?.id)
        if (res?.message) {
          const confirmed: RoomMessage = {
            ...res.message,
            mentions: res.message.mentions ?? mentions ?? [],
            replyTo: res.message.replyTo ?? replyTo ?? null,
          }
          ctl.channel?.sendChat({
            id: confirmed.id,
            messageId: confirmed.id,
            userId: confirmed.userId,
            text: confirmed.text,
            kind: confirmed.kind,
            createdAt: confirmed.createdAt,
            replyTo: confirmed.replyTo,
            mentions: confirmed.mentions,
          })
          set((prev) => {
            const without = prev.chat.filter((m) => m.id !== tmpId)
            if (without.some((m) => m.id === confirmed.id)) return prev
            return { chat: [...without, confirmed] }
          })
        }
      } catch (e: any) {
        toast.error(e?.message ?? 'Failed to send')
        set((prev) => ({ chat: prev.chat.filter((m) => m.id !== tmpId) }))
      }
    },

    sendSticker: async (sticker, replyTo) => {
      const { roomId, chat } = get()
      if (!roomId) return
      const tmpId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      const meId = useQuickyStore.getState().user?.id ?? ''
      // Optimistic sticker row — the asset metadata rides along so the
      // timeline renders the big sticker immediately; an active reply
      // target renders its reference line right away (server confirms).
      const optimisticMeta = { stickerId: sticker.id, stickerName: sticker.name, stickerAsset: sticker.assetUrl }
      set({
        chat: [
          ...chat,
          { id: tmpId, userId: meId, text: sticker.name, kind: 'sticker', createdAt: new Date().toISOString(), metadata: optimisticMeta, replyTo: replyTo ?? null },
        ],
      })
      try {
        // text rides as the sticker NAME for previews; the server validates
        // ownership before writing the row and persists the reply ref.
        const res = await api.spinBottle.sendChat(roomId, sticker.name, [], sticker.id, replyTo?.id)
        if (res?.message) {
          const confirmed: RoomMessage = {
            ...res.message,
            metadata: res.message.metadata ?? optimisticMeta,
            mentions: [],
            replyTo: res.message.replyTo ?? replyTo ?? null,
          }
          // Realtime: every other client renders the sticker card instantly.
          ctl.channel?.sendChat({
            id: confirmed.id,
            messageId: confirmed.id,
            userId: confirmed.userId,
            text: confirmed.text,
            kind: 'sticker',
            createdAt: confirmed.createdAt,
            metadata: JSON.stringify(confirmed.metadata ?? optimisticMeta),
            replyTo: confirmed.replyTo,
            mentions: [],
          })
          set((prev) => {
            const without = prev.chat.filter((m) => m.id !== tmpId)
            if (without.some((m) => m.id === confirmed.id)) return prev
            return { chat: [...without, confirmed] }
          })
        }
      } catch (e: any) {
        const err = e?.body?.error
        if (err === 'sticker_not_owned') toast.error('You no longer own this sticker set')
        else if (err === 'sticker_unavailable') toast.error('This sticker is no longer available')
        else toast.error(e?.message ?? 'Failed to send sticker')
        set((prev) => ({ chat: prev.chat.filter((m) => m.id !== tmpId) }))
      }
    },

    reconcile: async () => {
      const roomId = get().roomId ?? ctl.roomId
      if (!roomId) return
      try {
        const res = await api.spinBottle.room(roomId)
        if (res?.snapshot) applySnapshot(res.snapshot)
      } catch (e: any) {
        if (e?.body?.closed || e?.status === 404) void handleRoomGone()
      }
    },

    bumpEconomy: (delta) =>
      set((prev) => ({
        economy: {
          coinBalance: prev.economy.coinBalance + (delta.coinBalance ?? 0),
          kissPoints: prev.economy.kissPoints + (delta.kissPoints ?? 0),
          giftsReceived: prev.economy.giftsReceived + (delta.giftsReceived ?? 0),
        },
      })),

    setCoinBalance: (n) => set((prev) => ({ economy: { ...prev.economy, coinBalance: n } })),

    broadcastGift: (payload) => {
      ctl.channel?.sendGift(payload)
    },

    getSkew: () => ctl.skew,
  }
})
