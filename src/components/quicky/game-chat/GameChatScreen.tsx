'use client'

// Quicky — GAME CHAT SCREEN (game-chat PRD §22-§33/§78-§84/§94-§97/§124)
//
// Private 1-to-1 chat with another PLAYER (never a dating match) — visually
// part of the Spin the Bottle section. Layout: compact header (§33), message
// list, composer. Everything realtime via the shared store stream:
//   · optimistic bubbles + retry, never silently lost (§22)
//   · reply-by-swipe on mobile (§25), hover ⋯ actions on web (§30), with a
//     non-gesture ⋯ control as the accessible equivalent (§124)
//   · long-press reaction picker ~500ms (§28/§29)
//   · read receipts ✓ / ✓✓ (§17), NO typing indicator (§18 — disabled)
//   · near-bottom autoscroll / "New messages" pill (§79)
//   · sticker tray backed by admin bundles + coin purchase (§62/§76/§78)

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, Plus, Send, X } from 'lucide-react'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { useQuickyStore } from '@/store/quicky'
import { useGameChatStore, type GameChatMessage } from '@/store/game-chat'

const REACTIONS = ['❤️', '😂', '😮', '😢', '👍', '🔥'] // §28 picker set
const NEAR_BOTTOM_PX = 140

function isImageAsset(url: string) {
  return url.startsWith('https://')
}

function StickerAsset({ sticker }: { sticker: { name: string; assetUrl: string } }) {
  if (isImageAsset(sticker.assetUrl)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={sticker.assetUrl} alt={sticker.name} className="w-20 h-20 object-contain" draggable={false} />
  }
  return <span className="text-5xl leading-none" role="img" aria-label={sticker.name}>{sticker.assetUrl}</span>
}

export function GameChatScreen() {
  const me = useQuickyStore((s) => s.user)
  const peer = useGameChatStore((s) => s.activePeer)
  const conversationId = useGameChatStore((s) => s.activeConversationId)
  const messages = useGameChatStore((s) => s.messages)
  const hasMore = useGameChatStore((s) => s.hasMore)
  const loadingOlder = useGameChatStore((s) => s.loadingOlder)
  const peerLastReadAt = useGameChatStore((s) => s.peerLastReadAt)
  const replyTo = useGameChatStore((s) => s.replyTo)
  const closeGameChat = useQuickyStore((s) => s.closeGameChat)

  const meId = me?.id ?? ''
  const [draft, setDraft] = useState('')
  const [showTray, setShowTray] = useState(false)
  const [pickerFor, setPickerFor] = useState<string | null>(null) // messageId with open reaction picker
  const [unreadBelow, setUnreadBelow] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)
  const inputRef = useRef<HTMLInputElement>(null)
  const longPress = useRef<{ timer: ReturnType<typeof setTimeout> | null; x: number; y: number }>({ timer: null, x: 0, y: 0 })
  const lastMsgId = messages.length ? messages[messages.length - 1].id : null
  const prevLastIdRef = useRef<string | null>(null)

  // ── mark read when the screen is visible (§16) ───────────────────────────
  useEffect(() => {
    useGameChatStore.getState().markActiveRead()
  }, [conversationId])

  // ── scroll behavior (§79): near-bottom → autoscroll; scrolled up → pill ──
  const scrollToBottom = useCallback((smooth = false) => {
    const el = listRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    nearBottomRef.current = true
    setUnreadBelow(0)
  }, [])

  useEffect(() => {
    scrollToBottom(false)
  }, [conversationId, scrollToBottom])

  useEffect(() => {
    if (!lastMsgId) return
    if (prevLastIdRef.current === null) {
      prevLastIdRef.current = lastMsgId
      return
    }
    const isNew = prevLastIdRef.current !== lastMsgId
    prevLastIdRef.current = lastMsgId
    if (!isNew) return
    if (nearBottomRef.current) scrollToBottom(true)
    else setUnreadBelow((n) => n + 1)
  }, [lastMsgId, scrollToBottom])

  const onScroll = () => {
    const el = listRef.current
    if (!el) return
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - NEAR_BOTTOM_PX
    nearBottomRef.current = nearBottom
    if (nearBottom && unreadBelow > 0) setUnreadBelow(0)
    // §24: scrolled to the top → load older messages (cursor pagination)
    if (el.scrollTop <= 4 && hasMore && !loadingOlder) {
      const beforeH = el.scrollHeight
      void useGameChatStore.getState().loadOlder().then(() => {
        requestAnimationFrame(() => {
          if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight - beforeH
        })
      })
    }
  }

  // ── keyboard overlay (§80): composer rides above the keyboard ────────────
  const [kb, setKb] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const onVV = () => {
      const h = window.innerHeight - vv.height - vv.offsetTop
      setKb(Math.max(0, Math.min(h, window.innerHeight * 0.6)))
    }
    vv.addEventListener('resize', onVV)
    vv.addEventListener('scroll', onVV)
    return () => {
      vv.removeEventListener('resize', onVV)
      vv.removeEventListener('scroll', onVV)
    }
  }, [])

  // ── sticker tray data (§78) ───────────────────────────────────────────────
  const [bundles, setBundles] = useState<any[] | null>(null)
  const loadStickers = useCallback(() => {
    api.gameChat
      .stickers()
      .then((res) => setBundles(res.bundles ?? []))
      .catch(() => setBundles([]))
  }, [])
  useEffect(() => {
    if (showTray && bundles === null) loadStickers()
  }, [showTray, bundles, loadStickers])

  const send = () => {
    if (!draft.trim()) return
    useGameChatStore.getState().sendMessage(draft)
    setDraft('')
    inputRef.current?.focus()
  }

  const startLongPress = (messageId: string) => (e: React.PointerEvent) => {
    // §29: ~500ms threshold, cancelled when the finger moves significantly
    longPress.current = { x: e.clientX, y: e.clientY, timer: null }
    longPress.current.timer = setTimeout(() => {
      setPickerFor(messageId)
      if (navigator.vibrate) navigator.vibrate(12)
    }, 500)
  }
  const moveLongPress = (e: React.PointerEvent) => {
    const lp = longPress.current
    if (lp.timer && (Math.abs(e.clientX - lp.x) > 10 || Math.abs(e.clientY - lp.y) > 10)) {
      clearTimeout(lp.timer)
      lp.timer = null
    }
  }
  const endLongPress = () => {
    if (longPress.current.timer) {
      clearTimeout(longPress.current.timer)
      longPress.current.timer = null
    }
  }

  const react = (messageId: string, reaction: string) => {
    useGameChatStore.getState().toggleReaction(messageId, reaction)
    setPickerFor(null)
  }

  const peerReadDate = peerLastReadAt ? new Date(peerLastReadAt).getTime() : 0
  const lastMine = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].senderId === meId && !messages[i].failed) return messages[i]
    }
    return null
  }, [messages, meId])

  if (!peer) return null
  const peerName = peer.peerName ?? 'Player'

  return (
    <div className="w-full h-full flex flex-col bg-[var(--qk-bg)] text-white relative overflow-hidden">
      {/* ambient glow — decorative only, never swallows taps */}
      <div className="pointer-events-none absolute -top-24 -right-16 w-72 h-72 rounded-full bg-[var(--qk-purple)]/15 blur-3xl" aria-hidden />

      {/* ─── Header (§33): compact — back, avatar, name. No typing indicator. ── */}
      <header className="shrink-0 safe-area-top px-2 pt-2.5 pb-2 flex items-center gap-2 border-b border-white/10 bg-[var(--qk-bg)]/80 backdrop-blur relative z-20">
        <button
          onClick={() => {
            // §97: back returns to the context that opened the chat
            useGameChatStore.getState().closeConversation()
            closeGameChat()
          }}
          className="p-2 rounded-full hover:bg-white/10"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        {peer.peerAvatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={peer.peerAvatar} alt="" className="w-9 h-9 rounded-full object-cover" />
        ) : (
          <span className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-sm" aria-hidden>🎲</span>
        )}
        <div className="min-w-0">
          <p className="text-white font-bold text-sm leading-tight truncate">{peerName}</p>
          <p className="text-white/40 text-[11px] leading-tight">Game chat</p>
        </div>
      </header>

      {/* ─── Messages ────────────────────────────────────────────────────────── */}
      <div ref={listRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2 relative">
        {hasMore && (
          <div className="flex justify-center py-1">
            {loadingOlder ? (
              <span className="text-white/40 text-xs">Loading…</span>
            ) : (
              <button onClick={() => void useGameChatStore.getState().loadOlder()} className="text-[11px] font-semibold text-white/50 hover:text-white/80 px-3 py-1 rounded-full bg-white/5">
                Load earlier messages
              </button>
            )}
          </div>
        )}

        {messages.length === 0 && (
          // §95: no existing conversation — invite to say hello
          <div className="flex-1 flex flex-col items-center justify-center gap-1.5 py-16 text-center" data-testid="game-chat-empty">
            <span className="text-3xl" aria-hidden>👋</span>
            <p className="text-white font-semibold text-sm">No messages yet.</p>
            <p className="text-white/45 text-xs">Say hello to {peerName}</p>
          </div>
        )}

        {messages.map((m) => (
          <GameBubble
            key={m.id}
            m={m}
            mine={m.senderId === meId}
            isLastMine={lastMine?.id === m.id}
            read={peerReadDate >= new Date(m.createdAt).getTime()}
            onReply={() => useGameChatStore.getState().setReplyTo(m)}
            onReact={() => setPickerFor(m.id)}
            onRetry={() => m.clientMessageId && useGameChatStore.getState().retryMessage(m.clientMessageId)}
            onLongPressStart={startLongPress(m.id)}
            onLongPressMove={moveLongPress}
            onLongPressEnd={endLongPress}
          />
        ))}
      </div>

      {/* "New messages" pill (§79) */}
      <AnimatePresence>
        {unreadBelow > 0 && (
          <motion.button
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            onClick={() => scrollToBottom(true)}
            className="absolute bottom-24 left-1/2 -translate-x-1/2 z-20 px-4 py-1.5 rounded-full bg-coral-gradient text-xs font-bold shadow-lg"
          >
            {unreadBelow === 1 ? 'New message' : `${unreadBelow} new messages`} ↓
          </motion.button>
        )}
      </AnimatePresence>

      {/* ─── Reaction picker (§28) — same for web hover ⋯ → React (§30) ─────── */}
      <AnimatePresence>
        {pickerFor && (
          <>
            <div className="fixed inset-0 z-[60]" onClick={() => setPickerFor(null)} />
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.95 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-x-0 bottom-28 z-[61] mx-auto w-fit flex items-center gap-1 bg-[var(--qk-card)] border border-white/15 rounded-full px-3 py-2 shadow-2xl"
              role="menu"
              aria-label="React"
            >
              {REACTIONS.map((r) => (
                <button
                  key={r}
                  onClick={() => react(pickerFor, r)}
                  className="text-2xl p-1 rounded-full hover:bg-white/10 active:scale-90 transition-transform"
                  aria-label={`React ${r}`}
                >
                  {r}
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ─── Reply preview + cancel (§25/§26) ────────────────────────────────── */}
      <AnimatePresence>
        {replyTo && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="shrink-0 overflow-hidden border-t border-white/10 bg-white/5"
          >
            <div className="px-3 py-2 flex items-start gap-2">
              <div className="min-w-0 flex-1 border-l-2 border-[var(--qk-accent)] pl-2">
                <p className="text-[11px] font-bold text-[var(--qk-accent)]">
                  Replying to {replyTo.senderId === meId ? 'yourself' : peerName}
                </p>
                <p className="text-xs text-white/60 truncate">
                  {replyTo.messageType === 'sticker' ? '🎁 Sticker' : replyTo.text}
                </p>
              </div>
              <button onClick={() => useGameChatStore.getState().setReplyTo(null)} className="p-1.5 rounded-full hover:bg-white/10" aria-label="Cancel reply">
                <X className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Sticker tray (§62/§76/§78) ──────────────────────────────────────── */}
      <AnimatePresence>
        {showTray && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="shrink-0 overflow-hidden border-t border-white/10 bg-[var(--qk-card)]/95"
          >
            <div className="px-3 py-2.5 max-h-52 overflow-y-auto flex flex-col gap-2">
              {(bundles ?? []).map((b) => (
                <div key={b.id}>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-bold text-white/80">
                      {b.icon} {b.name}
                      {b.season ? <span className="text-white/35 font-normal"> · {b.season}</span> : null}
                    </p>
                    {b.owned ? (
                      <span className="text-[10px] font-bold text-emerald-300/90">OWNED</span>
                    ) : (
                      <button
                        onClick={async () => {
                          try {
                            const res = await api.gameChat.stickerAction('purchase', b.id)
                            if (res?.ok) {
                              toast.success(`Unlocked ${b.name}!`)
                              loadStickers()
                            }
                          } catch (e: any) {
                            if (e?.body?.error === 'insufficient_coins') toast.error('Not enough coins')
                            else toast.error(e?.message ?? 'Purchase failed')
                          }
                        }}
                        className="text-[10px] font-black px-2 py-1 rounded-full bg-coral-gradient"
                      >
                        🪙 {b.priceCoins}
                      </button>
                    )}
                  </div>
                  {b.owned && (
                    <div className="flex flex-wrap gap-1.5">
                      {b.stickers.map((s: any) => (
                        <button
                          key={s.id}
                          onClick={() => {
                            useGameChatStore.getState().sendSticker({ id: s.id, name: s.name, assetUrl: s.assetUrl })
                            setShowTray(false)
                          }}
                          className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 active:scale-95 transition"
                          aria-label={`Send ${s.name}`}
                        >
                          <StickerAsset sticker={s} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {bundles !== null && bundles.length === 0 && (
                <p className="text-white/40 text-xs py-3 text-center">No sticker bundles yet — coming soon.</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Composer (§78): [ + ] [ Message… ] [ ➤ ] ────────────────────────── */}
      <div
        className="shrink-0 border-t border-white/10 bg-[var(--qk-bg)]/95 backdrop-blur px-2.5 py-2 flex items-center gap-2"
        style={{ marginBottom: kb > 0 ? kb : 0 }}
      >
        <button
          onClick={() => setShowTray((v) => !v)}
          className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 border ${showTray ? 'bg-white/15 border-white/20' : 'bg-white/5 border-white/10'} hover:bg-white/10`}
          aria-label="Stickers"
        >
          <Plus className={`h-4 w-4 transition-transform ${showTray ? 'rotate-45' : ''}`} />
        </button>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder="Message…"
          maxLength={2000}
          className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-full px-4 py-2.5 text-sm text-white placeholder:text-white/35 outline-none focus:border-white/25"
          aria-label="Message"
        />
        <button
          onClick={send}
          disabled={!draft.trim()}
          className="w-9 h-9 rounded-full bg-coral-gradient flex items-center justify-center shrink-0 disabled:opacity-40 active:scale-95 transition"
          aria-label="Send"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

/* ─── One message bubble: reply ref (§27), reactions (§31), receipts (§17),
       optimistic pending/failed (§22), swipe-to-reply (§25), hover ⋯ (§30) */
function GameBubble({
  m,
  mine,
  isLastMine,
  read,
  onReply,
  onReact,
  onRetry,
  onLongPressStart,
  onLongPressMove,
  onLongPressEnd,
}: {
  m: GameChatMessage
  mine: boolean
  isLastMine: boolean
  read: boolean
  onReply: () => void
  onReact: () => void
  onRetry: () => void
  onLongPressStart: (e: React.PointerEvent) => void
  onLongPressMove: (e: React.PointerEvent) => void
  onLongPressEnd: () => void
}) {
  const reactionRow = m.reactions.filter((r) => r.userIds.length > 0)
  return (
    <motion.div
      drag="x"
      dragConstraints={{ left: 0, right: 72 }}
      dragElastic={0.14}
      dragSnapToOrigin
      onDragEnd={(_, info) => {
        // §25: swipe right past the threshold → reply mode
        if (info.offset.x > 56) onReply()
      }}
      className={`flex flex-col ${mine ? 'items-end' : 'items-start'} touch-pan-y`}
    >
      <div className={`flex items-end gap-1.5 max-w-[85%] group ${mine ? 'flex-row-reverse' : ''}`}>
        {m.messageType === 'sticker' && !m.text ? (
          <div
            onPointerDown={onLongPressStart}
            onPointerMove={onLongPressMove}
            onPointerUp={onLongPressEnd}
            onPointerLeave={onLongPressEnd}
            className={`px-1.5 py-1 ${m.pending ? 'opacity-60' : ''} ${m.failed ? 'opacity-80' : ''}`}
          >
            {m.sticker ? <StickerAsset sticker={m.sticker} /> : <span className="text-5xl">🎁</span>}
          </div>
        ) : (
          <div
            onPointerDown={onLongPressStart}
            onPointerMove={onLongPressMove}
            onPointerUp={onLongPressEnd}
            onPointerLeave={onLongPressEnd}
            className={`relative rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
              mine ? 'bg-coral-gradient text-white rounded-br-md' : 'bg-white/8 border border-white/10 text-white/90 rounded-bl-md'
            } ${m.pending ? 'opacity-60' : ''}`}
          >
            {/* §27: compact reply reference above the reply */}
            {m.replyTo && (
              <div className={`mb-1.5 border-l-2 pl-2 py-0.5 ${mine ? 'border-white/60' : 'border-[var(--qk-accent)]'}`}>
                <p className="text-[10px] font-bold opacity-80">{m.replyTo.senderName ?? 'Message'}</p>
                <p className="text-[11px] opacity-70 line-clamp-2">
                  {m.replyTo.messageType === 'sticker' ? '🎁 Sticker' : m.replyTo.text}
                </p>
              </div>
            )}
            <p className="whitespace-pre-wrap break-words">{m.text}</p>
          </div>
        )}

        {/* ⋯ actions — hover on web (§30); always reachable as the
            non-gesture equivalent of swipe/long-press (§124) */}
        <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 max-md:opacity-60 transition-opacity">
          <button onClick={onReply} className="w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-[11px]" aria-label="Reply">
            ↩
          </button>
          <button onClick={onReact} className="w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-[11px]" aria-label="React">
            ☺
          </button>
        </div>
      </div>

      {/* reactions row (§31/§32) */}
      {reactionRow.length > 0 && (
        <div className={`flex gap-1 -mt-1 ${mine ? 'mr-2' : 'ml-2'}`}>
          {reactionRow.map((r) => (
            <button
              key={r.reaction}
              onClick={() => useGameChatStore.getState().toggleReaction(m.id, r.reaction)}
              className="px-1.5 py-0.5 rounded-full bg-white/10 border border-white/10 text-[11px] flex items-center gap-0.5"
              aria-label={`Reaction ${r.reaction} (${r.userIds.length})`}
            >
              {r.reaction}
              {r.userIds.length > 1 && <span className="text-[9px] text-white/60">{r.userIds.length}</span>}
            </button>
          ))}
        </div>
      )}

      {/* receipt / failure state (§17/§22) */}
      {mine && (
        <div className="text-[10px] mt-0.5 mr-1 flex items-center gap-1">
          {m.failed ? (
            <button onClick={onRetry} className="text-rose-300 font-bold underline underline-offset-2" aria-label="Retry send">
              Failed — tap to retry
            </button>
          ) : m.pending ? (
            <span className="text-white/35">Sending…</span>
          ) : isLastMine ? (
            <span className="text-white/40">{read ? '✓✓ Read' : '✓ Sent'}</span>
          ) : null}
        </div>
      )}
    </motion.div>
  )
}
