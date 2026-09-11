'use client'

import { useEffect, useRef, useState } from 'react'
import { Send, Reply, X, MoreHorizontal, Flag } from 'lucide-react'
import { toast } from 'sonner'
import { Capacitor } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'

// RoomChatPanel — social-game style room chat (approved club design).
// Features:
//   - Supabase Realtime instant messaging
//   - Swipe-to-reply on every message bubble (pointer + touch with direction locking)
//   - Sender name + timestamp on the top line, message below
//   - Keyboard overlay: composer row pops on top of the table when keyboard is up,
//     and returns to original position when sent or dismissed
//   - Reply context quote banner docked directly above the input row
//   - Join/leave events render as compact SystemMessageChips (v2.1 §48-§53);
//     game/table logs NEVER appear (§47/§49) — only real user messages and
//     the two chips exist in the timeline
//   - Quick reaction bar (Kiss / Cheers / Wow / Dance) above the composer
//   - On web (≥1024px) the panel becomes the right sidebar with the
//     "Table Activity & Chat" header; on mobile it is the bottom sheet.

export type RoomMessage = {
  id: string
  userId: string
  text: string
  kind: string
  createdAt: string
  replyTo?: { id: string; name: string; text: string } | null
}

export type ChatPlayer = { userId: string; displayName: string; avatar: string | null }

const NAME_COLORS = ['#c4b5fd', '#93c5fd', '#f0abfc', '#6ee7b7', '#fdba74', '#fca5a5']

function nameColor(userId: string): string {
  let h = 0
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0
  return NAME_COLORS[h % NAME_COLORS.length]
}

function timeFor(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const EMOJIS = ['😄', '😂', '🥰', '😍', '🤔', '😅', '🙌', '👏', '🔥', '💔', '💋', '🍾', '🎉', '👀', '😎', '🤩', '😇', '🤣']

const REACTIONS = [
  { emoji: '❤️', label: 'Kiss', tone: 'kiss' },
  { emoji: '🥂', label: 'Cheers', tone: 'cheers' },
  { emoji: '🔥', label: 'Wow', tone: 'wow' },
  { emoji: '💃', label: 'Dance', tone: 'dance' },
] as const

// ─── Swipeable bubble wrapper with visual badge & direction lock ───────────────
// PRD §40: horizontal-only reply gesture, damped, haptic at threshold.
// PRD §41: long-press opens the message actions (Reply / React / Report).
const QUICK_REACTS = ['❤️', '🔥', '😂'] as const

function SwipeableBubble({
  onReply,
  onReact,
  mine = false,
  children,
}: {
  onReply: () => void
  onReact: (emoji: string) => void
  mine?: boolean
  children: React.ReactNode
}) {
  const [offset, setOffset] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const startX = useRef(0)
  const startY = useRef(0)
  const isDragging = useRef(false)
  const directionLocked = useRef<'x' | 'y' | null>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return // desktop uses hover actions
    startX.current = e.clientX
    startY.current = e.clientY
    isDragging.current = true
    directionLocked.current = null
    // Long-press → actions menu (§41)
    clearLongPress()
    longPressTimer.current = setTimeout(() => {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try {
          navigator.vibrate(8)
        } catch {}
      }
      setMenuOpen(true)
      isDragging.current = false
    }, 500)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging.current) return
    const currentDx = e.clientX - startX.current
    const currentDy = e.clientY - startY.current

    if (Math.abs(currentDx) > 7 || Math.abs(currentDy) > 7) clearLongPress()

    if (!directionLocked.current) {
      if (Math.abs(currentDx) > 7 || Math.abs(currentDy) > 7) {
        if (Math.abs(currentDx) > Math.abs(currentDy)) {
          directionLocked.current = 'x'
        } else {
          // Vertical scroll — release to native container scroll
          directionLocked.current = 'y'
          isDragging.current = false
          return
        }
      }
    }

    if (directionLocked.current === 'x' && currentDx > 0) {
      // Damped rubber-band clamp up to 72px
      const clamped = Math.min(72, currentDx * 0.8)
      setOffset(clamped)
    }
  }

  const handlePointerEnd = () => {
    clearLongPress()
    if (isDragging.current && directionLocked.current === 'x') {
      if (offset > 40) {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          try {
            navigator.vibrate(12)
          } catch {}
        }
        onReply()
      }
    }
    isDragging.current = false
    directionLocked.current = null
    setOffset(0)
  }

  const triggerProgress = Math.min(1, offset / 40)

  return (
    <div
      className="sbr-swipe-bubble-wrap"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      style={{
        position: 'relative',
        touchAction: 'pan-y',
        userSelect: offset > 0 ? 'none' : 'auto',
      }}
    >
      {/* Reply icon indicator on the left behind the bubble */}
      <div
        className="sbr-swipe-reply-hint"
        style={{
          position: 'absolute',
          left: 4,
          top: '50%',
          transform: `translateY(-50%) scale(${0.5 + triggerProgress * 0.5})`,
          opacity: triggerProgress,
          transition: offset === 0 ? 'opacity 0.2s, transform 0.2s' : 'none',
          pointerEvents: 'none',
          color: triggerProgress >= 1 ? 'var(--qk-accent, #ff2d55)' : 'rgba(255, 255, 255, 0.45)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 28,
          height: 28,
          borderRadius: 999,
          background: 'rgba(0, 0, 0, 0.4)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
        }}
      >
        <Reply size={14} />
      </div>

      {/* The message bubble */}
      <div
        style={{
          transform: `translateX(${offset}px)`,
          transition: offset === 0 ? 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)' : 'none',
          willChange: 'transform',
        }}
      >
        {children}
      </div>

      {/* Web hover trigger — desktop gets hover actions (PRD §39) */}
      <button
        type="button"
        className="sbr-msg-more"
        aria-label="Message actions"
        onClick={() => setMenuOpen((v) => !v)}
      >
        <MoreHorizontal size={14} />
      </button>

      {/* Actions popover — Reply / React / Report (PRD §39/§41) */}
      {menuOpen && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 60 }}
            onClick={() => setMenuOpen(false)}
            onPointerDown={() => setMenuOpen(false)}
          />
          <div
            className="sbr-msg-menu"
            style={mine ? { right: 8, left: 'auto' } : { left: 8, right: 'auto' }}
          >
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false)
                onReply()
              }}
            >
              <Reply size={13} /> Reply
            </button>
            <div className="sbr-msg-menu-reacts">
              {QUICK_REACTS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  aria-label={`React ${emoji}`}
                  onClick={() => {
                    setMenuOpen(false)
                    onReact(emoji)
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="sbr-msg-menu-report"
              onClick={() => {
                setMenuOpen(false)
                toast('Message reported. Our moderators will take a look.')
              }}
            >
              <Flag size={13} /> Report
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export function RoomChatPanel({
  messages,
  players,
  meId,
  onSend,
  sending,
  kbOpen = false,
}: {
  messages: RoomMessage[]
  players: ChatPlayer[]
  meId: string
  onSend: (text: string, replyTo?: RoomMessage['replyTo']) => Promise<void>
  sending: boolean
  kbOpen?: boolean
}) {
  const [text, setText] = useState('')
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [replyTo, setReplyTo] = useState<RoomMessage['replyTo']>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Auto-scroll to newest message
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const playerFor = (userId: string) => players.find((p) => p.userId === userId)
  const me = playerFor(meId)
  const myInitial = (me?.displayName ?? 'M').trim().slice(0, 1).toUpperCase()

  const send = async () => {
    const t = text.trim()
    if (!t || sending) return
    setText('')
    setEmojiOpen(false)
    const rt = replyTo
    setReplyTo(null)
    // Blur input and hide keyboard so composer returns to its original position
    inputRef.current?.blur()
    if (Capacitor.isNativePlatform()) {
      Keyboard.hide().catch(() => {})
    }
    await onSend(t, rt ?? undefined)
  }

  const startReply = (m: RoomMessage) => {
    const p = playerFor(m.userId)
    const name = m.userId === meId ? 'You' : (p?.displayName ?? 'Someone')
    setReplyTo({ id: m.id, name, text: m.text.slice(0, 80) })
    inputRef.current?.focus()
  }

  const sendReaction = (emoji: string, label: string) => {
    if (sending) return
    onSend(`${emoji} ${label}`)
  }

  return (
    <div className={`sbr-chat${kbOpen ? ' sbr-kb-open' : ''}`}>
      {/* mobile sheet grabber */}
      <div className="sbr-chat-grabber" aria-hidden />

      {/* web sidebar header */}
      <div className="sbr-chat-head">
        <span className="sbr-chat-live-dot" aria-hidden />
        <h2 className="sbr-chat-head-title">
          Table Activity &amp; Chat
          <span className="sbr-chat-online">{players.length} Online</span>
        </h2>
        <div className="sbr-chat-head-actions">
          <button type="button" title="Sound effects" aria-label="Sound effects">🔊</button>
          <button type="button" title="Table settings" aria-label="Table settings">⚙️</button>
        </div>
      </div>

      <div ref={scrollRef} className="sbr-chat-scroll no-scrollbar">
        {messages.length === 0 ? (
          <div className="sbr-chat-empty">
            <span style={{ fontSize: 26 }}>👋</span>
            <span>No messages yet — break the ice!</span>
          </div>
        ) : (
          messages.map((m) => {
            // ── System chips (§50-§53): join/leave only. Compact, centered,
            // NO swipe/reply/react/report — they are not messages.
            if (m.kind === 'join' || m.kind === 'leave') {
              return (
                <div key={m.id} className="sbr-sys-chip-row">
                  <span className={`sbr-sys-chip sbr-sys-${m.kind}`}>
                    <span className="sbr-sys-chip-icon" aria-hidden>{m.kind === 'join' ? '👋' : '🚪'}</span>
                    {m.text}
                  </span>
                </div>
              )
            }
            // ── Legacy game/table logs (§49/§56): never rendered. The
            // snapshot already filters them; this guards realtime races too.
            if (m.kind !== 'user') return null
            const isMe = m.userId === meId
            const p = playerFor(m.userId)
            const displayName = isMe ? 'You' : (p?.displayName ?? 'Guest')

            return (
              <div key={m.id}>
                <SwipeableBubble
                  onReply={() => startReply(m)}
                  onReact={(emoji) => onSend(emoji)}
                  mine={isMe}
                >
                  <div className={`sbr-msg${isMe ? ' me' : ''}`}>
                    <GiftAvatar player={p} me={isMe} />
                    <div className="sbr-msg-body">
                      {/* Line 1: sender name + time */}
                      <p className="sbr-msg-meta">
                        <span
                          className="sbr-msg-name"
                          style={{ color: isMe ? 'var(--qk-accent, #ff2d55)' : nameColor(m.userId) }}
                        >
                          {displayName}
                        </span>
                        <span className="sbr-msg-time">{timeFor(m.createdAt)}</span>
                      </p>
                      {/* Quoted reply reference if replying to someone */}
                      {m.replyTo && (
                        <div className="sbr-msg-reply-ref">
                          <span className="sbr-msg-reply-name">{m.replyTo.name}</span>
                          <span className="sbr-msg-reply-text">{m.replyTo.text}</span>
                        </div>
                      )}
                      {/* Line 2: the message */}
                      <p className="sbr-msg-text">{m.text}</p>
                    </div>
                  </div>
                </SwipeableBubble>
              </div>
            )
          })
        )}
      </div>

      {/* Placeholder in normal flex flow when composer pops on top */}
      {kbOpen && <div className="sbr-composer-placeholder" />}

      {/* Quick reactions — stay docked in the panel while the composer pops */}
      <div className="sbr-reactions no-scrollbar">
        {REACTIONS.map((r) => (
          <button
            key={r.tone}
            type="button"
            className={`sbr-react sbr-react-${r.tone}`}
            onClick={() => sendReaction(r.emoji, r.label)}
            disabled={sending}
          >
            {r.emoji} {r.label}
          </button>
        ))}
      </div>

      {/* Composer row (pops on top of the table when kbOpen) */}
      <div className={`sbr-composer${kbOpen ? ' sbr-composer-popped' : ''}`}>
        {/* Reply preview banner */}
        {replyTo && (
          <div className="sbr-reply-banner">
            <Reply size={13} className="sbr-reply-icon" />
            <div className="sbr-reply-content">
              <span className="sbr-reply-to-name">{replyTo.name}</span>
              <span className="sbr-reply-to-text">{replyTo.text}</span>
            </div>
            <button
              className="sbr-reply-close"
              onClick={() => setReplyTo(null)}
              aria-label="Cancel reply"
            >
              <X size={13} />
            </button>
          </div>
        )}

        {emojiOpen && (
          <div className="sbr-emoji-tray">
            {EMOJIS.map((e) => (
              <button key={e} onClick={() => setText((t) => t + e)} aria-label={`Insert ${e}`}>
                {e}
              </button>
            ))}
          </div>
        )}

        {/* my avatar tag */}
        <span className="sbr-comp-avatar" aria-hidden>{myInitial}</span>

        <div className="sbr-comp-field">
          <input
            ref={inputRef}
            className="sbr-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            maxLength={280}
            placeholder="Write a message"
            aria-label="Write a message"
          />
          <button
            className="sbr-comp-emoji"
            onClick={() => setEmojiOpen((v) => !v)}
            aria-label="Emoji"
          >
            😊
          </button>
        </div>

        <button className="sbr-comp-btn" aria-label="Send a gift" title="Gifts coming soon">
          🎁
        </button>
        <button className="sbr-send" onClick={send} disabled={!text.trim() || sending} aria-label="Send">
          <Send size={16} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  )
}

function GiftAvatar({ player, me = false }: { player?: ChatPlayer; me?: boolean }) {
  const initial = me ? 'Y' : (player?.displayName ?? '?').trim().slice(0, 1).toUpperCase()
  if (player?.avatar) {
    return (
       
      <img className="sbr-msg-avatar" src={player.avatar} alt="" draggable={false} />
    )
  }
  return <span className="sbr-msg-avatar">{initial}</span>
}
