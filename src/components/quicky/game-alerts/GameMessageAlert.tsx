'use client'

// Quicky — GAME MESSAGE ALERT (in-game notification layer, private messages)
//
// When a PRIVATE game-chat message arrives and the user is NOT in that
// sender's chat screen, a TOP DRAWER slides down with the SENDER'S CACHED
// PROFILE (image + name — persisted in localStorage so it paints even before
// the conversation list arrives) and the message preview — ONE LINE only,
// never the full body — plus a Reply button.
//
// DRAWER CHOREOGRAPHY (notification-drawer revision): EXACTLY the same
// popup system as the gameplay notifications (GameDecisionDrawer /
// TurnAlertCard): slides down from the top over whatever screen the user
// is on (300ms easeInOut), drag-down-to-dismiss with the shared threshold
// (offset > 90px or velocity > 600 — swipe works on Capacitor, mobile web
// and every mobile surface), auto-dismisses after AUTO_DISMISS_MS, and
// carries NO backdrop — the game underneath stays FULLY visible and
// playable ("do not overly disturb the gameplay"). The only difference
// from the gameplay drawers is the PAINT: this one wears the ACTIVE
// THEME's accent color (Golden Hour → a gold drawer; Lavender Dream →
// lavender…) with the matching readable text colors (--qk-on-accent), so
// the two kinds stay instantly distinguishable at a glance.
//
// REPLY NAVIGATION: Reply opens that sender's chat screen directly; the back
// stack is chat → contacts → the game — hitting back from the chat lands on
// the contacts screen, back again returns to the live game room (the runtime
// never detached).
//
// Gated by the in-game notification toggle (notifGameEvents — personal
// messages ONLY; gameplay alerts are never muted by it).
//
// Skip conditions (no modal — the message is already being seen):
//   · view 'game-chat' with that sender open as the active peer
//   · inside a game room with the embedded PERSONAL chat panel showing that
//     sender (roomChatPanel === 'personal' + matching activePeer)
//
// Reconnect-safe: deduped by message id (module-level, same pattern as the
// mention-alert gate); a redelivered SSE event never re-alerts.

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { MessageCircle } from 'lucide-react'
import { useQuickyStore, type AppView } from '@/store/quicky'
import { useGameChatStore, subscribeGameChatIncoming, type GameChatMessage } from '@/store/game-chat'
import { cacheGet, cacheSet } from '@/lib/quicky/cache'
import { hapticNotification } from '@/lib/capacitor'

/** Drawer self-dismisses after this long (a swipe or the Dismiss button
 *  hides it sooner). Same "non-intrusive" pacing for every surface. */
const AUTO_DISMISS_MS = 9_000

/** localStorage key for the persisted sender-profile cache (qk: prefix). */
const PEER_CACHE_KEY = 'game_chat_peers'

type MessageAlertData = {
  id: string
  conversationId: string | null
  senderId: string
  text: string | null
  messageType: GameChatMessage['messageType']
  /** Contacts screen's back target, captured when the alert armed — the
   *  live game room when one is attached, else the screen the user was on. */
  baseView: AppView
}

/** One-line typed previews — identical labels to the contacts rows. */
function previewLine(m: MessageAlertData): string {
  switch (m.messageType) {
    case 'sticker':
      return 'Sent a sticker 🎁'
    case 'image':
      return 'Sent an image 🖼'
    case 'voice':
      return 'Sent a voice message 🎙'
    case 'quicky_image':
      return 'Sent a Quicky Image ⚡'
    default:
      return (m.text ?? '').replace(/\s+/g, ' ').trim()
  }
}

const g = globalThis as unknown as {
  __quickyGameMsgAlertedIds?: Set<string>
  __quickyGamePeerCache?: Map<string, { name: string | null; avatar: string | null }>
}

/** Cached sender profiles — every conversation row ever seen, persisted to
 *  localStorage (Capacitor: survives restarts). Seeds once per module load;
 *  refreshed from the live conversation list below. */
const peerCache: Map<string, { name: string | null; avatar: string | null }> =
  (g.__quickyGamePeerCache ??= (() => {
    const m = new Map<string, { name: string | null; avatar: string | null }>()
    const saved = cacheGet<Record<string, { name: string | null; avatar: string | null }>>(PEER_CACHE_KEY, {
      allowStale: true,
    })
    if (saved && typeof saved === 'object') {
      for (const [id, info] of Object.entries(saved)) {
        if (info && typeof info === 'object') m.set(id, { name: info.name ?? null, avatar: info.avatar ?? null })
      }
    }
    return m
  })())

function persistPeerCache() {
  // Keep the payload bounded — the freshest 200 senders.
  const entries = [...peerCache.entries()].slice(-200)
  cacheSet(PEER_CACHE_KEY, Object.fromEntries(entries))
}

/** The contacts screen's back target at alert time: the live game room when
 *  one is attached; otherwise the surface the user was on (chat surfaces
 *  resolve to their OWN back targets so the chain never loops on itself). */
function gameBaseView(): AppView {
  const qk = useQuickyStore.getState()
  if (qk.spinBottleRoomId) return 'spin-bottle-room'
  if (qk.ludoRoomId) return 'ludo-room'
  if (qk.view === 'game-chat') return qk.gameChatReturnView || 'spin-bottle'
  if (qk.view === 'game-chat-contacts') return qk.gameChatContactsReturnView || 'spin-bottle-room'
  return qk.view
}

const alertedIds: Set<string> = (g.__quickyGameMsgAlertedIds ??= new Set())

export function GameMessageAlert() {
  const [alert, setAlert] = useState<MessageAlertData | null>(null)
  const alertRef = useRef<MessageAlertData | null>(null)
  useEffect(() => {
    alertRef.current = alert
  }, [alert])

  // Peer resolution: LIVE conversation row first (freshest avatar + name),
  // then the persisted cache — the sender's profile picture paints from the
  // cache even when the list hasn't loaded/refreshed yet.
  const conversationId = alert?.conversationId ?? null
  const senderId = alert?.senderId ?? null
  const listPeer = useGameChatStore((s) =>
    conversationId ? s.list.find((c) => c.conversationId === conversationId)?.peer ?? null : null
  )
  const cachedPeer = senderId ? peerCache.get(senderId) ?? null : null
  const peer = listPeer ?? (cachedPeer ? { id: senderId!, name: cachedPeer.name, avatar: cachedPeer.avatar } : null)

  // Keep the persistent sender-profile cache fresh off the conversation list.
  const list = useGameChatStore((s) => s.list)
  useEffect(() => {
    if (!list?.length) return
    let changed = false
    for (const row of list) {
      const prev = peerCache.get(row.peer.id)
      if (!prev || prev.name !== row.peer.name || prev.avatar !== row.peer.avatar) {
        peerCache.set(row.peer.id, { name: row.peer.name, avatar: row.peer.avatar })
        changed = true
      }
    }
    if (changed) persistPeerCache()
  }, [list])

  // ── The incoming-message tap ─────────────────────────────────────────────
  useEffect(() => {
    const off = subscribeGameChatIncoming(({ message, conversationId }) => {
      const meId = useQuickyStore.getState().user?.id
      if (!message || !message.id || message.senderId === meId) return
      // Reconnect/redelivery guard — each message alerts at most once.
      if (alertedIds.has(message.id)) return
      alertedIds.add(message.id)
      if (alertedIds.size > 400) {
        let n = 200
        for (const id of alertedIds) {
          if (n-- <= 0) break
          alertedIds.delete(id)
        }
      }
      // On the sender's chat screen already? Then the message is being seen.
      const qk = useQuickyStore.getState()
      const chat = useGameChatStore.getState()
      const onThatChat =
        qk.view === 'game-chat' && chat.activePeer?.peerUserId === message.senderId
      const onEmbeddedPanel =
        (qk.view === 'spin-bottle-room' || qk.view === 'ludo-room') &&
        qk.roomChatPanel === 'personal' &&
        chat.activePeer?.peerUserId === message.senderId
      if (onThatChat || onEmbeddedPanel) return
      // Seed the sender's cached profile so the modal paints it instantly.
      const row = conversationId
        ? chat.list.find((c) => c.conversationId === conversationId)?.peer
        : undefined
      if (row && (row.name || row.avatar)) {
        peerCache.set(row.id, { name: row.name, avatar: row.avatar })
        persistPeerCache()
      }
      void hapticNotification('warning')
      setAlert({
        id: message.id,
        conversationId: conversationId ?? null,
        senderId: message.senderId,
        text: message.text ?? null,
        messageType: message.messageType,
        baseView: gameBaseView(),
      })
    })
    return off
  }, [])

  // ── Auto-dismiss ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!alert) return
    const t = setTimeout(() => setAlert(null), AUTO_DISMISS_MS)
    return () => clearTimeout(t)
  }, [alert])

  // Escape closes the drawer (keyboards attached to tablets etc.).
  useEffect(() => {
    if (!alert) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAlert(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [alert])

  const reply = () => {
    const current = alertRef.current
    if (!current) return
    const chat = useGameChatStore.getState()
    // Prefer the fully-resolved peer (list row, then the persisted cache);
    // fall back to the raw sender id — the chat screen resolves the rest.
    const rowPeer = current.conversationId
      ? chat.list.find((c) => c.conversationId === current.conversationId)?.peer
      : undefined
    const cached = peerCache.get(current.senderId)
    const target = rowPeer
      ? { peerUserId: rowPeer.id, peerName: rowPeer.name, peerAvatar: rowPeer.avatar }
      : cached
        ? { peerUserId: current.senderId, peerName: cached.name, peerAvatar: cached.avatar }
        : peer
          ? { peerUserId: peer.id, peerName: peer.name, peerAvatar: peer.avatar }
          : { peerUserId: current.senderId, peerName: null, peerAvatar: null }
    // Back stack (explicit): chat → contacts → the game. The personal chat's
    // back lands on the CONTACTS screen; the contacts screen's back lands on
    // the live game room (the runtime never detached — the board re-renders
    // the authoritative state on return).
    const qk = useQuickyStore.getState()
    qk.openGameChatContacts(current.baseView)
    qk.openGameChat(target, 'game-chat-contacts')
    setAlert(null)
  }

  return (
    <AnimatePresence>
      {alert && (
        <motion.div
          key={alert.id}
          // IDENTICAL choreography to the gameplay drawers (GameDecisionDrawer
          // §83/§84 + TurnAlertCard): slide-down 300ms, drag down to dismiss
          // with the shared threshold — below it, snap back. NO backdrop:
          // the game/table underneath stays visible and fully playable.
          initial={{ y: '-120%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '-120%', opacity: 0 }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.55 }}
          onDragEnd={(_, info) => {
            if (info.offset.y > 90 || info.velocity.y > 600) setAlert(null)
          }}
          className="fixed top-[max(env(safe-area-inset-top),0.5rem)] inset-x-0 z-[232] mx-auto w-[min(94vw,26rem)]"
          role="dialog"
          aria-label="New game message"
          data-testid="game-message-alert"
        >
          {/* THEME-COLORED drawer: the active theme's accent as the
              background + its matching readable text color — identical
              geometry and choreography to the gameplay cards, only the
              paint differs. Golden Hour → gold drawer with deep-brown
              text; Midnight → coral with white. */}
          <div
            className="relative border border-white/25 rounded-3xl shadow-2xl p-4 flex items-center gap-3.5"
            style={{ background: 'var(--qk-accent)' }}
          >
            {/* drag hint — the same affordance as the gameplay drawers, in
                the on-accent color so it reads on every theme */}
            <div
              className="absolute top-1.5 left-1/2 -translate-x-1/2 h-1 w-10 rounded-full"
              style={{ background: 'var(--qk-on-accent)', opacity: 0.25 }}
              aria-hidden
            />

            {/* The sender's CACHED profile image (list row when live, the
                persisted cache otherwise) — never an anonymous placeholder
                when we have ever seen this sender before. */}
            <div className="relative shrink-0">
              {peer?.avatar ? (
                <img
                  src={peer.avatar}
                  alt=""
                  className="w-16 h-16 rounded-2xl object-cover border border-white/40 shadow-md"
                />
              ) : (
                <span
                  className="w-16 h-16 rounded-2xl bg-black/15 flex items-center justify-center text-2xl"
                  aria-hidden
                >
                  💬
                </span>
              )}
              <span className="absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-full bg-white border border-black/10 flex items-center justify-center">
                <MessageCircle className="w-3.5 h-3.5" style={{ color: 'var(--qk-accent)' }} aria-hidden />
              </span>
            </div>

            <div className="min-w-0 flex-1">
              <p
                className="text-[10px] font-black tracking-[0.18em] uppercase"
                style={{ color: 'var(--qk-on-accent-soft)' }}
              >
                New game message
              </p>
              <p className="font-black text-base leading-tight truncate" style={{ color: 'var(--qk-on-accent)' }}>
                {peer?.name ?? 'New message'}
              </p>
              {/* ONE line, truncated — the full message lives in the chat */}
              <p
                className="text-xs font-semibold mt-0.5 truncate"
                style={{ color: 'var(--qk-on-accent-soft)' }}
                data-testid="game-message-preview"
              >
                {previewLine(alert) || 'Sent you a message'}
              </p>
            </div>

            {/* Same vertical action stack as the gameplay turn card:
                the primary action on top, dismiss below. */}
            <div className="flex flex-col gap-1.5 shrink-0">
              <button
                onClick={reply}
                className="bg-white rounded-xl px-3.5 py-2 text-xs font-black tracking-wide active:scale-95 transition shadow-md"
                style={{ color: 'var(--qk-accent)' }}
                aria-label={`Reply to ${peer?.name ?? 'sender'}`}
                data-testid="game-message-reply"
              >
                Reply
              </button>
              <button
                onClick={() => setAlert(null)}
                className="bg-black/25 border border-white/25 rounded-xl px-3.5 py-1.5 text-[11px] font-bold active:scale-95 transition"
                style={{ color: 'var(--qk-on-accent)' }}
                aria-label="Dismiss message notification"
                data-testid="game-message-dismiss"
              >
                Dismiss
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
