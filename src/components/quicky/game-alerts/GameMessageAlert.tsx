'use client'

// Quicky — GAME MESSAGE ALERT (in-game notification layer, private messages)
//
// When a PRIVATE game-chat message arrives and the user is NOT in that
// sender's chat screen, a small modal pops with the message preview — ONE
// LINE only, never the full body — plus a Reply button. Tapping Reply opens
// that user's chat screen directly (back arrow returns to where the user
// was). Gated by the in-game notification toggle (notifGameEvents) exactly
// like the turn alerts — one switch controls the whole layer.
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
import { X, MessageCircle } from 'lucide-react'
import { useQuickyStore } from '@/store/quicky'
import { useGameChatStore, subscribeGameChatIncoming, type GameChatMessage } from '@/store/game-chat'
import { hapticNotification } from '@/lib/capacitor'

/** Modal self-dismisses after this long (one tap anywhere dismisses sooner). */
const AUTO_DISMISS_MS = 9_000

type MessageAlertData = {
  id: string
  conversationId: string | null
  senderId: string
  text: string | null
  messageType: GameChatMessage['messageType']
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

const g = globalThis as unknown as { __quickyGameMsgAlertedIds?: Set<string> }
const alertedIds: Set<string> = (g.__quickyGameMsgAlertedIds ??= new Set())

export function GameMessageAlert() {
  const [alert, setAlert] = useState<MessageAlertData | null>(null)
  const alertRef = useRef<MessageAlertData | null>(null)
  useEffect(() => {
    alertRef.current = alert
  }, [alert])

  // Peer resolution from the conversation list (refreshed the moment the
  // message lands — §90 reorder). Reactive, so the name/avatar fill in as
  // soon as the row arrives even if the modal beat it.
  const conversationId = alert?.conversationId ?? null
  const peer = useGameChatStore((s) =>
    conversationId ? s.list.find((c) => c.conversationId === conversationId)?.peer ?? null : null
  )

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
      void hapticNotification('warning')
      setAlert({
        id: message.id,
        conversationId: conversationId ?? null,
        senderId: message.senderId,
        text: message.text ?? null,
        messageType: message.messageType,
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

  // Escape closes the modal.
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
    const qk = useQuickyStore.getState()
    const chat = useGameChatStore.getState()
    // Prefer the fully-resolved peer from the conversations list (avatar +
    // display name); fall back to the raw sender id with the shown name.
    const rowPeer = current.conversationId
      ? chat.list.find((c) => c.conversationId === current.conversationId)?.peer
      : undefined
    const peer = rowPeer
      ? { peerUserId: rowPeer.id, peerName: rowPeer.name, peerAvatar: rowPeer.avatar }
      : { peerUserId: current.senderId, peerName: peer?.name ?? null, peerAvatar: peer?.avatar ?? null }
    // Back arrow returns to whatever screen the user was on. From a chat
    // screen (another peer's conversation) return to THAT chat's own return
    // view instead of the chat view itself — never a dead game-chat screen.
    const returnView =
      qk.view === 'game-chat' ? qk.gameChatReturnView || 'spin-bottle' : qk.view
    qk.openGameChat(peer, returnView)
    setAlert(null)
  }

  return (
    <AnimatePresence>
      {alert && (
        <>
          <motion.div
            key="msg-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[238] bg-black/45 backdrop-blur-[2px]"
            onClick={() => setAlert(null)}
            aria-hidden
          />
          <motion.div
            key={alert.id}
            initial={{ scale: 0.92, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 26 }}
            className="fixed inset-x-0 top-1/2 z-[239] mx-auto w-[min(92vw,22rem)] -translate-y-1/2"
            role="dialog"
            aria-label="New game message"
            data-testid="game-message-alert"
          >
            <div className="bg-[var(--qk-card)] border border-white/12 rounded-3xl shadow-2xl p-5 flex flex-col items-center text-center gap-3">
              <button
                onClick={() => setAlert(null)}
                className="absolute top-3 right-3 text-white/40 hover:text-white/80 active:scale-90 transition"
                aria-label="Dismiss message notification"
                data-testid="game-message-dismiss"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="relative shrink-0">
                {peer?.avatar ? (
                  <img src={peer.avatar} alt="" className="w-16 h-16 rounded-2xl object-cover" />
                ) : (
                  <span className="w-16 h-16 rounded-2xl bg-white/10 flex items-center justify-center text-2xl" aria-hidden>
                    💬
                  </span>
                )}
                <span className="absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-full bg-coral-gradient border border-white/20 flex items-center justify-center">
                  <MessageCircle className="w-3.5 h-3.5 text-white" aria-hidden />
                </span>
              </div>

              <div className="min-w-0 w-full">
                <p className="text-[10px] font-black tracking-[0.18em] text-[var(--qk-accent)] uppercase">
                  New game message
                </p>
                <p className="text-white font-black text-base leading-tight truncate">
                  {peer?.name ?? 'New message'}
                </p>
                {/* ONE line, truncated — the full message lives in the chat */}
                <p className="text-white/70 text-sm font-semibold mt-1 truncate" data-testid="game-message-preview">
                  {previewLine(alert) || 'Sent you a message'}
                </p>
              </div>

              <div className="flex items-center gap-2.5 w-full">
                <button
                  onClick={reply}
                  className="flex-1 bg-coral-gradient glow-coral rounded-xl px-4 py-2.5 text-sm font-black tracking-wide active:scale-95 transition"
                  aria-label={`Reply to ${peer?.name ?? 'sender'}`}
                  data-testid="game-message-reply"
                >
                  Reply
                </button>
                <button
                  onClick={() => setAlert(null)}
                  className="bg-white/10 border border-white/15 rounded-xl px-4 py-2.5 text-sm font-bold text-white/80 active:scale-95 transition"
                  aria-label="Dismiss message notification"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
