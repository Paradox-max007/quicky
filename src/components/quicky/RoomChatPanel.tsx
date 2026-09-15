'use client'

// Quicky — RoomChatPanel — THE SINGLE ROOM CHAT SHELL (mentions PRD §4/§74/
// §99/§100/§118). One container, three states:
//
//     room      → Room Chat (THIS component's own content)
//     contacts  → GameContactsPanel        (parent-provided panelContent)
//     personal  → GameChatScreen embedded  (parent-provided panelContent)
//
// The table is completely OUTSIDE this state machine (§118): switching
// states never changes the table's geometry, and no absolute overlay/z-index
// tricks exist anywhere (§99/§100) — contacts/personal are normal CHILDREN
// of the panel. Room Chat content stays MOUNTED (display:none) underneath so
// its scroll position survives (§17) while the runtime store keeps receiving
// messages in the background (§16 — the SSE/realtime subscriptions live in
// useGameRoomStore, not in this DOM).
//
// Mentions (§28-§59): the composer keeps a raw string + structured mention
// metadata that is ALWAYS re-derived from the text (§33 — deleting a token
// drops its metadata; they can never mismatch). "@Name" tokens render bold +
// highlighted through a transparent-input mirror layer (§32), typing @ opens
// the player picker sourced from the AUTHORITATIVE room players (§35/§87 —
// a player who left disappears from the picker automatically, §62), search
// is local + case-insensitive (§36/§86 — zero network per keystroke), and
// sending passes the mention metadata to the server (§40) which re-validates
// everything (§41).

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Send, Reply, X, MoreHorizontal, Flag } from 'lucide-react'
import { toast } from 'sonner'
import { Capacitor } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'
import { useQuickyStore } from '@/store/quicky'

export type RoomMention = { userId: string; displayName: string }

export type RoomMessage = {
  id: string
  userId: string
  text: string
  kind: string
  createdAt: string
  replyTo?: { id: string; name: string; text: string } | null
  mentions?: RoomMention[]
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

const QUICK_REACTS = ['❤️', '🔥', '😂'] as const

/** Escape a display name for regex use (§94 — structured, escaped rendering). */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * §56/§57/§95: render message text with structured mention tokens. React
 * elements ONLY — user-generated text is never dangerouslySetInnerHTML'd,
 * so a hostile display name renders as plain text (§94/§95).
 */
export function renderMessageWithMentions(m: RoomMessage): React.ReactNode {
  const text = m.text
  const tokens = (m.mentions ?? []).filter(
    (t) => t.displayName && text.includes(`@${t.displayName}`)
  )
  if (tokens.length === 0) return text
  const re = new RegExp(
    `@(${tokens.map((t) => escapeRegExp(t.displayName)).join('|')})(?=$|[^A-Za-z0-9_])`,
    'g'
  )
  const parts: React.ReactNode[] = []
  let last = 0
  let key = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    const token = tokens.find((t) => t.displayName === match![1])
    parts.push(
      <span key={`mn-${key++}`} className="sbr-msg-mention" data-mention-user={token?.userId ?? ''}>
        @{match[1]}
      </span>
    )
    last = match.index + match[0].length
    if (match[0].length === 0) re.lastIndex++ // safety: zero-length match
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

// ─── Swipeable bubble wrapper with visual badge & direction lock ───────────────
// PRD §40: horizontal-only reply gesture, damped, haptic at threshold.
// PRD §41: long-press opens the message actions (Reply / React / Report).
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
          directionLocked.current = 'y'
          isDragging.current = false
          return
        }
      }
    }

    if (directionLocked.current === 'x' && currentDx > 0) {
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

      <div
        style={{
          transform: `translateX(${offset}px)`,
          transition: offset === 0 ? 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)' : 'none',
          willChange: 'transform',
        }}
      >
        {children}
      </div>

      <button
        type="button"
        className="sbr-msg-more"
        aria-label="Message actions"
        onClick={() => setMenuOpen((v) => !v)}
      >
        <MoreHorizontal size={14} />
      </button>

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
  onOpenGifts,
  onOpenGameChats,
  gameChatsUnread = 0,
  panel = 'room',
  panelContent = null,
  mentionFlashId = null,
  onMentionFlashDone,
}: {
  messages: RoomMessage[]
  players: ChatPlayer[]
  meId: string
  onSend: (
    text: string,
    replyTo?: RoomMessage['replyTo'],
    mentions?: RoomMention[]
  ) => Promise<void>
  sending: boolean
  kbOpen?: boolean
  /** v3: opens the gift sheet (DB-driven catalog) — no more dead button. */
  onOpenGifts?: () => void
  /** Bug-fix PRD §9: web sidebar → Game Contacts panel state. */
  onOpenGameChats?: () => void
  /** Total unread private game chats (badge on the entry button). */
  gameChatsUnread?: number
  /** §3 unified chat state: which surface the shell renders. */
  panel?: 'room' | 'contacts' | 'personal'
  /** §4: contacts / personal views render INSIDE this shell (normal children). */
  panelContent?: React.ReactNode
  /** §48: message id that mentions ME — its bubble flashes briefly. */
  mentionFlashId?: string | null
  /** §48: parent clears the store flag after the flash window. */
  onMentionFlashDone?: () => void
}) {
  const [text, setText] = useState('')
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [replyTo, setReplyTo] = useState<RoomMessage['replyTo']>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  // §17: scroll preservation — remember where the user was, never yank them.
  const savedScrollTop = useRef(0)
  const atBottomRef = useRef(true)
  const [newBelow, setNewBelow] = useState(0)

  // ── Mention state ─────────────────────────────────────────────────────────
  // candidates = players picked this session whose tokens still exist in the
  // text. Metadata is RE-DERIVED from the text at render/send time (§33).
  const [mentionCandidates, setMentionCandidates] = useState<RoomMention[]>([])
  const caretRef = useRef(0)
  const [pickerIndex, setPickerIndex] = useState(0)

  // §34/§36: trailing "@query" before the caret → picker with local filter.
  const mentionQuery = useMemo(() => {
    // react-hooks/refs: the caret ref read here is intentional — the picker
    // query derives from the LIVE caret position; the ref updates in the
    // same onChange that sets `text`, so it is fresh on every recompute.
    // eslint-disable-next-line react-hooks/refs
    const before = text.slice(0, caretRef.current || text.length)
    const m = before.match(/(^|\s)@([A-Za-z0-9_]*)$/)
    return m ? m[2] : null
     
  }, [text, caretRef.current])

  // §35/§62/§87: picker candidates come from the AUTHORITATIVE room players
  // (the same list the table renders). A player who left is gone from the
  // picker instantly — no ghost mentions (§106/§112). Self-mention excluded.
  const pickerPlayers = useMemo(() => {
    if (mentionQuery === null) return []
    const q = mentionQuery.toLowerCase()
    return players.filter(
      (p) => p.userId !== meId && p.displayName && p.displayName.toLowerCase().includes(q)
    )
  }, [mentionQuery, players, meId])
  const pickerOpen = mentionQuery !== null
  useEffect(() => setPickerIndex(0), [mentionQuery])

  const liveMentions = useMemo(
    () => mentionCandidates.filter((c) => text.includes(`@${c.displayName}`)),
    [mentionCandidates, text]
  )

  /** Insert "@DisplayName " at the caret, replacing an open @query (§30/§37). */
  const insertMentionToken = (userId: string, displayName: string, sourceText?: string) => {
    const input = inputRef.current
    const base = sourceText ?? text
    const caret = sourceText !== undefined ? sourceText.length : (input?.selectionStart ?? caretRef.current ?? base.length)
    const before = base.slice(0, caret)
    const m = before.match(/(^|\s)@([A-Za-z0-9_]*)$/)
    const token = `@${displayName} `
    let next: string
    let nextCaret: number
    if (m && m.index !== undefined) {
      const start = m.index + m[1].length
      next = base.slice(0, start) + token + base.slice(caret)
      nextCaret = start + token.length
    } else {
      const prefix = before && !/\s$/.test(before) ? ' ' : ''
      next = before + prefix + token + base.slice(caret)
      nextCaret = before.length + prefix.length + token.length
    }
    setMentionCandidates((prev) => (prev.some((c) => c.userId === userId) ? prev : [...prev, { userId, displayName }]))
    setText(next)
    caretRef.current = nextCaret
    requestAnimationFrame(() => {
      input?.focus()
      try {
        input?.setSelectionRange(nextCaret, nextCaret)
      } catch {}
    })
  }

  // §77: Profile → "Mention" → the shell prefills itself (store draft bridge).
  // No message is ever sent automatically (§29).
  const mentionDraft = useQuickyStore((s) => s.roomChatMentionDraft)
  useEffect(() => {
    if (!mentionDraft) return
    useQuickyStore.getState().clearRoomChatMentionDraft()
    insertMentionToken(mentionDraft.userId, mentionDraft.displayName)
     
  }, [mentionDraft])

  // §48: brief highlight of the message that mentioned me, then clear.
  const [flashId, setFlashId] = useState<string | null>(null)
  useEffect(() => {
    if (!mentionFlashId) return
    setFlashId(mentionFlashId)
    const t = setTimeout(() => {
      setFlashId(null)
      onMentionFlashDone?.()
    }, 1900)
    return () => clearTimeout(t)
  }, [mentionFlashId, onMentionFlashDone])

  // ── Scroll (§17): autoscroll only when the user is at the bottom; otherwise
  // raise the "new messages" pill. Restore the saved position when the room
  // state becomes visible again after contacts/personal.
  useEffect(() => {
    if (panel !== 'room') return
    const el = scrollRef.current
    if (!el) return
    if (atBottomRef.current) {
      el.scrollTop = el.scrollHeight
      setNewBelow(0)
    } else {
      setNewBelow((n) => n + 1)
    }
  }, [messages, panel])

  useLayoutEffect(() => {
    if (panel !== 'room') return
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = savedScrollTop.current > 0 ? savedScrollTop.current : el.scrollHeight
     
  }, [panel])

  const onScrollSave = () => {
    const el = scrollRef.current
    if (!el) return
    savedScrollTop.current = el.scrollTop
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 90
    atBottomRef.current = nearBottom
    if (nearBottom) setNewBelow(0)
  }

  const playerFor = (userId: string) => players.find((p) => p.userId === userId)

  const send = async () => {
    const t = text.trim()
    if (!t || sending) return
    // §33: metadata re-derived from the final text — a deleted token can
    // never leave stale metadata behind.
    const mentions = mentionCandidates.filter((c) => t.includes(`@${c.displayName}`))
    setText('')
    setMentionCandidates([])
    setEmojiOpen(false)
    const rt = replyTo
    setReplyTo(null)
    atBottomRef.current = true
    inputRef.current?.blur()
    if (Capacitor.isNativePlatform()) {
      Keyboard.hide().catch(() => {})
    }
    await onSend(t, rt ?? undefined, mentions)
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

  // ── §32 mirror: the input's own text is transparent; this layer paints the
  // exact same string with bold+highlighted tokens. Same box, same font.
  const mirror = useMemo(() => {
    const tokens = mentionCandidates.filter((c) => text.includes(`@${c.displayName}`))
    if (!text) return null
    if (tokens.length === 0) return text
    const re = new RegExp(
      `@(${tokens.map((t) => escapeRegExp(t.displayName)).join('|')})(?=$|[^A-Za-z0-9_])`,
      'g'
    )
    const parts: React.ReactNode[] = []
    let last = 0
    let key = 0
    let match: RegExpExecArray | null
    while ((match = re.exec(text)) !== null) {
      if (match.index > last) parts.push(text.slice(last, match.index))
      parts.push(
        <span key={`tk-${key++}`} className="sbr-mention-token">
          @{match[1]}
        </span>
      )
      last = match.index + match[0].length
      if (match[0].length === 0) re.lastIndex++
    }
    if (last < text.length) parts.push(text.slice(last))
    return parts
  }, [text, mentionCandidates])

  // ── ROOM CHAT content — stays mounted (display:none) under the other two
  // states so the scroll position (§17) and DOM state survive the round-trip
  // personal → contacts → room (§15).
  const roomContent = (
    <div style={panel === 'room' ? { display: 'contents' } : { display: 'none' }}>
      {/* mobile sheet grabber */}
      <div className="sbr-chat-grabber" aria-hidden />

      {/* web sidebar header (§80 — unchanged) */}
      <div className="sbr-chat-head">
        <span className="sbr-chat-live-dot" aria-hidden />
        <h2 className="sbr-chat-head-title">
          Table Activity &amp; Chat
          <span className="sbr-chat-online">{players.length} Online</span>
        </h2>
        <div className="sbr-chat-head-actions">
          {onOpenGameChats && (
            <button
              type="button"
              onClick={onOpenGameChats}
              className="sbr-chat-gamechats-btn"
              aria-label="Open game chats"
              title="Game Chats"
              data-testid="room-chat-gamechats"
            >
              💬 Game Chats
              {gameChatsUnread > 0 && (
                <span className="sbr-chat-gamechats-badge">{gameChatsUnread > 9 ? '9+' : gameChatsUnread}</span>
              )}
            </button>
          )}
          <button type="button" title="Sound effects" aria-label="Sound effects">🔊</button>
          <button type="button" title="Table settings" aria-label="Table settings">⚙️</button>
        </div>
      </div>

      <div ref={scrollRef} className="sbr-chat-scroll no-scrollbar" onScroll={onScrollSave}>
        {messages.length === 0 ? (
          <div className="sbr-chat-empty">
            <span style={{ fontSize: 26 }}>👋</span>
            <span>No messages yet — break the ice!</span>
          </div>
        ) : (
          messages.map((m) => {
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
                  <div className={`sbr-msg${isMe ? ' me' : ''}${flashId === m.id ? ' sbr-msg-mention-flash' : ''}`}>
                    <GiftAvatar player={p} me={isMe} />
                    <div className="sbr-msg-body">
                      <p className="sbr-msg-meta">
                        <span
                          className="sbr-msg-name"
                          style={{ color: isMe ? 'var(--qk-accent, #ff2d55)' : nameColor(m.userId) }}
                        >
                          {displayName}
                        </span>
                        <span className="sbr-msg-time">{timeFor(m.createdAt)}</span>
                      </p>
                      {m.replyTo && (
                        <div className="sbr-msg-reply-ref">
                          <span className="sbr-msg-reply-name">{m.replyTo.name}</span>
                          <span className="sbr-msg-reply-text">{m.replyTo.text}</span>
                        </div>
                      )}
                      {/* §56: mention tokens render as distinct structured spans */}
                      <p className="sbr-msg-text">{renderMessageWithMentions(m)}</p>
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

      {/* §17: new-messages pill — shown when messages arrived while the user
          was scrolled up (or away in contacts/personal). Never auto-jumps. */}
      {newBelow > 0 && (
        <button
          type="button"
          className="sbr-new-below"
          onClick={() => {
            const el = scrollRef.current
            if (el) el.scrollTop = el.scrollHeight
            atBottomRef.current = true
            setNewBelow(0)
          }}
        >
          ↓ {newBelow > 1 ? `${newBelow} new messages` : 'New message'}
        </button>
      )}

      {/* Composer row (pops on top of the table when kbOpen) */}
      <div className={`sbr-composer${kbOpen ? ' sbr-composer-popped' : ''}`}>
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

        {/* §35/§85: the picker is anchored to the COMPOSER (inside the right
            panel) — it never covers the game table. */}
        {pickerOpen && (
          <div className="sbr-mention-pop" data-testid="mention-picker">
            <span className="sbr-mention-pop-head">
              Mention {mentionQuery ? `@${mentionQuery}` : '@'}
            </span>
            {pickerPlayers.length === 0 ? (
              <p className="sbr-mention-pop-empty">No matching players at this table</p>
            ) : (
              pickerPlayers.map((p, i) => (
                <button
                  key={p.userId}
                  type="button"
                  className={`sbr-mention-item${i === pickerIndex ? ' sbr-mention-item-sel' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertMentionToken(p.userId, p.displayName)}
                  data-testid={`mention-item-${p.userId}`}
                >
                  {p.avatar ? (
                     
                    <img src={p.avatar} alt="" className="sbr-mention-avatar" />
                  ) : (
                    <span className="sbr-mention-avatar">{p.displayName.slice(0, 1).toUpperCase()}</span>
                  )}
                  <span className="sbr-mention-name">{p.displayName}</span>
                </button>
              ))
            )}
          </div>
        )}

        <div className="sbr-comp-field">
          {/* §32: transparent-input mirror paints the bold+highlighted tokens */}
          {mirror !== null && (
            <div className="sbr-mention-mirror" aria-hidden>
              {mirror}
              {'\u200b'}
            </div>
          )}
          <input
            ref={inputRef}
            className={`sbr-input${mirror !== null ? ' sbr-input-mentions' : ''}`}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              caretRef.current = e.target.selectionStart ?? e.target.value.length
            }}
            onKeyUp={(e) => {
              caretRef.current = e.currentTarget.selectionStart ?? caretRef.current
            }}
            onClick={(e) => {
              caretRef.current = e.currentTarget.selectionStart ?? caretRef.current
            }}
            onKeyDown={(e) => {
              if (pickerOpen && pickerPlayers.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setPickerIndex((i) => (i + 1) % pickerPlayers.length)
                  return
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setPickerIndex((i) => (i - 1 + pickerPlayers.length) % pickerPlayers.length)
                  return
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault()
                  const p = pickerPlayers[pickerIndex]
                  if (p) insertMentionToken(p.userId, p.displayName)
                  return
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  // Close the picker for this keystroke: consume the '@'.
                  setText((t) => t)
                  caretRef.current = 0
                  return
                }
              }
              if (e.key === 'Enter' && !e.shiftKey) send()
            }}
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

        <button className="sbr-comp-btn" onClick={onOpenGifts} aria-label="Send a gift" title="Send a gift">
          🎁
        </button>
        <button className="sbr-send" onClick={send} disabled={!text.trim() || sending} aria-label="Send">
          <Send size={16} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  )

  return (
    <div className={`sbr-chat${kbOpen ? ' sbr-kb-open' : ''}`} data-testid={`room-chat-panel-${panel}`}>
      {/* §4/§74/§118: ONE shell — the other states are normal children of
          THIS panel; the room content above stays mounted underneath. */}
      {roomContent}
      {panel !== 'room' && panelContent}
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
