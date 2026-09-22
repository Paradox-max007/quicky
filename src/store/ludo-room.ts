'use client'

// Quicky — LUDO ROOM RUNTIME (Ludo PRD §52/§62/§63/§99/§114)
//
// The Ludo flavour of the SHARED GAME ROOM RUNTIME (store/game-room.ts).
// Same runtime principles the PRD mandates — the game is NOT the table
// screen: the runtime keeps streaming while the user reads Game Chat,
// opens a profile or backgrounds Capacitor (§62), and resume reconciles
// from the SERVER state (§63), never from local animation state.
//
//   · snapshot (players + authoritative LudoGameState + viewer economy)
//   · SSE stream (primary sync) + recovery poll (stream-down only)
//   · presence ping (lifecycle §12/§13)
//   · the room realtime channel (chat push + gift/balance nudges)
//   · room chat state (optimistic send + realtime merge)
//   · room-closure state
//   · move action — single-flight, actionId-stamped (§49/§50). The DICE
//     have no client action at all: the SERVER rolls automatically
//     (multiplayer PRD §14) and every client animates the broadcast roll.

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
import { moveToken as engineMoveToken } from '@/lib/quicky/ludo/rules'
import type { LudoGameState, LudoLegalMove } from '@/lib/quicky/ludo/types'
import type { LudoRoomSnapshot } from '@/lib/quicky/ludo-snapshot'

export type LudoSnapshot = LudoRoomSnapshot

type Economy = { coinBalance: number; kissPoints: number; giftsReceived: number }

type LudoRoomState = {
  roomId: string | null
  snapshot: LudoSnapshot | null
  chat: RoomMessage[]
  streamOk: boolean
  closure: { reason: string } | null
  economy: Economy
  /** Mentions §48: id of a message that mentions ME — the bubble flashes. */
  mentionFlashId: string | null
  /** Local move single-flight (§88 race-condition tests). */
  movingTokenId: string | null
  /** Last server response for the UI (dice + legal token ids). */
  legalMoves: LudoLegalMove[]

  attach: (roomId: string) => void
  detach: () => void
  move: (tokenId: string) => Promise<boolean>
  sendChat: (
    text: string,
    replyTo?: RoomMessage['replyTo'],
    mentions?: { userId: string; displayName: string }[]
  ) => Promise<void>
  /** Send a sticker into the room chat — server re-validates ownership
   *  (same endpoint as spin-bottle, Ludo PRD §79 shared room-chat storage). */
  sendSticker: (sticker: { id: string; name: string; assetUrl: string }) => Promise<void>
  reconcile: () => Promise<void>
  bumpEconomy: (delta: Partial<Economy>) => void
  setCoinBalance: (n: number) => void
  broadcastGift: (payload: Parameters<RoomChannel['sendGift']>[0]) => void
  setMentionFlash: (id: string | null) => void
  getSkew: () => number
}

// ── Module controller — survives React unmounts (that's the whole point) ────
type Runtime = {
  roomId: string | null
  es: EventSource | null
  poll: ReturnType<typeof setInterval> | null
  /** ROUND-4 keepalive beat — heals a stalled server watchdog even when the
   * SSE stream is perfectly healthy (the old design only polled when it
   * was NOT, so a dead in-process timer chain froze the game forever). */
  tick: ReturnType<typeof setInterval> | null
  ping: ReturnType<typeof setInterval> | null
  skew: number
  channel: RoomChannel | null
  closureHandled: boolean
  /** CLIENT PREDICTION — set when a predicted move was REJECTED by the
   * server: the next incoming snapshot is accepted REGARDLESS of the
   * version-regression guard (the prediction may have inflated the local
   * version above the server truth — the server always wins). */
  forceNextSnapshot: boolean
}

const g = globalThis as unknown as { __quickyLudoRoomRuntime?: Runtime }
const ctl: Runtime = (g.__quickyLudoRoomRuntime ??= {
  roomId: null,
  es: null,
  poll: null,
  tick: null,
  ping: null,
  skew: 0,
  channel: null,
  closureHandled: false,
  forceNextSnapshot: false,
})

function stopStreams() {
  try {
    ctl.es?.close()
  } catch {}
  ctl.es = null
  if (ctl.poll) clearInterval(ctl.poll)
  ctl.poll = null
  if (ctl.tick) clearInterval(ctl.tick)
  ctl.tick = null
  if (ctl.ping) clearInterval(ctl.ping)
  ctl.ping = null
  void ctl.channel?.unsubscribe().catch(() => {})
  ctl.channel = null
}

function newActionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `act_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`
}

export const useLudoRoomStore = create<LudoRoomState>((set, get) => {
  const applySnapshot = (s: LudoSnapshot) => {
    if (s.serverNow) ctl.skew = s.serverNow - Date.now()
    if (s.viewer) {
      set({
        economy: {
          coinBalance: s.viewer.coinBalance,
          kissPoints: s.viewer.kissPoints,
          giftsReceived: s.viewer.giftsReceived,
        },
      })
    }
    set((prev) => {
      // ⛔ VERSION-REGRESSION GUARD — the mobile/Capacitor token-tap fix.
      // An SSE/poll snapshot that was READ before the last local commit (a
      // coalesced push or an in-flight recovery poll landing after a
      // roll/move response) must never drag the board BACKWARDS: a regressed
      // game drops the pending dice, empties the legal-move set and makes
      // every coin unselectable ("I rolled a 6 and tapping does nothing").
      // The engine's monotonic version is the tiebreaker — an older game
      // state is always discarded in favour of the locally known newer one.
      // EXCEPTION (client prediction): when a PREDICTED move was rejected,
      // the server truth may carry a LOWER version than our optimistic
      // state — it must be force-accepted so the board corrects itself.
      const force = ctl.forceNextSnapshot
      ctl.forceNextSnapshot = false
      const prevGame = prev.snapshot?.game ?? null
      const incomingGame = s.game ?? null
      const staleGame =
        !force &&
        !!incomingGame &&
        !!prevGame &&
        (incomingGame.version ?? 0) < (prevGame.version ?? 0)
      const snap: LudoSnapshot = staleGame ? { ...s, game: prevGame } : s
      const prevMap = new Map(prev.chat.map((m) => [m.id, m]))
      const merged = s.recentMessages.map((m) => ({
        ...m,
        mentions: m.mentions ?? [],
        replyTo: prevMap.get(m.id)?.replyTo ?? null,
        metadata: (m as { metadata?: GiftChatMeta | null }).metadata ?? null,
      }))
      const pending = prev.chat.filter((m) => m.id.startsWith('tmp_'))
      return { snapshot: snap, chat: [...merged, ...pending] }
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
    mentionFlashId: null,
    movingTokenId: null,
    legalMoves: [],

    attach: (roomId) => {
      // Idempotent: remounts / re-navigation never restart the stream (§62).
      if (ctl.roomId === roomId && ctl.es) {
        set({ roomId })
        return
      }
      stopStreams()
      ctl.roomId = roomId
      ctl.closureHandled = false
      ctl.skew = 0
      set({
        roomId,
        snapshot: null,
        chat: [],
        streamOk: false,
        closure: null,
        economy: { coinBalance: 0, kissPoints: 0, giftsReceived: 0 },
        mentionFlashId: null,
        movingTokenId: null,
        legalMoves: [],
      })

      // PRIMARY sync — SSE push on every server transition (§52)
      try {
        const es = new EventSource(`/api/quicky/games/ludo/stream?roomId=${encodeURIComponent(roomId)}`)
        es.addEventListener('snapshot', (e) => {
          try {
            const snap = JSON.parse((e as MessageEvent).data) as LudoSnapshot
            set({ streamOk: true })
            applySnapshot(snap)
          } catch {}
        })
        // Typed LUDO_* events — INSTANT REALTIME: every typed transition
        // carries the fresh authoritative game state INSIDE the payload
        // (ludo-server embeds it at emit time). Applying it here means the
        // coin hop / dice roll / turn change renders on every device the
        // MOMENT the event lands — no waiting for the full snapshot build
        // (which still follows for players/economy/chat). Version-guarded so
        // it can never drag the board backwards or fight a local prediction.
        es.addEventListener('room_event', (e) => {
          try {
            const { payload } = JSON.parse((e as MessageEvent).data) as { event: string; payload?: any }
            const incoming = (payload?.game ?? null) as LudoGameState | null
            if (!incoming) return
            set((prev) => {
              const prevGame = prev.snapshot?.game ?? null
              // Lower/equal version: stale or already predicted locally —
              // the following snapshot reconciles anything else.
              if (!prevGame || !prev.snapshot) return prev
              if ((incoming.version ?? 0) <= (prevGame.version ?? 0)) return prev
              return { snapshot: { ...prev.snapshot, game: incoming } }
            })
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
          const res = await api.ludo.room(roomId)
          if (res?.snapshot) applySnapshot(res.snapshot)
        } catch (e: any) {
          if (e?.body?.closed || e?.status === 404) void handleRoomGone()
        }
      }, 3000)

      // ROUND-4 KEEPALIVE TICK (multiplayer PRD §30/§47) — runs while the
      // room is attached, stream up or down. The server's lazy recovery
      // (ensureLudoRuntime) throws a stalled roll, skips a stalled move and
      // flips a stuck STARTING room — so the auto-turn chain can NEVER die
      // quietly (dev hot reload, process restart, lost timer). 3s cadence:
      // a lost in-process watchdog resolves within one tick instead of 7.
      // The response carries no state; the SSE snapshot (or the recovery
      // poll) delivers whatever the heal changed.
      ctl.tick = setInterval(() => {
        if (ctl.closureHandled || !ctl.roomId) return
        void api.ludo.tick(roomId).catch(() => {})
      }, 3_000)

      // PRESENCE keep-alive (lifecycle §12/§13)
      const beat = () => void api.ludo.ping(roomId).catch(() => {})
      beat()
      ctl.ping = setInterval(beat, 60_000)

      // Room realtime channel — instant chat push + economy nudges (§52)
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

          // 1) Synthesize the gift chat card with the REAL message id — the
          //    SSE snapshot merge that follows replaces it seamlessly (no
          //    duplicate flash; offline clients get the row via snapshot).
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

          // 2) Recipient-side: economy bump + notification inbox + fly
          //    animation from the SENDER's yard avatar to MY seat. The
          //    sender skips the fly (they launched it at send time).
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
      ctl.skew = 0
      set({
        roomId: null,
        snapshot: null,
        chat: [],
        streamOk: false,
        closure: null,
        economy: { coinBalance: 0, kissPoints: 0, giftsReceived: 0 },
        mentionFlashId: null,
        movingTokenId: null,
        legalMoves: [],
      })
    },

    move: async (tokenId) => {
      const { roomId, snapshot, movingTokenId } = get()
      if (!roomId || movingTokenId) return false // §88: one movement per dice
      const game = snapshot?.game
      const meId = useQuickyStore.getState().user?.id ?? ''
      if (!game || game.status !== 'playing') return false
      if (game.currentPlayerId !== meId) return false
      if (game.dice.value == null) return false
      // ═══ CLIENT-SIDE PREDICTION (smoothness revision) ═══
      // The tap must move the coin INSTANTLY — not one network round-trip
      // later. So the client runs the VERY SAME pure engine the server runs
      // (moveToken — one shared rule source, §85), commits the predicted
      // state IMMEDIATELY (the board animates the hop from the version
      // diff), and only then sends the action. The server validates in its
      // own time; its authoritative state replaces the prediction. On ANY
      // mismatch/rejection the server version WINS (forced reconcile —
      // never a forked board).
      const predicted = engineMoveToken(game, meId, tokenId, `local_${Date.now()}`)
      if (!predicted.ok) return false
      set({ movingTokenId: tokenId })
      // Optimistic commit BEFORE the network hop — zero perceived latency.
      set((prev) => ({
        snapshot: prev.snapshot
          ? { ...prev.snapshot, game: predicted.state as LudoGameState }
          : prev.snapshot,
      }))
      try {
        const res = await api.ludo.move(roomId, tokenId, newActionId())
        if (res?.ok && res.state) {
          // Server authority — same version as the prediction (usually the
          // identical state); replaces the optimistic copy atomically.
          set((prev) => ({
            snapshot: prev.snapshot
              ? { ...prev.snapshot, game: res.state as LudoGameState }
              : prev.snapshot,
          }))
          return true
        }
        // Rejected → our predicted version may sit ABOVE the server truth;
        // force-accept the next snapshot so the board snaps back.
        ctl.forceNextSnapshot = true
        void get().reconcile()
        return false
      } catch (e: any) {
        // §94: "Move unavailable" — reconcile the authoritative state, the
        // board corrects itself instead of breaking.
        ctl.forceNextSnapshot = true
        if (e?.status !== 409) toast.error(e?.message ?? 'Move unavailable')
        void get().reconcile()
        return false
      } finally {
        set({ movingTokenId: null })
      }
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
        // The room-chat STORAGE is shared with Spin Bottle (Ludo PRD §79) —
        // the ludo API wrapper posts to the same room-chat endpoint.
        const res = await api.ludo.sendChat(roomId, body, mentions)
        if (res?.message) {
          const confirmed: RoomMessage = { ...res.message, mentions: res.message.mentions ?? mentions ?? [], replyTo: replyTo ?? null }
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

    sendSticker: async (sticker) => {
      const { roomId, chat } = get()
      if (!roomId) return
      const tmpId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      const meId = useQuickyStore.getState().user?.id ?? ''
      const optimisticMeta = { stickerId: sticker.id, stickerName: sticker.name, stickerAsset: sticker.assetUrl }
      set({
        chat: [
          ...chat,
          { id: tmpId, userId: meId, text: sticker.name, kind: 'sticker', createdAt: new Date().toISOString(), metadata: optimisticMeta },
        ],
      })
      try {
        // Shared room-chat storage (Ludo PRD §79) — same endpoint, server
        // validates sticker ownership before writing the row.
        const res = await api.ludo.sendChat(roomId, sticker.name, [], sticker.id)
        if (res?.message) {
          const confirmed: RoomMessage = {
            ...res.message,
            metadata: res.message.metadata ?? optimisticMeta,
            mentions: [],
            replyTo: null,
          }
          ctl.channel?.sendChat({
            id: confirmed.id,
            messageId: confirmed.id,
            userId: confirmed.userId,
            text: confirmed.text,
            kind: 'sticker',
            createdAt: confirmed.createdAt,
            metadata: JSON.stringify(confirmed.metadata ?? optimisticMeta),
            replyTo: null,
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
        const res = await api.ludo.room(roomId)
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

    setMentionFlash: (id) => set({ mentionFlashId: id }),

    getSkew: () => ctl.skew,
  }
})
