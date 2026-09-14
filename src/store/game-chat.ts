'use client'

// Quicky — GAME CHAT CLIENT STORE (game-chat PRD §19-§24/§79/§90-§93)
//
// Client state for the PRIVATE player-to-player Game Chat. Independent from
// Dating Chat state and from the room runtime:
//
//   · ONE SSE stream per app serves ALL conversations (§91) — connected when
//     the user enters the Spin the Bottle section, disconnected on leaving.
//   · Optimistic sending with clientMessageId (§22/§92/§93): the bubble
//     appears instantly, the confirmed row replaces it by id, failures stay
//     visible with a retry (§22 — messages are never silently lost).
//   · Realtime events: message push, conversation-list reorder/unread nudge
//     (§90), live read receipts (§16/§17), reaction updates (§32).
//   · Cursor pagination state for "load older" (§24).

import { create } from 'zustand'
import { api } from '@/lib/quicky/api-client'
import { useQuickyStore } from '@/store/quicky'

export type GameChatMessageType = 'text' | 'sticker' | 'image' | 'voice' | 'quicky_image'

export type GameChatMessage = {
  id: string
  conversationId?: string
  senderId: string
  messageType: GameChatMessageType
  text: string | null
  stickerId?: string | null
  sticker?: { id: string; name: string; assetUrl: string } | null
  mediaUrl?: string | null
  mediaDuration?: number | null
  replyToMessageId?: string | null
  replyTo?: { id: string; senderId: string; senderName: string | null; text: string; messageType: string } | null
  clientMessageId?: string | null
  createdAt: string
  reactions: { reaction: string; userIds: string[] }[]
  // client-only states
  pending?: boolean
  failed?: boolean
  // media still uploading locally (never persisted)
  localPreview?: string | null
}

export type GameChatConversationRow = {
  conversationId: string
  peer: { id: string; name: string | null; avatar: string | null }
  lastMessage: { id: string; fromMe: boolean; messageType: string; preview: string; createdAt: string } | null
  lastMessageAt: string | null
  unread: number
}

type GameChatState = {
  // list
  list: GameChatConversationRow[]
  listLoaded: boolean
  listLoading: boolean
  // active conversation
  activePeer: { peerUserId: string; peerName: string | null; peerAvatar: string | null } | null
  activeConversationId: string | null
  messages: GameChatMessage[]
  hasMore: boolean
  oldestCursor: string | null
  peerLastReadAt: string | null
  loadingOlder: boolean
  replyTo: GameChatMessage | null
  // §6/§156: the chat screen NEVER renders a black screen — while the
  // conversation resolves we show a loading beat; on failure an error state
  // with Retry. `peerUnavailable` covers §7 (selected user gone).
  opening: boolean
  openError: 'network' | 'user_gone' | null
  // connection
  streamOk: boolean

  // actions
  connectStream: () => void
  disconnectStream: () => void
  refreshList: (debounce?: boolean) => void
  openConversation: (peer: { peerUserId: string; peerName: string | null; peerAvatar: string | null }) => void
  closeConversation: () => void
  loadOlder: () => Promise<void>
  setReplyTo: (m: GameChatMessage | null) => void
  sendMessage: (text: string) => void
  sendSticker: (sticker: { id: string; name: string; assetUrl: string }) => void
  sendMedia: (type: 'image' | 'voice' | 'quicky_image', mediaUrl: string, mediaDuration?: number) => void
  retryMessage: (clientMessageId: string) => void
  toggleReaction: (messageId: string, reaction: string) => void
  markActiveRead: () => void
  refreshActive: () => Promise<void>
}

const g = globalThis as unknown as {
  __quickyGameChatStream?: {
    es: EventSource | null
    listTimer: ReturnType<typeof setTimeout> | null
  }
}
const ctl = (g.__quickyGameChatStream ??= { es: null, listTimer: null })

export const useGameChatStore = create<GameChatState>((set, get) => {
  // ── message merge: realtime + optimistic + pagination coexist (§92) ──────
  const mergeMessages = (incoming: GameChatMessage[]) =>
    set((prev) => {
      const map = new Map(prev.messages.map((m) => [m.id, m]))
      for (const msg of incoming) {
        // confirmed rows replace their optimistic twin (same clientMessageId)
        if (msg.clientMessageId) {
          for (const [id, m] of map) {
            if (m.clientMessageId === msg.clientMessageId && m.id !== msg.id) map.delete(id)
          }
        }
        const existing = map.get(msg.id)
        map.set(msg.id, existing ? { ...existing, ...msg, pending: false, failed: false } : msg)
      }
      const next = Array.from(map.values())
      next.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      return { messages: next }
    })

  const refreshListNow = async () => {
    try {
      const res = await api.gameChat.conversations()
      set({ list: res.conversations ?? [], listLoaded: true, listLoading: false })
    } catch {
      set({ listLoading: false })
    }
  }

  return {
    list: [],
    listLoaded: false,
    listLoading: false,
    activePeer: null,
    activeConversationId: null,
    messages: [],
    hasMore: false,
    oldestCursor: null,
    peerLastReadAt: null,
    loadingOlder: false,
    replyTo: null,
    opening: false,
    openError: null,
    streamOk: false,

    connectStream: () => {
      if (ctl.es) return
      try {
        const es = new EventSource('/api/quicky/game-chat/stream')
        es.addEventListener('message', (e) => {
          try {
            const evt = JSON.parse((e as MessageEvent).data)
            if (evt?.type === 'hello') set({ streamOk: true })
            else if (evt?.type === 'message') {
              const msg = evt.message as GameChatMessage
              const meId = useQuickyStore.getState().user?.id
              if (evt.conversationId === get().activeConversationId) {
                mergeMessages([msg])
                // §16: a message arriving while I'm viewing → mark read
                if (msg.senderId !== meId) get().markActiveRead()
              }
              if (msg.senderId !== meId) get().refreshList(true) // §90: reorder + unread
            } else if (evt?.type === 'conversation') {
              get().refreshList(true)
            } else if (evt?.type === 'read') {
              // §17: peer read my messages → ✓✓ updates live
              if (evt.conversationId === get().activeConversationId) {
                set({ peerLastReadAt: evt.lastReadAt })
              }
            } else if (evt?.type === 'reaction') {
              if (evt.conversationId === get().activeConversationId) void get().refreshActive()
            }
          } catch {}
        })
        es.onerror = () => set({ streamOk: false })
        es.onopen = () => {
          set({ streamOk: true })
          // §21: reconnect → fetch anything missed since the last event
          if (get().activeConversationId) void get().refreshActive()
          get().refreshList(true)
        }
        ctl.es = es
      } catch {
        set({ streamOk: false })
      }
    },

    disconnectStream: () => {
      try {
        ctl.es?.close()
      } catch {}
      ctl.es = null
      set({ streamOk: false })
    },

    refreshList: (debounce) => {
      if (debounce) {
        if (ctl.listTimer) return
        ctl.listTimer = setTimeout(() => {
          ctl.listTimer = null
          void refreshListNow()
        }, 350)
        return
      }
      set({ listLoading: true })
      void refreshListNow()
    },

    openConversation: (peer) => {
      // §3/§6/§7: the chat screen must never be blank — while resolving, the
      // screen shows a loading state; failures land in openError (retryable).
      set({
        activePeer: peer,
        activeConversationId: null,
        messages: [],
        hasMore: false,
        oldestCursor: null,
        peerLastReadAt: null,
        replyTo: null,
        opening: true,
        openError: null,
      })
      void (async () => {
        try {
          const res = await api.gameChat.messages({ peerUserId: peer.peerUserId })
          if (useGameChatStore.getState().activePeer?.peerUserId !== peer.peerUserId) return
          set({
            activeConversationId: res.conversationId,
            peerLastReadAt: res.peerLastReadAt,
            hasMore: res.hasMore,
            oldestCursor: res.oldestCursor,
            opening: false,
            openError: null,
          })
          mergeMessages(res.messages)
          // §16: the chat screen is now visible → mark read
          if (res.conversationId) {
            void api.gameChat.markRead(res.conversationId).then(() => {
              useGameChatStore.getState().refreshList(true)
            }).catch(() => {})
          }
        } catch (e: any) {
          if (useGameChatStore.getState().activePeer?.peerUserId !== peer.peerUserId) return
          // §7: a user that no longer exists must show "User unavailable",
          // never a crash or a blank screen.
          const status = e?.status ?? e?.body?.status
          set({
            opening: false,
            openError: status === 404 || status === 400 ? 'user_gone' : 'network',
          })
        }
      })()
    },

    closeConversation: () =>
      set({
        activePeer: null,
        activeConversationId: null,
        messages: [],
        hasMore: false,
        oldestCursor: null,
        peerLastReadAt: null,
        replyTo: null,
        opening: false,
        openError: null,
      }),

    loadOlder: async () => {
      const { activeConversationId, oldestCursor, loadingOlder, hasMore } = get()
      if (!activeConversationId || !hasMore || loadingOlder || !oldestCursor) return
      set({ loadingOlder: true })
      try {
        const res = await api.gameChat.messages({ conversationId: activeConversationId, before: oldestCursor })
        mergeMessages(res.messages)
        set({ hasMore: res.hasMore, oldestCursor: res.oldestCursor })
      } catch {
      } finally {
        set({ loadingOlder: false })
      }
    },

    setReplyTo: (m) => set({ replyTo: m }),

    sendMessage: (text) => {
      const body = text.trim()
      const { activePeer, activeConversationId, replyTo } = get()
      if (!body || !activePeer) return
      const meId = useQuickyStore.getState().user?.id ?? ''
      const clientMessageId = `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const optimistic: GameChatMessage = {
        id: `tmp_${clientMessageId}`,
        conversationId: activeConversationId ?? undefined,
        senderId: meId,
        messageType: 'text',
        text: body,
        replyToMessageId: replyTo?.id ?? null,
        replyTo: replyTo
          ? { id: replyTo.id, senderId: replyTo.senderId, senderName: null, text: replyTo.text ?? '', messageType: replyTo.messageType }
          : null,
        clientMessageId,
        createdAt: new Date().toISOString(),
        reactions: [],
        pending: true,
      }
      mergeMessages([optimistic])
      set({ replyTo: null })
      void (async () => {
        try {
          const res = await api.gameChat.send({
            peerUserId: activePeer.peerUserId,
            conversationId: activeConversationId ?? undefined,
            messageType: 'text',
            text: body,
            replyToMessageId: replyTo?.id || undefined,
            clientMessageId,
          })
          mergeMessages([res.message])
          if (!activeConversationId && res.conversationId) {
            set({ activeConversationId: res.conversationId })
          }
          // my own send also refreshes the list order (§88/§90)
          get().refreshList(true)
        } catch {
          // §22: never silently lose the message — mark failed, keep visible
          set((prev) => ({
            messages: prev.messages.map((m) =>
              m.clientMessageId === clientMessageId ? { ...m, pending: false, failed: true } : m
            ),
          }))
        }
      })()
    },

    sendSticker: (sticker) => {
      const { activePeer, activeConversationId } = get()
      if (!activePeer) return
      const meId = useQuickyStore.getState().user?.id ?? ''
      const clientMessageId = `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const optimistic: GameChatMessage = {
        id: `tmp_${clientMessageId}`,
        conversationId: activeConversationId ?? undefined,
        senderId: meId,
        messageType: 'sticker',
        text: null,
        sticker,
        clientMessageId,
        createdAt: new Date().toISOString(),
        reactions: [],
        pending: true,
      }
      mergeMessages([optimistic])
      void (async () => {
        try {
          const res = await api.gameChat.send({
            peerUserId: activePeer.peerUserId,
            conversationId: activeConversationId ?? undefined,
            messageType: 'sticker',
            stickerId: sticker.id,
            clientMessageId,
          })
          mergeMessages([res.message])
          if (!activeConversationId && res.conversationId) set({ activeConversationId: res.conversationId })
          get().refreshList(true)
        } catch {
          set((prev) => ({
            messages: prev.messages.map((m) =>
              m.clientMessageId === clientMessageId ? { ...m, pending: false, failed: true } : m
            ),
          }))
        }
      })()
    },

    sendMedia: (type, mediaUrl, mediaDuration) => {
      const { activePeer, activeConversationId, replyTo } = get()
      if (!activePeer) return
      const meId = useQuickyStore.getState().user?.id ?? ''
      const clientMessageId = `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const optimistic: GameChatMessage = {
        id: `tmp_${clientMessageId}`,
        conversationId: activeConversationId ?? undefined,
        senderId: meId,
        messageType: type,
        text: null,
        mediaUrl,
        mediaDuration: mediaDuration ?? null,
        replyToMessageId: replyTo?.id ?? null,
        replyTo: replyTo
          ? { id: replyTo.id, senderId: replyTo.senderId, senderName: null, text: replyTo.text ?? '', messageType: replyTo.messageType }
          : null,
        clientMessageId,
        createdAt: new Date().toISOString(),
        reactions: [],
        pending: true,
        // §121: only THIS message's submission is gated — other sends stay free
      }
      mergeMessages([optimistic])
      set({ replyTo: null })
      void (async () => {
        try {
          const res = await api.gameChat.send({
            peerUserId: activePeer.peerUserId,
            conversationId: activeConversationId ?? undefined,
            messageType: type,
            mediaUrl,
            mediaDuration,
            replyToMessageId: replyTo?.id || undefined,
            clientMessageId,
          })
          mergeMessages([res.message])
          if (!activeConversationId && res.conversationId) {
            set({ activeConversationId: res.conversationId })
          }
          get().refreshList(true)
        } catch {
          // §116: upload/send failure stays visible with a retry — never a
          // broken message row, never a silent loss.
          set((prev) => ({
            messages: prev.messages.map((m) =>
              m.clientMessageId === clientMessageId ? { ...m, pending: false, failed: true } : m
            ),
          }))
        }
      })()
    },

    retryMessage: (clientMessageId) => {
      const { activePeer, activeConversationId, messages } = get()
      const msg = messages.find((m) => m.clientMessageId === clientMessageId)
      if (!msg || !activePeer) return
      set((prev) => ({
        messages: prev.messages.map((m) =>
          m.clientMessageId === clientMessageId ? { ...m, pending: true, failed: false } : m
        ),
      }))
      void (async () => {
        try {
          const res = await api.gameChat.send({
            peerUserId: activePeer.peerUserId,
            conversationId: activeConversationId ?? undefined,
            messageType: msg.messageType,
            text: msg.text ?? undefined,
            stickerId: msg.stickerId ?? undefined,
            mediaUrl: msg.mediaUrl ?? undefined,
            mediaDuration: msg.mediaDuration ?? undefined,
            replyToMessageId: msg.replyToMessageId ?? undefined,
            clientMessageId, // §92: same id → idempotent on the server
          })
          mergeMessages([res.message])
          if (!activeConversationId && res.conversationId) set({ activeConversationId: res.conversationId })
        } catch {
          set((prev) => ({
            messages: prev.messages.map((m) =>
              m.clientMessageId === clientMessageId ? { ...m, pending: false, failed: true } : m
            ),
          }))
        }
      })()
    },

    toggleReaction: (messageId, reaction) => {
      const meId = useQuickyStore.getState().user?.id ?? ''
      // §31/§32: optimistic local flip, then the server upsert
      set((prev) => ({
        messages: prev.messages.map((m) => {
          if (m.id !== messageId) return m
          const existing = m.reactions.find((r) => r.reaction === reaction)
          const mineOn = existing?.userIds.includes(meId)
          let reactions = m.reactions.filter((r) => r.reaction !== reaction || r.userIds.length > 0)
          if (existing) {
            if (mineOn) {
              const userIds = existing.userIds.filter((u) => u !== meId)
              reactions = reactions
                .map((r) => (r.reaction === reaction ? { reaction, userIds } : r))
                .filter((r) => r.userIds.length > 0)
            } else {
              reactions = reactions.map((r) => (r.reaction === reaction ? { reaction, userIds: [...r.userIds, meId] } : r))
            }
          } else {
            reactions = [...reactions, { reaction, userIds: [meId] }]
          }
          return { ...m, reactions }
        }),
      }))
      void api.gameChat.react(messageId, reaction).catch(() => {
        void get().refreshActive() // server truth on failure
      })
    },

    markActiveRead: () => {
      const conversationId = get().activeConversationId
      if (!conversationId) return
      void api.gameChat
        .markRead(conversationId)
        .then(() => useGameChatStore.getState().refreshList(true))
        .catch(() => {})
    },

    refreshActive: async () => {
      const { activeConversationId, activePeer } = get()
      if (!activeConversationId || !activePeer) return
      try {
        const res = await api.gameChat.messages({ conversationId: activeConversationId })
        mergeMessages(res.messages)
        set({ peerLastReadAt: res.peerLastReadAt, hasMore: res.hasMore, oldestCursor: res.oldestCursor })
      } catch {}
    },
  }
})
