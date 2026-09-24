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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, Reply, X, MoreHorizontal, Flag, MessageCircle, Volume2, VolumeX, Settings, ArrowLeft, Gift, ChevronDown, Sticker } from 'lucide-react'
import { toast } from 'sonner'
import { Capacitor } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'
import { useQuickyStore } from '@/store/quicky'
import { useGiftAlertStore } from '@/store/gift-alerts'
import { useGiftBackStore } from '@/store/gift-back'
import { api } from '@/lib/quicky/api-client'
import { isMentionSoundEnabled, setMentionSoundEnabled } from '@/lib/quicky/mention-sound'
import { GiftIcon } from '@/components/quicky/GiftIcon'
import { StickerPicker } from '@/components/quicky/game-chat/StickerPicker'
import { EmojiReactDrawer } from '@/components/quicky/EmojiReactDrawer'

export type RoomMention = { userId: string; displayName: string }

/** Gift chat-card metadata — mirrors the server's gift message JSON payload. */
export type GiftChatMeta = {
  itemId?: string
  itemName?: string
  itemEmoji?: string
  itemIcon?: string
  itemIconType?: string
  recipientId?: string | null
  recipientName?: string | null
  recipientIds?: string[]
  recipientNames?: string[]
  recipientCount?: number
  quantity?: number
  bulk?: boolean
}

/** Sticker chat metadata — kind === 'sticker' rows (room chat). */
export type StickerChatMeta = {
  stickerId?: string
  stickerName?: string
  stickerAsset?: string
}

export type RoomMessage = {
  id: string
  userId: string
  text: string
  kind: string
  createdAt: string
  replyTo?: {
    id: string
    name: string
    text: string
    /** resolved server-side (persisted in metadata) so every client can
     *  localise the author name to "You" */
    userId?: string
    /** 'user' | 'sticker' — sticker targets carry an asset thumbnail */
    kind?: string
    /** sticker targets: the referenced sticker's asset (image URL or emoji) */
    asset?: string | null
  } | null
  mentions?: RoomMention[]
  /** kind === 'gift' rows: the gift payload (icon/name/quantity/recipients).
   *  kind === 'sticker' rows: { stickerId, stickerName, stickerAsset }. */
  metadata?: GiftChatMeta & StickerChatMeta | null
}

export type ChatPlayer = {
  userId: string
  displayName: string
  avatar: string | null
  /** Room-chat settings: this player turned mentions OFF for this room —
   *  the @ picker never offers them. */
  mentionDisabled?: boolean
}

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

// Emoji react options now live in the shared EmojiReactDrawer (quick row +
// the full catalog, anchored under the reacted message) — the QUICK_REACTS
// row is gone.

const REACTIONS = [
  { emoji: '❤️', label: 'Kiss', tone: 'kiss' },
  { emoji: '🥂', label: 'Cheers', tone: 'cheers' },
  { emoji: '🔥', label: 'Wow', tone: 'wow' },
  { emoji: '💃', label: 'Dance', tone: 'dance' },
] as const

/** Sticker drawer height cap — mobile sheets (≤350px) fill fully under the
 *  table; tall desktop sidebars cap here so the drawer rises from the panel
 *  bottom instead of covering the whole sidebar. */
const STICKER_DRAWER_MAX_H = 440

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
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; side: 'above' | 'below' } | null>(null)
  // The row element captured WHEN the menu opens (state, not a render-time
  // ref read) — anchors the emoji react drawer under the message.
  const [menuAnchorEl, setMenuAnchorEl] = useState<HTMLElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const startX = useRef(0)
  const startY = useRef(0)
  const isDragging = useRef(false)
  const directionLocked = useRef<'x' | 'y' | null>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The anchor element is read from the ref inside the EVENT HANDLER (legal
  // ref access) and stored in state; the drawer receives it as a prop.
  const openMenu = useCallback(() => {
    setMenuAnchorEl(wrapRef.current)
    setMenuOpen(true)
  }, [])
  const closeMenu = useCallback(() => {
    setMenuOpen(false)
    setMenuPos(null)
    setMenuAnchorEl(null)
  }, [])

  // TOOLBOX PLACEMENT: the actions menu is PORTAL'd to <body> as a
  // position:fixed popover. It used to be absolutely positioned inside the
  // chat scroll container (overflow-y:auto) and always opened ABOVE the row —
  // clipped out of existence whenever the row sat near the top of the visible
  // scroll area. Now it looks at the space actually available in the viewport:
  // above the row when it fits, flipped below the row when it doesn't, always
  // clamped inside the screen. Runs pre-paint (the menu stays
  // visibility:hidden until positioned) so there is no visible jump.
  useLayoutEffect(() => {
    if (!menuOpen) return
    const wrap = wrapRef.current
    const menu = menuRef.current
    if (!wrap || !menu || typeof window === 'undefined') return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const wr = wrap.getBoundingClientRect()
    const mw = menu.offsetWidth
    const mh = menu.offsetHeight
    const M = 8
    let top: number
    // side rides along with the position so the EMOJI REACT DRAWER can take
    // the OPPOSITE side of the row (drawer + menu sandwich the message).
    let side: 'above' | 'below'
    if (wr.top - M > mh) {
      top = wr.top - mh - 6
      side = 'above'
    } else if (vh - wr.bottom - M > mh) {
      top = wr.bottom + 6
      side = 'below'
    } else {
      // not enough room either way — clamp into the viewport, prefer below
      top = Math.max(M, Math.min(wr.bottom + 6, vh - mh - M))
      side = 'below'
    }
    // horizontal: hug the row's trailing edge (mine → right edge, others →
    // left edge) then clamp so the toolbox always stays fully on-screen
    let left = mine ? wr.right - mw : wr.left
    left = Math.max(M, Math.min(left, vw - mw - M))
    setMenuPos({ top, left, side })
  }, [menuOpen, mine])

  // Any scroll (capture catches the chat's inner scroll container) or a
  // viewport resize closes the toolbox — a fixed popover must never detach
  // from the row it belongs to.
  useEffect(() => {
    if (!menuOpen) return
    window.addEventListener('scroll', closeMenu, true)
    window.addEventListener('resize', closeMenu)
    return () => {
      window.removeEventListener('scroll', closeMenu, true)
      window.removeEventListener('resize', closeMenu)
    }
  }, [menuOpen, closeMenu])

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
      openMenu()
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
      ref={wrapRef}
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
        onClick={() => (menuOpen ? closeMenu() : openMenu())}
      >
        <MoreHorizontal size={14} />
      </button>

      {menuOpen && typeof document !== 'undefined' && createPortal(
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 60 }}
            onClick={closeMenu}
            onPointerDown={closeMenu}
          />
          <div
            ref={menuRef}
            className="sbr-msg-menu"
            style={{
              top: menuPos?.top,
              left: menuPos?.left,
              visibility: menuPos ? 'visible' : 'hidden',
            }}
          >
            <button
              type="button"
              onClick={() => {
                closeMenu()
                onReply()
              }}
            >
              <Reply size={13} /> Reply
            </button>
            <button
              type="button"
              className="sbr-msg-menu-report"
              onClick={() => {
                closeMenu()
                toast('Message reported. Our moderators will take a look.')
              }}
            >
              <Flag size={13} /> Report
            </button>
          </div>
        </>,
        document.body
      )}

      {/* EMOJI REACT DRAWER (reaction revision) — anchored to this row on the
          OPPOSITE side from the actions menu, so the drawer + menu sandwich
          the message. The quick row + ⌄ expand arrow → the full emoji
          catalog; picking sends the emoji into the room chat (the existing
          room-chat reaction semantics). */}
      {menuOpen && typeof document !== 'undefined' && (
        <EmojiReactDrawer
          anchorEl={menuAnchorEl}
          align={mine ? 'right' : 'left'}
          side={menuPos?.side === 'below' ? 'above' : 'below'}
          onPick={(emoji) => {
            onReact(emoji)
            closeMenu()
          }}
          onClose={closeMenu}
        />
      )}
    </div>
  )
}

// ─── Reply reference rendering (timeline rows + composer banner) ────────────
// A reply to a STICKER shows the sticker's actual media as a tiny thumbnail
// (image URL or the emoji glyph) next to the author name — "stickers can be
// used as replies for a chat bubble and other stickers". Text targets keep
// their snippet. The author name localises to "You" for my own messages.
function ReplyThumb({ asset }: { asset: string }) {
  const isImg = /^https?:\/\//i.test(asset) || asset.startsWith('/') || asset.startsWith('data:image/')
  if (isImg) return <img src={asset} alt="" className="sbr-reply-thumb" draggable={false} />
  return (
    <span className="sbr-reply-thumb sbr-reply-thumb-emoji" aria-hidden>
      {asset}
    </span>
  )
}

function ReplyRefLine({ replyTo, meId }: { replyTo: NonNullable<RoomMessage['replyTo']>; meId: string }) {
  const name = replyTo.userId && replyTo.userId === meId ? 'You' : replyTo.name
  const asset = replyTo.asset ?? null
  return (
    <div className="sbr-msg-reply-ref">
      {asset ? <ReplyThumb asset={asset} /> : null}
      <div className="sbr-msg-reply-copy">
        <span className="sbr-msg-reply-name">{name}</span>
        <span className="sbr-msg-reply-text">
          {replyTo.kind === 'sticker' ? `Sticker — ${replyTo.text || 'sticker'}` : replyTo.text}
        </span>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export function RoomChatPanel({
  messages,
  players,
  meId,
  roomId,
  onSend,
  sending,
  kbOpen = false,
  onOpenGifts,
  onSendSticker,
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
  /** The room this chat belongs to (mention settings + gift-back sheet). */
  roomId?: string | null
  onSend: (
    text: string,
    replyTo?: RoomMessage['replyTo'],
    mentions?: RoomMention[]
  ) => Promise<void>
  sending: boolean
  kbOpen?: boolean
  /** v3: opens the gift sheet (DB-driven catalog) — no more dead button. */
  onOpenGifts?: () => void
  /** Stickers — sends a sticker message into the room chat (the parent's
   *  store validates ownership on the server). Carries the ACTIVE reply
   *  target so a sticker can reply to a chat bubble or another sticker. */
  onSendSticker?: (
    sticker: { id: string; name: string; assetUrl: string },
    replyTo?: RoomMessage['replyTo']
  ) => void
  /** Bug-fix PRD §9: web sidebar → Game Contacts panel state. */
  onOpenGameChats?: () => void
  /** Total unread private game chats (badge on the entry button). */
  gameChatsUnread?: number
  /** §3 unified chat state: which surface the shell renders. */
  panel?: 'room' | 'contacts' | 'personal' | 'dating'
  /** §4: contacts / personal views render INSIDE this shell (normal children). */
  panelContent?: React.ReactNode
  /** §48: message id that mentions ME — its bubble flashes briefly. */
  mentionFlashId?: string | null
  /** §48: parent clears the store flag after the flash window. */
  onMentionFlashDone?: () => void
}) {
  const [text, setText] = useState('')
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [stickerOpen, setStickerOpen] = useState(false)
  const [replyTo, setReplyTo] = useState<RoomMessage['replyTo']>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  // Sticker BOTTOM DRAWER — overlays the chat sheet's message area and
  // slides up from the composer. THE ANCHORING RULE (fixes the out-of-view
  // bug): the drawer is a DIRECT CHILD of .sbr-chat (position: relative),
  // NEVER a child of .sbr-composer — the composer's own position:relative
  // used to shrink the coordinate space to its ~51px row, pushing the
  // drawer past the sheet edge where overflow:hidden clipped it. Mobile:
  // the drawer fills the whole sheet area under the table; desktop: it
  // rises from the panel bottom capped at 440px so the sidebar's top stays
  // visible. top/height are measured from the LIVE layout and re-measured
  // while open (reply banner, expanded sheet, window resize all move the
  // composer row).
  const composerRowRef = useRef<HTMLDivElement | null>(null)
  const [composerTop, setComposerTop] = useState<number | null>(null)

  const openStickerDrawer = () => {
    // Drop the keyboard FIRST: the drawer anchors to the composer's DOCKED
    // flow position, so an open keyboard (which pops the composer out)
    // must not be riding while the drawer measures + shows.
    inputRef.current?.blur()
    const el = composerRowRef.current
    setComposerTop(el && el.offsetParent ? el.offsetTop : null)
    setStickerOpen(true)
    setEmojiOpen(false)
  }

  const closeStickerDrawer = useCallback(() => setStickerOpen(false), [])

  // The keyboard popping the composer out of the panel forces the drawer
  // closed — it is anchored to the composer's docked flow position and
  // would otherwise render behind the keyboard.
  useEffect(() => {
    if (kbOpen && stickerOpen) setStickerOpen(false)
  }, [kbOpen, stickerOpen])

  // Keep the drawer glued to the composer while it is open — the row moves
  // when the reply banner appears, the sheet expands/collapses or the
  // window resizes (rotate / desktop resize).
  useEffect(() => {
    if (!stickerOpen) return
    const remeasure = () => {
      const node = composerRowRef.current
      if (node && node.offsetParent) setComposerTop(node.offsetTop)
    }
    remeasure()
    let ro: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(remeasure)
      const row = composerRowRef.current
      if (row) {
        ro.observe(row)
        // sheet-height changes (expand / collapse) move the row too
        const sheet = row.closest('.sbr-chat')
        if (sheet) ro.observe(sheet)
      }
    }
    window.addEventListener('resize', remeasure)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', remeasure)
    }
  }, [stickerOpen])

  // Escape closes the drawer (the X button + backdrop-style body tap do
  // the same); picking a sticker sends and closes in one gesture.
  useEffect(() => {
    if (!stickerOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeStickerDrawer()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stickerOpen, closeStickerDrawer])
  // §17: scroll preservation — remember where the user was, never yank them.
  const savedScrollTop = useRef(0)
  const atBottomRef = useRef(true)
  const [newBelow, setNewBelow] = useState(0)

  // ── EXPANDABLE CHAT (room-chat-settings revision, mobile only — the
  // ≥1024px sidebar is always "expanded" and the grabber is display:none).
  // Drag the handle UP → the sheet grows to a near-full drawer (settings +
  // speaker tools appear); drag DOWN (or tap the chevron) → back to normal.
  // Switching to contacts/personal or opening the keyboard collapses it so
  // those views keep the standard sheet geometry.
  const [expanded, setExpanded] = useState(false)
  const handleDragRef = useRef(0)
  useEffect(() => {
    if (panel !== 'room' || kbOpen) setExpanded(false)
  }, [panel, kbOpen])

  // ── CHAT SETTINGS SUB-PANEL (in-panel surface — NEVER a separate page:
  // desktop keeps the shell mounted, mobile keeps the room mounted). Back
  // returns to whatever the chat section was showing (room / contacts /
  // personal — those views stay mounted underneath the overlay).
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [soundOn, setSoundOn] = useState(() => isMentionSoundEnabled())
  const meMentionDisabled = players.find((p) => p.userId === meId)?.mentionDisabled
  const [meMentionsOn, setMeMentionsOn] = useState(meMentionDisabled !== true)
  const [mentionBusy, setMentionBusy] = useState(false)
  // Re-sync the mention toggle when the snapshot refreshes the players list
  // (the server confirms the write / another device flipped it).
  useEffect(() => {
    setMeMentionsOn(meMentionDisabled !== true)
  }, [meMentionDisabled])

  const toggleMentions = async (on: boolean) => {
    if (!roomId || mentionBusy) return
    setMentionBusy(true)
    const prev = meMentionsOn
    setMeMentionsOn(on) // optimistic — the picker reacts instantly
    try {
      await api.spinBottle.roomMentions(roomId, on)
      toast.success(on ? 'Mentions are back on for this room' : 'Nobody can mention you in this room now')
    } catch (e: any) {
      setMeMentionsOn(prev)
      toast.error(e?.message ?? 'Could not update mention settings')
    } finally {
      setMentionBusy(false)
    }
  }

  const toggleSound = () => {
    const next = !soundOn
    setSoundOn(next)
    setMentionSoundEnabled(next)
  }

  // ── Mention state ─────────────────────────────────────────────────────────
  // candidates = players picked this session whose tokens still exist in the
  // text. Metadata is RE-DERIVED from the text at render/send time (§33).
  const [mentionCandidates, setMentionCandidates] = useState<RoomMention[]>([])
  const caretRef = useRef(0)
  const [pickerIndex, setPickerIndex] = useState(0)

  // §34/§36: trailing "@query" before the caret → picker with local filter.
  const mentionQuery = useMemo(() => {
    // the caret ref read here is intentional — the picker query derives from
    // the LIVE caret position; the ref updates in the same onChange that
    // sets `text`, so it is fresh on every recompute.
    const before = text.slice(0, caretRef.current || text.length)
    const m = before.match(/(^|\s)@([A-Za-z0-9_]*)$/)
    return m ? m[2] : null
     
  }, [text, caretRef.current])

  // §35/§62/§87: picker candidates come from the AUTHORITATIVE room players
  // (the same list the table renders). A player who left is gone from the
  // picker instantly — no ghost mentions (§106/§112). Self-mention excluded.
  // Room-chat settings: players who turned mentions OFF for this room are
  // never offered (the server would drop the mention row anyway).
  const pickerPlayers = useMemo(() => {
    if (mentionQuery === null) return []
    const q = mentionQuery.toLowerCase()
    return players.filter(
      (p) =>
        p.userId !== meId &&
        !p.mentionDisabled &&
        p.displayName &&
        p.displayName.toLowerCase().includes(q)
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
    setStickerOpen(false)
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
    // Sticker targets: the reply preview carries the sticker's media so the
    // banner (and the persisted ref on every client) can show a thumbnail.
    const isSticker = m.kind === 'sticker'
    const asset = isSticker ? (m.metadata?.stickerAsset ?? null) : null
    const text = isSticker
      ? (m.metadata?.stickerName || m.text || 'Sticker').slice(0, 80)
      : m.text.slice(0, 80)
    setReplyTo({ id: m.id, name, text, userId: m.userId, kind: m.kind, asset })
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
      {/* EXPANDABLE CHAT drag handle (mobile only — display:none ≥1024px).
          Drag UP past the threshold → expand; drag DOWN / tap → collapse.
          The chevron mirrors the state so the affordance is discoverable. */}
      <motion.div
        className="sbr-chat-grabber-wrap"
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0.7, bottom: 0.7 }}
        dragMomentum={false}
        onDragStart={() => {
          handleDragRef.current = Date.now()
        }}
        onDragEnd={(_, info) => {
          if (info.offset.y < -46 || info.velocity.y < -420) setExpanded(true)
          else if (info.offset.y > 46 || info.velocity.y > 420) setExpanded(false)
        }}
        onClick={() => {
          // Tap toggles — but never right after a drag (the pointerup would
          // double-fire and undo the drag's verdict).
          if (Date.now() - handleDragRef.current < 300) return
          setExpanded((v) => !v)
        }}
        role="button"
        aria-label={expanded ? 'Collapse chat' : 'Expand chat'}
        data-testid="room-chat-expand-handle"
      >
        <div className="sbr-chat-grabber" aria-hidden />
        <ChevronDown
          className={`sbr-chat-grabber-chevron${expanded ? ' sbr-chevron-flipped' : ''}`}
          size={13}
          aria-hidden
        />
      </motion.div>

      {/* MOBILE tools row — appears ONLY in the expanded state, mirroring the
          desktop web sidebar header: mention-sound speaker + chat settings. */}
      {expanded && (
        <div className="sbr-chat-tools" data-testid="room-chat-tools">
          <h2 className="sbr-chat-tools-title">
            Table Activity &amp; Chat
            <span className="sbr-chat-online">{players.length} Online</span>
          </h2>
          <div className="sbr-chat-tools-actions">
            <button
              type="button"
              onClick={toggleSound}
              className={soundOn ? 'sbr-chat-tool-on' : ''}
              title={soundOn ? 'Mention sound on' : 'Mention sound off'}
              aria-label={soundOn ? 'Mute mention notification sound' : 'Unmute mention notification sound'}
              aria-pressed={soundOn}
              data-testid="room-chat-sound"
            >
              {soundOn ? <Volume2 size={15} /> : <VolumeX size={15} />}
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              title="Chat settings"
              aria-label="Chat settings"
              data-testid="room-chat-settings"
            >
              <Settings size={15} />
            </button>
          </div>
        </div>
      )}

      {/* web sidebar header (§80) — speaker + gear are now LIVE controls
          (mention sound toggle + the same in-panel settings surface). */}
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
          <button
            type="button"
            onClick={toggleSound}
            className={soundOn ? 'sbr-chat-tool-on' : ''}
            title={soundOn ? 'Mention sound on' : 'Mention sound off'}
            aria-label={soundOn ? 'Mute mention notification sound' : 'Unmute mention notification sound'}
            aria-pressed={soundOn}
          >
            {soundOn ? <Volume2 size={14} /> : <VolumeX size={14} />}
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            title="Chat settings"
            aria-label="Chat settings"
          >
            <Settings size={14} />
          </button>
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
            // GIFT CARD (gifting-revision): the special "You received N × 🎁
            // from {sender}" timeline row with a send-back button — the
            // recipient-facing centerpiece of the gift experience. Everyone
            // else sees the lighter "{sender} gifted {recipient}" variant.
            if (m.kind === 'gift') {
              const meta = m.metadata
              const iAmRecipient =
                !!meta &&
                (meta.recipientId === meId || (meta.recipientIds ?? []).includes(meId))
              const sender = playerFor(m.userId)
              const senderName = m.userId === meId ? 'You' : (sender?.displayName ?? 'Someone')
              return (
                <GiftChatCard
                  key={m.id}
                  message={m}
                  sender={m.userId === meId ? null : sender}
                  senderName={senderName}
                  iAmRecipient={iAmRecipient}
                  roomId={roomId ?? null}
                />
              )
            }
            // STICKER message: the big sticker asset — uploaded image or
            // emoji glyph — rendered as BARE media (no chat-bubble
            // background, matching personal-chat sticker rows: just the
            // media with the name/time meta above it). Reply works like
            // text rows; a sticker sent AS a reply renders the reference
            // line above the media (with the target's thumbnail when it
            // was a sticker).
            if (m.kind === 'sticker') {
              const isMe = m.userId === meId
              const p = playerFor(m.userId)
              const displayName = isMe ? 'You' : (p?.displayName ?? 'Guest')
              const asset = m.metadata?.stickerAsset ?? '✨'
              const isImg = /^https?:\/\//i.test(asset) || asset.startsWith('/') || asset.startsWith('data:image/')
              return (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 10, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 28 }}
                >
                  <SwipeableBubble onReply={() => startReply(m)} onReact={(emoji) => onSend(emoji)} mine={isMe}>
                    <div className={`sbr-msg${isMe ? ' me' : ''} sbr-msg--sticker`}>
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
                        {m.replyTo && <ReplyRefLine replyTo={m.replyTo} meId={meId} />}
                        <div className="sbr-sticker-bubble" data-testid={`room-sticker-msg-${m.id}`}>
                          {isImg ? (
                            <img
                              src={asset}
                              alt={m.metadata?.stickerName ?? m.text}
                              className="sbr-sticker-img"
                              draggable={false}
                            />
                          ) : (
                            <span className="sbr-sticker-emoji" role="img" aria-label={m.metadata?.stickerName ?? m.text}>
                              {asset}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </SwipeableBubble>
                </motion.div>
              )
            }
            if (m.kind !== 'user') return null
            const isMe = m.userId === meId
            const p = playerFor(m.userId)
            const displayName = isMe ? 'You' : (p?.displayName ?? 'Guest')

            return (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 10, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: 'spring', stiffness: 420, damping: 28 }}
              >
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
                      {m.replyTo && <ReplyRefLine replyTo={m.replyTo} meId={meId} />}
                      {/* §56: mention tokens render as distinct structured spans */}
                      <p className="sbr-msg-text">{renderMessageWithMentions(m)}</p>
                    </div>
                  </div>
                </SwipeableBubble>
              </motion.div>
            )
          })
        )}
      </div>

      {/* Quick reactions — stay docked in the panel. While the keyboard is
          up ONLY the composer pops out of the panel; this row stays in the
          sheet's flow box (hidden behind the keyboard) and never moves. */}
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

      {/* Composer row — pops OUT of the message panel when the soft
          keyboard opens (CSS .sbr-chat.sbr-kb-open .sbr-composer): the
          input + its anchored reply banner / mention picker / emoji tray
          float directly above the keyboard, overlaying the table by just
          the strip they need — the message panel and the painted table
          never move or resize. */}
      <div ref={composerRowRef} className="sbr-composer">
        {replyTo && (
          <div className="sbr-reply-banner">
            <Reply size={13} className="sbr-reply-icon" />
            {replyTo.asset ? <ReplyThumb asset={replyTo.asset} /> : null}
            <div className="sbr-reply-content">
              <span className="sbr-reply-to-name">{replyTo.name}</span>
              <span className="sbr-reply-to-text">
                {replyTo.kind === 'sticker' ? `Sticker — ${replyTo.text}` : replyTo.text}
              </span>
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
            onFocus={() => {
              // Typing closes the sticker drawer — the drawer is anchored
              // to the docked composer and must not fight the keyboard.
              if (stickerOpen) setStickerOpen(false)
            }}
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
            onClick={() => {
              setEmojiOpen((v) => !v)
              // The emoji tray and the sticker drawer never share the space
              // above the composer.
              if (stickerOpen) setStickerOpen(false)
            }}
            aria-label="Emoji"
          >
            😊
          </button>
        </div>

        <button
          className={`sbr-comp-btn sbr-comp-sticker${stickerOpen ? ' sbr-comp-on' : ''}`}
          onClick={() => {
            if (stickerOpen) closeStickerDrawer()
            else openStickerDrawer()
          }}
          aria-label="Stickers"
          title="Stickers"
          aria-pressed={stickerOpen}
          data-testid="composer-stickers-btn"
        >
          <Sticker size={15} strokeWidth={2.4} />
        </button>

        <button className="sbr-comp-btn" onClick={onOpenGifts} aria-label="Send a gift" title="Send a gift">
          🎁
        </button>

        {/* Unified PRD §25/§100 — the composer carries emoji · gift · MESSAGE ·
            send. The message/contact button opens the SAME contacts surface as
            the "Game Chats" header button: on mobile web / Capacitor it opens
            the dedicated full-screen contacts page; on desktop web it flips
            this panel to the embedded contacts state. The table never
            unmounts and the runtime never detaches. */}
        {onOpenGameChats && (
          <button
            className="sbr-comp-btn sbr-comp-msgs"
            onClick={onOpenGameChats}
            aria-label="Messages and contacts"
            title="Messages"
            data-testid="composer-messages-btn"
          >
            <MessageCircle size={15} strokeWidth={2.6} />
            {gameChatsUnread > 0 && (
              <span className="sbr-comp-msgs-badge" data-testid="composer-messages-badge">
                {gameChatsUnread > 9 ? '9+' : gameChatsUnread}
              </span>
            )}
          </button>
        )}

        <button className="sbr-send" onClick={send} disabled={!text.trim() || sending} aria-label="Send">
          <Send size={16} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  )

  return (
    <div
      className={`sbr-chat${kbOpen ? ' sbr-kb-open' : ''}${expanded ? ' sbr-chat-expanded' : ''}`}
      data-testid={`room-chat-panel-${panel}`}
    >
      {/* §4/§74/§118: ONE shell — the other states are normal children of
          THIS panel; the room content above stays mounted underneath. */}
      {roomContent}
      {/* 'dating' renders the parent-provided embedded ChatView (§57) */}
      {panel !== 'room' && panelContent}

      {/* ═══ STICKER BOTTOM DRAWER — a DIRECT CHILD of .sbr-chat (NOT of the
          composer: .sbr-composer is position:relative, and an absolute child
          inside it resolves bottom:calc(100% - Xpx) against the ~51px input
          row — that pushed the drawer past the sheet edge where overflow:
          hidden clipped it out of view on mobile). Anchored to the sheet:
          mobile → overlays the whole chat area under the table; desktop →
          rises from the panel bottom capped at 440px. Stays above the
          composer so the row (and its sticker toggle) remain usable. */}
      {stickerOpen && panel === 'room' && (
        <div
          className="sbr-sticker-drawer"
          style={
            composerTop != null
              ? {
                  top: Math.max(0, composerTop - Math.min(composerTop, STICKER_DRAWER_MAX_H)),
                  height: Math.min(composerTop, STICKER_DRAWER_MAX_H),
                }
              : { top: 0, bottom: 51 }
          }
          data-testid="room-sticker-drawer"
        >
          <div className="sbr-sticker-drawer-head">
            <div className="sbr-sticker-drawer-title">
              <Sticker size={14} aria-hidden />
              <span>Stickers</span>
            </div>
            <button
              className="sbr-sticker-drawer-x"
              onClick={closeStickerDrawer}
              aria-label="Close stickers"
              data-testid="room-sticker-drawer-close"
            >
              <X size={17} />
            </button>
          </div>
          <StickerPicker
            className="flex-1 min-h-0"
            pickLabel={
              replyTo
                ? `Tap a sticker to reply to ${replyTo.name}`
                : 'Tap a sticker to send it to the table'
            }
            onPick={(s) => {
              // Pick-to-send in one gesture; an active reply rides along —
              // stickers can reply to chat bubbles AND other stickers.
              setStickerOpen(false)
              const rt = replyTo
              setReplyTo(null)
              onSendSticker?.(s, rt ?? undefined)
            }}
            // No onCatalogChange: after a purchase/claim the picker reloads
            // itself and switches to the owned tab — the drawer stays open
            // so the user can immediately send from the new set.
          />
        </div>
      )}

      {/* ═══ PANEL-TOP GIFT DRAWER (gifting-revision) — shows a received-gift
          notification INSIDE the chat shell ONLY while the Room Chat list is
          NOT showing (contacts / personal / dating open — the room content
          above is display:none so the timeline card can't be seen). While
          the Room Chat list is open the timeline gift card IS the
          notification (no drawer — "do not overly disturb"). Off the game
          screen entirely, the global GameGiftAlert top drawer covers it. */}
      {panel !== 'room' && <PanelGiftDrawer />}

      {/* ═══ CHAT SETTINGS SUB-PANEL (in-panel surface — never a separate
          page). Sits ON TOP of everything the chat section is showing
          (room content stays mounted underneath); the back arrow returns
          to exactly that previous surface. ═══ */}
      <AnimatePresence>
        {settingsOpen && (
          <motion.div
            key="room-chat-settings"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="sbr-chat-settings"
            data-testid="room-chat-settings-panel"
          >
            <div className="sbr-chat-settings-head">
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                aria-label="Back to chat"
                data-testid="room-chat-settings-back"
              >
                <ArrowLeft size={17} />
              </button>
              <h3>Chat Settings</h3>
            </div>

            <div className="sbr-chat-settings-body">
              {/* Mention privacy — per-room, server-enforced */}
              <div className="sbr-setting-row">
                <div className="sbr-setting-copy">
                  <p className="sbr-setting-title">Allow mentions in this room</p>
                  <p className="sbr-setting-sub">
                    When off, nobody at this table can mention you — the Mention action
                    and the @ picker hide your name.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={meMentionsOn}
                  disabled={mentionBusy || !roomId}
                  onClick={() => void toggleMentions(!meMentionsOn)}
                  className={`sbr-switch${meMentionsOn ? ' sbr-switch-on' : ''}`}
                  data-testid="room-chat-mentions-toggle"
                >
                  <span className="sbr-switch-knob" />
                </button>
              </div>

              {/* Mention notification sound — local preference */}
              <div className="sbr-setting-row">
                <div className="sbr-setting-copy">
                  <p className="sbr-setting-title">Mention notification sound</p>
                  <p className="sbr-setting-sub">
                    A soft chime whenever someone mentions you — even outside the game
                    screen.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={soundOn}
                  onClick={toggleSound}
                  className={`sbr-switch${soundOn ? ' sbr-switch-on' : ''}`}
                  data-testid="room-chat-sound-toggle"
                >
                  <span className="sbr-switch-knob" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Panel-top gift drawer (in-shell notification while Room Chat hidden) ────
function PanelGiftDrawer() {
  const events = useGiftAlertStore((s) => s.events)
  const dismiss = useGiftAlertStore((s) => s.dismiss)
  const openGiftBack = useGiftBackStore((s) => s.openGiftBack)
  const event = events.length > 0 ? events[0] : null

  return (
    <AnimatePresence>
      {event && (
        <motion.div
          key={event.id}
          initial={{ y: '-115%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '-115%', opacity: 0 }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.5 }}
          onDragEnd={(_, info) => {
            if (info.offset.y > 70 || info.velocity.y > 500) dismiss(event.id)
          }}
          className="sbr-chat-gift-drawer"
          role="dialog"
          aria-label="Gift received"
          data-testid="room-chat-gift-drawer"
        >
          <div
            className="sbr-chat-gift-drawer-card"
            style={{ background: 'var(--qk-accent)' }}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('button')) return
              dismiss(event.id)
            }}
          >
            <div className="sbr-chat-gift-drawer-avatar">
              {event.senderAvatar ? (
                <img src={event.senderAvatar} alt="" />
              ) : (
                <span aria-hidden>🎁</span>
              )}
              <span className="sbr-chat-gift-drawer-badge">
                <Gift size={11} aria-hidden />
              </span>
            </div>
            <div className="sbr-chat-gift-drawer-copy">
              <p className="sbr-chat-gift-drawer-eyebrow">Gift received</p>
              <p className="sbr-chat-gift-drawer-line">
                {event.senderName} sent you{' '}
                {event.quantity > 1 ? `${event.quantity}× ` : ''}
                <GiftIcon
                  icon={event.itemIcon}
                  iconType={event.itemIconType}
                  className="h-3.5 w-3.5 text-sm"
                  imgClassName="h-3.5 w-3.5"
                />
                <span className="truncate">{event.itemName ?? 'a gift'}</span>
              </p>
            </div>
            <div className="sbr-chat-gift-drawer-actions">
              <button
                type="button"
                onClick={() => {
                  openGiftBack(
                    { id: event.senderId, name: event.senderName, avatar: event.senderAvatar ?? null },
                    event.roomId
                  )
                  dismiss(event.id)
                }}
                className="sbr-chat-gift-drawer-send"
                data-testid="room-chat-gift-send-back"
              >
                <Gift size={12} aria-hidden /> Send Gift
              </button>
              <button
                type="button"
                onClick={() => dismiss(event.id)}
                className="sbr-chat-gift-drawer-dismiss"
                aria-label="Dismiss gift notification"
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

// ─── Gift chat card (the timeline special effect) ─────────────────────────────
function GiftChatCard({
  message,
  sender,
  senderName,
  iAmRecipient,
  roomId,
}: {
  message: RoomMessage
  sender?: ChatPlayer | null
  senderName: string
  iAmRecipient: boolean
  roomId: string | null
}) {
  const openGiftBack = useGiftBackStore((s) => s.openGiftBack)
  const meta = message.metadata
  const quantity = Math.max(1, meta?.quantity ?? 1)
  const itemName = meta?.itemName ?? 'a gift'
  const icon = meta?.itemIcon ?? meta?.itemEmoji ?? '🎁'
  const iconType = meta?.itemIconType ?? 'emoji'
  const recipientLabel =
    meta?.recipientCount && meta.recipientCount > 1
      ? `${meta.recipientCount} players`
      : (meta?.recipientName ?? 'someone')

  const sendBack = () => {
    if (!sender) return
    openGiftBack({ id: sender.userId, name: sender.displayName, avatar: sender.avatar }, roomId)
  }

  if (!iAmRecipient) {
    // Spectator variant — light, centered, no actions (same slot as the
    // join/leave chips, but with the gift shimmer).
    return (
      <div className="sbr-gift-row">
        <div className="sbr-gift-chip" data-testid="room-chat-gift-chip">
          <span className="sbr-gift-chip-icon">
            <GiftIcon icon={icon} iconType={iconType} className="h-4 w-4 text-base" imgClassName="h-4 w-4" />
          </span>
          <span>
            <b>{senderName}</b> gifted {recipientLabel} {quantity > 1 ? `${quantity}× ` : ''}
            {itemName}
            {quantity > 1 ? 's' : ''}
          </span>
        </div>
      </div>
    )
  }

  // RECIPIENT variant — the full special-effect card with the send-back CTA.
  return (
    <motion.div
      className="sbr-gift-card"
      initial={{ scale: 0.92, opacity: 0, y: 10 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 22 }}
      data-testid="room-chat-gift-card"
    >
      <span className="sbr-gift-spark sbr-gift-spark-a" aria-hidden>✨</span>
      <span className="sbr-gift-spark sbr-gift-spark-b" aria-hidden>✨</span>
      <div className="sbr-gift-card-inner">
        <div className="sbr-gift-avatar">
          {sender?.avatar ? (
            <img src={sender.avatar} alt="" />
          ) : (
            <span aria-hidden>🎁</span>
          )}
        </div>
        <div className="sbr-gift-copy">
          <p className="sbr-gift-eyebrow">You received a gift</p>
          <p className="sbr-gift-line">
            <motion.span
              className="sbr-gift-icons"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.15, type: 'spring', stiffness: 360, damping: 16 }}
            >
              <GiftIcon icon={icon} iconType={iconType} className="h-5 w-5 text-xl" imgClassName="h-5 w-5" />
              {quantity > 1 && <b className="sbr-gift-count">×{quantity.toLocaleString('en-US')}</b>}
            </motion.span>
            <span className="sbr-gift-from">
              from <b>{senderName}</b>
            </span>
          </p>
        </div>
        {sender && (
          <button
            type="button"
            className="sbr-gift-sendback"
            onClick={sendBack}
            data-testid="room-chat-gift-send-back"
          >
            <Gift size={13} aria-hidden />
            Send gift back
          </button>
        )}
      </div>
    </motion.div>
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
