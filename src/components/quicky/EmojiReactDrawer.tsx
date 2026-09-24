'use client'

// Quicky — EmojiReactDrawer — the shared WhatsApp-style REACTION drawer.
//
// Anchored JUST UNDER the message being reacted (flips above when there is
// no room below), portaled to <body> so no scroll container or overflow
// rule can ever clip it. Two states:
//   compact  → a pill with the quick emojis + a ⌄ drop-down arrow at the end
//   expanded → tapping the arrow enlarges the drawer (spring height/scale
//              animation) into a scrollable, categorised grid with ALL the
//              available emojis.
// Works identically on desktop web, mobile web and the Capacitor app.
//
// Used by: personal dating chat (ChatView), personal game chat
// (GameChatScreen) and the room chat (RoomChatPanel) — one component, one
// behaviour everywhere.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown } from 'lucide-react'

/** The compact row — the most-used reactions, always one tap away. */
export const REACT_QUICK = ['❤️', '😂', '😮', '😢', '👍', '🔥', '🎉', '👏'] as const

/** The FULL emoji catalog, grouped for the expanded drawer.
 *  (REACT_ALL below dedupes each category — React keys must stay unique;
 *  a stray duplicate crashed React with "two children with the same key".) */
const REACT_ALL_RAW: { label: string; emojis: string[] }[] = [
  {
    label: 'Smileys & People',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '🥲', '☺️', '😊', '😇', '🙂', '🙃', '😉', '😌',
      '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥳',
      '🥸', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭',
      '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭',
      '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪',
      '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑', '🤠', '😈', '👿', '👹', '👺', '🤡',
      '💩', '👻', '💀', '☠️', '👽', '🤖', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾',
    ],
  },
  {
    label: 'Gestures',
    emojis: [
      '👍', '👎', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '✋',
      '🤚', '🖐️', '🖖', '👋', '🤝', '🙏', '💪', '🦾', '✍️', '💅', '🤳', '👀', '👁️', '🧠', '🦵', '🦶',
    ],
  },
  {
    label: 'Hearts',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖',
      '💘', '💝', '💟', '♥️', '💌', '💋',
    ],
  },
  {
    label: 'Animals & Nature',
    emojis: [
      '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🙈',
      '🙉', '🙊', '🐔', '🐧', '🐦', '🐤', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🪱',
      '🐛', '🦋', '🐌', '🐞', '🐜', '🕷️', '🦂', '🐢', '🐍', '🦎', '🦖', '🦕', '🐙', '🦑', '🦐', '🦞',
      '🦀', '🐡', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🐊', '🐅', '🐆', '🦓', '🦍', '🐘', '🦛', '🐪',
      '🐫', '🦒', '🦘', '🐃', '🐂', '🐄', '🐎', '🐖', '🐏', '🐑', '🦙', '🐐', '🦌', '🐕', '🐩', '🐈',
      '🐓', '🦃', '🦚', '🦜', '🦢', '🕊️', '🐇', '🦝', '🦨', '🦡', '🦫', '🦦', '🦥', '🐁', '🐀', '🐿️',
      '🌵', '🎄', '🌲', '🌳', '🌴', '🌱', '🌿', '☘️', '🍀', '🎍', '🍃', '🍂', '🍁', '🌾', '🌷', '🌹',
      '🥀', '🌺', '🌸', '🌼', '🌻', '🌞', '🌝', '🌛', '🌜', '🌚', '🌕', '🌖', '🌗', '🌘', '🌑', '🌒',
      '🌓', '🌔', '🌙', '🌎', '🌍', '🌏', '💫', '⭐', '🌟', '✨', '⚡', '🔥', '🌈', '☀️', '🌤️', '⛅',
      '🌥️', '☁️', '🌦️', '🌧️', '⛈️', '🌩️', '🌨️', '❄️', '☃️', '⛄', '🌬️', '💨', '💧', '💦', '🌊',
    ],
  },
  {
    label: 'Food & Drink',
    emojis: [
      '🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝',
      '🍅', '🥑', '🍆', '🥔', '🥕', '🌽', '🌶️', '🥒', '🥬', '🥦', '🍄', '🥜', '🍞', '🥐', '🥖', '🥨',
      '🥞', '🧇', '🧀', '🍖', '🍗', '🥩', '🥓', '🍔', '🍟', '🍕', '🌭', '🥪', '🌮', '🌯', '🥗', '🥘',
      '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🥟', '🍤', '🍚', '🍘', '🍥', '🥮', '🍢', '🍡', '🍧', '🍨',
      '🍦', '🥧', '🧁', '🍰', '🎂', '🍮', '🍭', '🍬', '🍫', '🍿', '🍩', '🍪', '🌰', '☕', '🍵', '🧃',
      '🥤', '🧋', '🍺', '🍻', '🥂', '🍷', '🥃', '🍸', '🍹', '🧉', '🍾', '🧊',
    ],
  },
  {
    label: 'Activity & Sports',
    emojis: [
      '⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🪀', '🏓', '🏸', '🥊', '🥋', '🎽',
      '🛹', '🛼', '🛷', '⛸️', '🥌', '🎿', '⛷️', '🏂', '🪂', '🏋️', '🤼', '🤸', '⛹️', '🤺', '🤾', '🏌️',
      '🏇', '🧘', '🏄', '🏊', '🤽', '🚣', '🧗', '🚵', '🚴', '🏆', '🥇', '🥈', '🥉', '🏅', '🎖️', '🏵️',
      '🎗️', '🎫', '🎟️', '🎪', '🤹', '🎭', '🎨', '🎬', '🎤', '🎧', '🎼', '🎹', '🥁', '🎷', '🎺', '🎸',
      '🪕', '🎻', '🎲', '♟️', '🎯', '🎳', '🎮', '🎰', '🧩',
    ],
  },
  {
    label: 'Objects & Symbols',
    emojis: [
      '🚀', '🛸', '🎈', '🎁', '🎊', '🎉', '🪄', '🧸', '📷', '📸', '🕹️', '💻', '🖥️', '⌨️', '🖱️', '📱',
      '☎️', '🔋', '🔌', '💡', '🔦', '🕯️', '🧨', '💸', '💵', '💰', '💳', '💎', '⚖️', '🔧', '🔨', '⚒️',
      '⚙️', '🧰', '🧲', '🔒', '🔓', '🔑', '🗝️', '🗺️', '🧭', '⌛', '⏳', '⏰', '⏱️', '🕐', '✅', '❌',
      '❗', '❓', '💯', '🆗', '🆙', '🆒', '🆕', '🆓', '🚫', '⚠️', '♻️', '🔱', '⚜️', '🔰', '⭕', '🛑',
      '❎', '✳️', '❇️', '💠', '™️', '©️', '®️', '〰️', '➰', '➿', '🔚', '🔙', '🔛', '🔝', '🔜', '✔️',
      '➕', '➖', '➗', '✖️', '💲', '💱', '♠️', '♥️', '♦️', '♣️', '🃏', '🀄', '🔯', '⛎', '♈',
    ],
  },
]

/** Deduped per category — insertion order preserved, duplicates dropped. */
export const REACT_ALL: { label: string; emojis: string[] }[] = REACT_ALL_RAW.map(
  (cat) => ({ label: cat.label, emojis: Array.from(new Set(cat.emojis)) })
)

const PILL_H = 46
const GRID_H = 300
const M = 8

export function EmojiReactDrawer({
  anchorEl,
  align = 'left',
  side = 'auto',
  activeEmoji,
  onPick,
  onClose,
}: {
  /** The message element the drawer anchors under. */
  anchorEl: HTMLElement | null
  /** Which edge of the anchor to hug — 'right' for my own messages. */
  align?: 'left' | 'right'
  /** Preferred side: 'auto' (under, flip when no room) | 'below' | 'above'.
   *  Used when another popover (e.g. the room-chat actions menu) already
   *  occupies one side of the message. */
  side?: 'auto' | 'below' | 'above'
  /** The user's current reaction on this message (highlighted). */
  activeEmoji?: string | null
  onPick: (emoji: string) => void
  onClose: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const drawerRef = useRef<HTMLDivElement | null>(null)
  // Latest imperative placement — kept in a ref so the scroll listener (bound
  // once per mount) always repositions with the CURRENT expanded height.
  const placeRef = useRef<() => void>(() => {})

  // Position: under the anchor (flip above when there is no room below),
  // clamped inside the viewport on both axes. A forced side never flips —
  // it clamps (another popover owns the other side). Runs pre-paint and
  // writes top/left/visibility IMPERATIVELY (measure-then-position; no
  // state round-trip) so the drawer never visibly jumps and never detaches.
  useLayoutEffect(() => {
    if (!anchorEl || typeof window === 'undefined') return
    const place = () => {
      const drawer = drawerRef.current
      if (!drawer) return
      const r = anchorEl.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      const dw = Math.min(drawer.offsetWidth || 340, vw - 2 * M)
      const h = expanded ? GRID_H : PILL_H
      let top: number
      const fitsBelow = vh - r.bottom - M > h + 4
      const fitsAbove = r.top - M > h + 4
      if (side === 'below' || (side === 'auto' && fitsBelow)) {
        top = fitsBelow ? r.bottom + 6 : Math.max(M, Math.min(r.bottom + 6, vh - h - M))
      } else if (side === 'above' || (side === 'auto' && fitsAbove)) {
        top = fitsAbove ? r.top - h - 6 : Math.max(M, Math.min(r.top - h - 6, vh - h - M))
      } else {
        top = Math.max(M, Math.min(r.bottom + 6, vh - h - M))
      }
      let left = align === 'right' ? r.right - dw : r.left
      left = Math.max(M, Math.min(left, vw - dw - M))
      drawer.style.top = `${Math.round(top)}px`
      drawer.style.left = `${Math.round(left)}px`
      drawer.style.visibility = 'visible'
    }
    placeRef.current = place
    place()
  }, [anchorEl, align, side, expanded])

  // DISMISSAL RULES — the drawer closes ONLY when:
  //   · the user taps an emoji (onPick → onClose in the buttons), or
  //   · the user taps outside (the full-screen overlay behind it), or
  //   · the anchor message itself scrolled fully out of the viewport /
  //     was removed from the DOM.
  // Scrolling INSIDE the drawer (the expanded emoji grid) is NOT a dismiss —
  // that was the old bug: a capture-phase window scroll listener closed the
  // drawer the moment the grid itself scrolled. Any OTHER scroll (the chat
  // behind, scroll chaining) just RE-POSITIONS the drawer under its anchor
  // (WhatsApp-style follow) instead of dismissing it.
  useEffect(() => {
    if (!anchorEl) return
    const onScroll = (ev: Event) => {
      const t = ev.target
      // Scrolling inside the drawer itself (the emoji grid) — ignore.
      if (drawerRef.current && t instanceof Node && drawerRef.current.contains(t)) return
      // The chat behind scrolled: follow the anchor while it is visible.
      if (!anchorEl.isConnected) {
        onClose()
        return
      }
      const r = anchorEl.getBoundingClientRect()
      if (r.bottom < -32 || r.top > window.innerHeight + 32) {
        onClose()
        return
      }
      placeRef.current()
    }
    const onResize = () => {
      if (!anchorEl.isConnected) {
        onClose()
        return
      }
      placeRef.current()
    }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [anchorEl, onClose])

  if (typeof document === 'undefined' || !anchorEl) return null

  return createPortal(
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 70 }} onClick={onClose} onPointerDown={onClose} />
      <motion.div
        ref={drawerRef}
        role="menu"
        aria-label="React with emoji"
        data-testid="emoji-react-drawer"
        initial={{ opacity: 0, y: 6, scale: 0.86 }}
        animate={{
          opacity: 1,
          y: 0,
          scale: 1,
          height: expanded ? GRID_H : PILL_H,
        }}
        exit={{ opacity: 0, y: 6, scale: 0.86 }}
        transition={{ type: 'spring', stiffness: 420, damping: 26 }}
        style={{
          position: 'fixed',
          zIndex: 71,
        }}
        className="qk-emoji-drawer"
      >
        <AnimatePresence mode="wait" initial={false}>
          {expanded ? (
            <motion.div
              key="grid"
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ duration: 0.14 }}
              className="qk-emoji-grid"
            >
              {REACT_ALL.map((cat) => (
                <div key={cat.label} className="qk-emoji-cat">
                  <p className="qk-emoji-cat-label">{cat.label}</p>
                  <div className="qk-emoji-cat-row">
                    {cat.emojis.map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => {
                          onPick(e)
                          onClose()
                        }}
                        className={`qk-emoji-cell${activeEmoji === e ? ' qk-emoji-cell-on' : ''}`}
                        aria-label={`React ${e}`}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </motion.div>
          ) : (
            <motion.div
              key="pill"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.1 }}
              className="qk-emoji-pill"
            >
              {REACT_QUICK.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => {
                    onPick(e)
                    onClose()
                  }}
                  className={`qk-emoji-quick${activeEmoji === e ? ' qk-emoji-cell-on' : ''}`}
                  aria-label={`React ${e}`}
                >
                  {e}
                </button>
              ))}
              <button
                type="button"
                className="qk-emoji-expand"
                onClick={() => setExpanded(true)}
                aria-label="More emojis"
                aria-expanded={expanded}
                title="More emojis"
              >
                <ChevronDown size={16} strokeWidth={2.6} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </>,
    document.body
  )
}
