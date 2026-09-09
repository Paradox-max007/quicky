'use client'

import { useEffect, useRef, useState } from 'react'
import { Send, Reply, X } from 'lucide-react'
import { Capacitor } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'

// RoomChatPanel — social-game style room chat.
// Features:
//   - Supabase Realtime instant messaging
//   - Swipe-to-reply on every message bubble (pointer + touch with direction locking)
//   - Sender name always on top line of every bubble, message on next line
//   - Keyboard overlay: composer row pops on top of the table when keyboard is up,
//     and returns to original position when sent or dismissed
//   - Reply context quote banner with cancel button

export type RoomMessage = {
  id: string
  userId: string
  text: string
  kind: string
  createdAt: string
  replyTo?: { id: string; name: string; text: string } | null
}

export type ChatPlayer = { userId: string; displayName: string; avatar: string | null }

const NAME_COLORS = ['#f23d7f', '#2f7cf6', '#9b3df0', '#12945d', '#f2801f', '#e02c1c']

function nameColor(userId: string): string {
  let h = 0
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0
  return NAME_COLORS[h % NAME_COLORS.length]
}

const EMOJIS = ['😄', '😂', '🥰', '😍', '🤔', '😅', '🙌', '👏', '🔥', '💔', '💋', '🍾', '🎉', '👀', '😎', '🤩', '😇', '🤣']

// ─── Swipeable bubble wrapper with visual badge & direction lock ───────────────
function SwipeableBubble({
  onReply,
  children,
}: {
  onReply: () => void
  children: React.ReactNode
}) {
  const [offset, setOffset] = useState(0)
  const startX = useRef(0)
  const startY = useRef(0)
  const isDragging = useRef(false)
  const directionLocked = useRef<'x' | 'y' | null>(null)

  const handlePointerDown = (e: React.PointerEvent) => {
    startX.current = e.clientX
    startY.current = e.clientY
    isDragging.current = true
    directionLocked.current = null
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging.current) return
    const currentDx = e.clientX - startX.current
    const currentDy = e.clientY - startY.current

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

  return (
    <div className={`sbr-chat${kbOpen ? ' sbr-kb-open' : ''}`}>
      <div ref={scrollRef} className="sbr-chat-scroll no-scrollbar">
        {messages.length === 0 ? (
          <div className="sbr-chat-empty">
            <span style={{ fontSize: 26 }}>👋</span>
            <span>No messages yet — break the ice!</span>
          </div>
        ) : (
          messages.map((m) => {
            if (m.kind === 'system') {
              return (
                <div key={m.id} className="sbr-msg-system">
                  {m.text}
                </div>
              )
            }
            if (m.kind === 'gift') {
              return (
                <div key={m.id} className="sbr-msg">
                  <GiftAvatar player={playerFor(m.userId)} />
                  <div className="sbr-msg-body sbr-msg-gift">
                    <span className="sbr-msg-gift-emoji" aria-hidden>🎁</span>
                    <div>
                      {/* Line 1: Sender name */}
                      <p className="sbr-msg-name" style={{ color: nameColor(m.userId) }}>
                        {m.userId === meId ? 'You' : playerFor(m.userId)?.displayName ?? 'Someone'}
                      </p>
                      {/* Line 2: Message */}
                      <p className="sbr-msg-text">{m.text}</p>
                    </div>
                  </div>
                </div>
              )
            }

            const isMe = m.userId === meId
            const p = playerFor(m.userId)
            const displayName = isMe ? 'You' : (p?.displayName ?? 'Guest')

            return (
              <SwipeableBubble key={m.id} onReply={() => startReply(m)}>
                <div className={`sbr-msg${isMe ? ' me' : ''}`}>
                  <GiftAvatar player={p} me={isMe} />
                  <div className="sbr-msg-body">
                    {/* Line 1: Sender name — on top */}
                    <p
                      className="sbr-msg-name"
                      style={{ color: isMe ? 'var(--qk-accent, #ff2d55)' : nameColor(m.userId) }}
                    >
                      {displayName}
                    </p>
                    {/* Quoted reply reference if replying to someone */}
                    {m.replyTo && (
                      <div className="sbr-msg-reply-ref">
                        <span className="sbr-msg-reply-name">{m.replyTo.name}</span>
                        <span className="sbr-msg-reply-text">{m.replyTo.text}</span>
                      </div>
                    )}
                    {/* Line 2: The message — on the next line */}
                    <p className="sbr-msg-text">{m.text}</p>
                  </div>
                </div>
              </SwipeableBubble>
            )
          })
        )}
      </div>

      {/* Placeholder in normal flex flow when composer pops on top */}
      {kbOpen && <div className="sbr-composer-placeholder" />}

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
        <button
          className="sbr-comp-btn"
          onClick={() => setEmojiOpen((v) => !v)}
          aria-label="Emoji"
        >
          😊
        </button>
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
        <button className="sbr-comp-btn" aria-label="Send a gift" title="Gifts coming soon">
          🎁
        </button>
        <button className="sbr-send" onClick={send} disabled={!text.trim() || sending} aria-label="Send">
          <Send size={17} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  )
}

function GiftAvatar({ player, me = false }: { player?: ChatPlayer; me?: boolean }) {
  const initial = me ? 'Y' : (player?.displayName ?? '?').trim().slice(0, 1).toUpperCase()
  if (player?.avatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img className="sbr-msg-avatar" src={player.avatar} alt="" draggable={false} />
    )
  }
  return <span className="sbr-msg-avatar">{initial}</span>
}
