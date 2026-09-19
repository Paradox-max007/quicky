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
//   · roll / move actions — single-flight, actionId-stamped (§48/§50)

import { create } from 'zustand'
import { toast } from 'sonner'
import { api } from '@/lib/quicky/api-client'
import { joinRoomChannel, type RoomChannel } from '@/lib/quicky/realtime'
import { useQuickyStore } from '@/store/quicky'
import { alertMentionOnce } from '@/lib/quicky/mention-alerts'
import type { RoomMessage } from '@/components/quicky/RoomChatPanel'
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
  /** Local roll/move single-flight (§88 race-condition tests). */
  rolling: boolean
  movingTokenId: string | null
  /** Last server response for the UI (dice + legal token ids). */
  legalMoves: LudoLegalMove[]

  attach: (roomId: string) => void
  detach: () => void
  roll: () => Promise<{ dice: number; legal: string[] } | null>
  move: (tokenId: string) => Promise<boolean>
  sendChat: (
    text: string,
    replyTo?: RoomMessage['replyTo'],
    mentions?: { userId: string; displayName: string }[]
  ) => Promise<void>
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
      }))
      const pending = prev.chat.filter((m) => m.id.startsWith('tmp_'))
      return { snapshot: snap, chat: [...merged, ...pending] }
    })
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
    rolling: false,
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
        rolling: false,
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
        // Typed LUDO_* events — the authoritative snapshot follows right
        // behind; these only drive immediate UX (haptics/animation hints).
        es.addEventListener('room_event', (e) => {
          try {
            const { event } = JSON.parse((e as MessageEvent).data) as { event: string }
            void event // animations are driven by game.version + lastEvent
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
          if (kind !== 'user' && kind !== 'join' && kind !== 'leave') return
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
          if (p?.recipientId === (useQuickyStore.getState().user?.id ?? '')) {
            get().bumpEconomy({ giftsReceived: Math.max(1, Number(p?.quantity ?? 1)) })
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
        rolling: false,
        movingTokenId: null,
        legalMoves: [],
      })
    },

    roll: async () => {
      const { roomId, rolling, snapshot } = get()
      if (!roomId || rolling) return null
      const game = snapshot?.game
      if (!game || game.status !== 'playing') return null
      if (game.currentPlayerId !== (useQuickyStore.getState().user?.id ?? '')) return null
      if (game.dice.value != null) return null // §88: one roll per turn
      set({ rolling: true })
      try {
        const res = await api.ludo.roll(roomId, newActionId())
        if (res?.ok && res.state) {
          set((prev) => ({
            snapshot: prev.snapshot
              ? { ...prev.snapshot, game: res.state as LudoGameState }
              : prev.snapshot,
            legalMoves: [],
          }))
          return { dice: res.dice, legal: res.legalMoves ?? [] }
        }
        return null
      } catch (e: any) {
        if (e?.status !== 409) toast.error(e?.message ?? 'Roll failed')
        void get().reconcile()
        return null
      } finally {
        set({ rolling: false })
      }
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
