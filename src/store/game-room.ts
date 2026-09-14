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
import type { RoomMessage } from '@/components/quicky/RoomChatPanel'

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
  }[]
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
  recentMessages: { id: string; userId: string; text: string; kind: string; createdAt: string }[]
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

  attach: (roomId: string) => void
  /** End the runtime — leave / room deleted. Never called on navigation. */
  detach: () => void
  respond: (choice: 'yes' | 'no') => void
  sendChat: (text: string, replyTo?: RoomMessage['replyTo']) => Promise<void>
  reconcile: () => Promise<void>
  bumpEconomy: (delta: Partial<Economy>) => void
  setCoinBalance: (n: number) => void
  /** Cosmetic gift push to the rest of the table via the room channel. */
  broadcastGift: (payload: Parameters<RoomChannel['sendGift']>[0]) => void
  /** Clear the closure dialog AND the runtime (BACK TO GAME path). */
  dismissClosure: () => void
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
    if (!spinId && ctl.lastSpinId) ctl.lastSpinId = null

    set((prev) => {
      // merge room chat — snapshot messages + optimistic/realtime items
      const prevMap = new Map(prev.chat.map((m) => [m.id, m]))
      const merged = s.recentMessages.map((m) => ({ ...m, replyTo: prevMap.get(m.id)?.replyTo ?? null }))
      const pending = prev.chat.filter((m) => m.id.startsWith('tmp_'))
      return { snapshot: s, chat: [...merged, ...pending] }
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
    optimistic: null,

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
          if (kind !== 'user' && kind !== 'join' && kind !== 'leave') return
          const msg: RoomMessage = {
            id: p.id || p.messageId || `rt_${Date.now()}`,
            userId: p.userId,
            text: p.text || '',
            kind,
            createdAt: p.createdAt || new Date().toISOString(),
            replyTo: p.replyTo ?? null,
          }
          set((prev) => {
            const withoutTmp = prev.chat.filter(
              (m) => m.userId !== msg.userId || !m.id.startsWith('tmp_') || m.text !== msg.text
            )
            if (withoutTmp.some((m) => m.id === msg.id)) return prev
            return { chat: [...withoutTmp, msg] }
          })
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
      })
    },

    dismissClosure: () => {
      get().detach()
    },

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

    sendChat: async (text, replyTo) => {
      const body = text.trim()
      const { roomId, chat } = get()
      if (!body || !roomId) return
      const tmpId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      const meId = useQuickyStore.getState().user?.id ?? ''
      set({
        chat: [...chat, { id: tmpId, userId: meId, text: body, kind: 'user', createdAt: new Date().toISOString(), replyTo: replyTo ?? null }],
      })
      try {
        const res = await api.spinBottle.sendChat(roomId, body)
        if (res?.message) {
          const confirmed: RoomMessage = { ...res.message, replyTo: replyTo ?? null }
          ctl.channel?.sendChat({
            id: confirmed.id,
            messageId: confirmed.id,
            userId: confirmed.userId,
            text: confirmed.text,
            kind: confirmed.kind,
            createdAt: confirmed.createdAt,
            replyTo: confirmed.replyTo,
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
