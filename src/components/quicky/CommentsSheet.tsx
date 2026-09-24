'use client'

// Quicky — shared comment sheet for community posts & rolls
//
// Per-comment actions (community post comments):
//   · your OWN comment          → ⋯ menu: Delete
//   · someone else's comment    → ⋯ menu: Report
//   · the POST OWNER on someone else's comment → ⋯ menu: Delete, Report,
//     and "Ban from commenting" (with a confirmation modal — the ban covers
//     ALL of the owner's posts, past and future, enforced server-side).
//   · a BANNED viewer           → the composer is hidden entirely
// Your own comments show a "(you)" tag next to the name.
//
// While the mobile sheet variant is open, the app's bottom nav hides and the
// sheet uses that space (store flag commentsSheetOpen — see AppRoot).
//
// Used by: CommunityScreen (mobile sheet), CommunityDesktop (desktop panel)
// and RollsViewer (mobile sheet). Rolls pass no action handlers → no ⋯ menus
// there, but the (you) tag still applies. The desktop panel is portaled to
// <body> and sized to the screen below the topbar (see the panel branch).

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { X, SendHorizontal, MoreVertical, Trash2, Flag, Ban, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { timeAgo } from '@/lib/quicky/filters'
import { useQuickyStore } from '@/store/quicky'

export type CommentItem = {
  id: string
  text: string
  createdAt: string | Date
  author: { id: string; name: string | null; avatar: string | null }
}

/** Server-verified viewer context for comment actions + ban state. */
export type CommentsViewerContext = {
  /** the viewer's own user id (drives the "(you)" tag + menu roles) */
  id?: string | null
  /** viewer authored / co-owns the post → Delete + Report + Ban options */
  isOwner?: boolean
  /** an owner of this post banned the viewer → composer hidden */
  isBanned?: boolean
  /** post owner's display name (for the banned hint) */
  ownerName?: string | null
}

/** load() may return a plain list (rolls) or a list + viewer context (posts). */
export type CommentsLoadResult = CommentItem[] | { comments: CommentItem[]; context?: CommentsViewerContext }

type MenuOption = {
  label: string
  icon: React.ReactNode
  danger?: boolean
  run: () => void | Promise<void>
}

export function Avatar({
  src,
  name,
  size = 36,
  onClick,
}: {
  src?: string | null
  name?: string | null
  size?: number
  onClick?: () => void
}) {
  const initials = (name ?? '?').slice(0, 1).toUpperCase()
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className="shrink-0 rounded-full bg-gradient-to-br from-[var(--qk-accent)] to-[var(--qk-purple)] flex items-center justify-center overflow-hidden disabled:cursor-default"
      style={{ width: size, height: size }}
      aria-label={name ? `${name}'s profile` : 'Avatar'}
    >
      {src ? (
        <img src={src} alt="" className="w-full h-full object-cover" />
      ) : (
        <span className="text-white font-semibold" style={{ fontSize: size * 0.4 }}>
          {initials}
        </span>
      )}
    </button>
  )
}

export function CommentsSheet({
  title,
  load,
  send,
  onClose,
  onCountChange,
  lockedHint,
  meId,
  deleteComment,
  reportComment,
  banCommenter,
  onCommentDeleted,
  variant = 'sheet',
}: {
  title: string
  load: () => Promise<CommentsLoadResult>
  send: (text: string) => Promise<CommentItem>
  onClose: () => void
  onCountChange?: (n: number) => void
  lockedHint?: string | null
  /** The viewer's user id (fallback when the server context doesn't carry it). */
  meId?: string | null
  /** Provided → ⋯ menus can offer Delete (allowed for own comments and, when
   *  the viewer owns the post, for any comment on it). */
  deleteComment?: (commentId: string) => Promise<void> | void
  /** Provided → ⋯ menus can offer Report on other people's comments. */
  reportComment?: (comment: CommentItem) => Promise<void> | void
  /** Provided (+ viewer owns the post) → ⋯ menus offer "Ban from commenting". */
  banCommenter?: (commentId: string) => Promise<void> | void
  /** Fires after a comment was removed from the list (caller updates counts). */
  onCommentDeleted?: (commentId: string) => void
  /** 'sheet' = mobile bottom sheet (nav hides, full-height feel). 'panel' =
   *  desktop right drawer (Web Premium PRD §24: a premium comments panel). */
  variant?: 'sheet' | 'panel'
}) {
  const [comments, setComments] = useState<CommentItem[]>([])
  const [context, setContext] = useState<CommentsViewerContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  // ⋯ menu state — the anchor is the ⋯ button of a comment chip
  const [menuFor, setMenuFor] = useState<{ comment: CommentItem; anchorEl: HTMLElement } | null>(null)
  // ban confirmation target
  const [banTarget, setBanTarget] = useState<CommentItem | null>(null)
  const [banning, setBanning] = useState(false)

  const setCommentsSheetOpen = useQuickyStore((s) => s.setCommentsSheetOpen)

  // While the mobile sheet is open the bottom nav hides and the sheet uses
  // that space (AppRoot reads the flag). The cleanup runs when the sheet has
  // fully exited (AnimatePresence keeps the child mounted during exit), so
  // the nav returns exactly as the sheet finishes sliding away.
  useEffect(() => {
    if (variant !== 'sheet') return
    setCommentsSheetOpen(true)
    return () => setCommentsSheetOpen(false)
  }, [variant, setCommentsSheetOpen])

  useEffect(() => {
    ;(async () => {
      try {
        const res = await load()
        if (Array.isArray(res)) {
          setComments(res)
          setContext(null)
        } else {
          setComments(res.comments)
          setContext(res.context ?? null)
        }
      } catch {
        toast.error('Could not load comments')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const viewerId = context?.id ?? meId ?? null
  const iAmOwner = !!context?.isOwner
  // Banned by an owner of this post → no composer (server-verified state)
  const bannedHint = context?.isBanned
    ? `You can no longer comment on ${context.ownerName ?? 'this user'}’s posts.`
    : null
  const effectiveLocked = lockedHint ?? bannedHint

  const submit = async () => {
    const t = text.trim()
    if (!t || sending || effectiveLocked) return
    setSending(true)
    try {
      const c = await send(t)
      setComments((prev) => {
        const next = [...prev, c]
        onCountChange?.(next.length)
        return next
      })
      setText('')
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }))
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to comment')
    } finally {
      setSending(false)
    }
  }

  // ─── comment actions ────────────────────────────────────────────────────
  const doDelete = async (c: CommentItem) => {
    if (!deleteComment) return
    try {
      await deleteComment(c.id)
      setComments((prev) => {
        const next = prev.filter((x) => x.id !== c.id)
        onCountChange?.(next.length)
        return next
      })
      onCommentDeleted?.(c.id)
      toast.success('Comment deleted')
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to delete comment')
    }
  }

  const doReport = async (c: CommentItem) => {
    if (!reportComment) return
    try {
      await reportComment(c)
      toast.success('Comment reported — our team will review it')
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to report comment')
    }
  }

  const doBan = async () => {
    if (!banTarget || !banCommenter) return
    setBanning(true)
    try {
      await banCommenter(banTarget.id)
      toast.success(`${banTarget.author.name ?? 'User'} can no longer comment on your posts`)
      setBanTarget(null)
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to ban user')
    } finally {
      setBanning(false)
    }
  }

  // Role-based ⋯ options per the spec:
  //   own comment → Delete · others' → Report · owner on others' → Delete +
  //   Report + Ban. The menu button only renders when there IS an option.
  const menuOptionsFor = (c: CommentItem): MenuOption[] => {
    const isMine = !!viewerId && c.author.id === viewerId
    const opts: MenuOption[] = []
    if (isMine && deleteComment) {
      opts.push({ label: 'Delete comment', icon: <Trash2 className="w-4 h-4" />, danger: true, run: () => doDelete(c) })
    } else if (!isMine) {
      if (deleteComment && iAmOwner) {
        opts.push({ label: 'Delete comment', icon: <Trash2 className="w-4 h-4" />, danger: true, run: () => doDelete(c) })
      }
      if (reportComment) {
        opts.push({ label: 'Report comment', icon: <Flag className="w-4 h-4" />, run: () => doReport(c) })
      }
      if (banCommenter && iAmOwner) {
        opts.push({
          label: `Ban ${(c.author.name ?? 'user').split(' ')[0]} from commenting`,
          icon: <Ban className="w-4 h-4" />,
          danger: true,
          run: () => setBanTarget(c),
        })
      }
    }
    return opts
  }

  // §24: on desktop the comments render as a side panel next to the feed —
  // same content, premium drawer treatment instead of a bottom sheet.
  //
  // The overlay is PORTALED to <body> and anchored BETWEEN THE TOP NAV and
  // the bottom of the screen (top = --qk-nav-h, bottom = 0):
  //   · the desktop page shells run a fill-mode entrance animation on the
  //     page wrapper (.qk-page-enter); a transformed ancestor captures
  //     position:fixed descendants, which made this panel size itself to the
  //     whole feed document (viewport overflow). Body-level fixed is immune
  //     to any ancestor transform/filter (same pattern as CommentMenu and
  //     the CoinStoreModal).
  //   · top+bottom anchoring (no h-full) pins the panel to EXACTLY the screen
  //     height minus the 56px topbar at every window size — the topbar stays
  //     visible and clickable while comments are open.
  if (variant === 'panel') {
    const overlay = (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        // starts BELOW the topbar — the nav remains the live primary nav
        // (Web Premium §2/§3) while comments are open
        className="fixed left-0 right-0 bottom-0 top-[var(--qk-nav-h,0px)] z-[120] bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
        data-testid="comments-panel-backdrop"
      >
        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', stiffness: 340, damping: 36 }}
          className="fixed right-0 top-[var(--qk-nav-h,0px)] bottom-0 w-[400px] max-w-[90%] bg-[var(--qk-bg)] border-l border-white/10 shadow-2xl flex flex-col"
          onClick={(e) => e.stopPropagation()}
          data-testid="comments-panel"
        >
          <div className="px-4 pt-4 pb-2 flex items-center justify-between">
            <h3 className="font-bold">{title}</h3>
            <button onClick={onClose} className="p-1.5 rounded-full bg-white/5 hover:bg-white/10" aria-label="Close comments">
              <X className="w-4 h-4" />
            </button>
          </div>
          <CommentList
            comments={comments}
            loading={loading}
            listRef={listRef}
            viewerId={viewerId}
            menuFor={menuFor}
            setMenuFor={setMenuFor}
            menuOptionsFor={menuOptionsFor}
            desktop
          />
          <div className="shrink-0 p-3 border-t border-white/10">
            <CommentComposer
              text={text}
              setText={setText}
              submit={submit}
              sending={sending}
              lockedHint={effectiveLocked}
            />
          </div>
        </motion.div>
      </motion.div>
    )
    return typeof document === 'undefined' ? null : createPortal(overlay, document.body)
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-[120] flex items-end bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 320, damping: 34 }}
        // 80% height: the bottom nav hides while the sheet is open, so the
        // comment section takes the extra space too
        className="w-full h-[80%] bg-[var(--qk-bg)] rounded-t-3xl border-t border-white/10 flex flex-col relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Grab handle */}
        <div className="pt-2 pb-1 flex justify-center">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>
        <div className="px-4 pb-2 flex items-center justify-between">
          <h3 className="font-bold">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-full bg-white/5 hover:bg-white/10" aria-label="Close comments">
            <X className="w-4 h-4" />
          </button>
        </div>

        <CommentList
          comments={comments}
          loading={loading}
          listRef={listRef}
          viewerId={viewerId}
          menuFor={menuFor}
          setMenuFor={setMenuFor}
          menuOptionsFor={menuOptionsFor}
        />

        {/* Composer — hidden server-verified for banned viewers */}
        <div className="safe-area-bottom shrink-0 p-3 border-t border-white/10">
          <CommentComposer
            text={text}
            setText={setText}
            submit={submit}
            sending={sending}
            lockedHint={effectiveLocked}
          />
        </div>

        {/* ─── Ban confirmation modal ─────────────────────────────────── */}
        {banTarget && (
          <div
            className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-6"
            onClick={() => !banning && setBanTarget(null)}
            role="dialog"
            aria-modal="true"
            aria-label="Ban user from commenting"
          >
            <div
              className="w-full max-w-sm bg-[var(--qk-card)] border border-white/10 rounded-3xl p-6 shadow-2xl text-center"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-14 h-14 rounded-full bg-[#FF3B30]/15 flex items-center justify-center text-[#FF3B30] mx-auto mb-4">
                <Ban className="w-7 h-7" />
              </div>
              <h3 className="text-lg font-bold text-white mb-1.5">Ban from commenting?</h3>
              <p className="text-sm text-white/60 mb-6 leading-relaxed">
                <span className="font-semibold text-white/85">{banTarget.author.name ?? 'This user'}</span> won&apos;t be
                able to comment on any of your posts — past or future. They can still comment on other people&apos;s posts.
              </p>
              <div className="flex w-full gap-3">
                <button
                  type="button"
                  onClick={() => setBanTarget(null)}
                  disabled={banning}
                  className="flex-1 py-3 rounded-2xl bg-white/5 hover:bg-white/10 text-sm font-semibold text-white/80 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={doBan}
                  disabled={banning}
                  className="flex-1 py-3 rounded-2xl bg-[#FF3B30] hover:bg-[#FF3B30]/90 text-sm font-semibold text-white flex items-center justify-center gap-2 active:scale-95 transition-all shadow-lg shadow-[#FF3B30]/20 disabled:opacity-50"
                >
                  {banning ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Banning...
                    </>
                  ) : (
                    'Ban'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}

/** Shared comments list — one row component for the sheet AND the panel. */
function CommentList({
  comments,
  loading,
  listRef,
  viewerId,
  menuFor,
  setMenuFor,
  menuOptionsFor,
  desktop,
}: {
  comments: CommentItem[]
  loading: boolean
  listRef: React.RefObject<HTMLDivElement | null>
  viewerId: string | null
  menuFor: { comment: CommentItem; anchorEl: HTMLElement } | null
  setMenuFor: (v: { comment: CommentItem; anchorEl: HTMLElement } | null) => void
  menuOptionsFor: (c: CommentItem) => MenuOption[]
  desktop?: boolean
}) {
  return (
    <div
      ref={listRef}
      className={`flex-1 min-h-0 overflow-y-auto ${desktop ? 'qk-desk-scroll' : 'no-scrollbar'} px-4 py-2 flex flex-col gap-3`}
    >
      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-8 h-8 rounded-full border-2 border-[var(--qk-accent)] border-t-transparent animate-spin" />
        </div>
      ) : comments.length === 0 ? (
        <p className="text-center text-sm text-white/40 py-8">No comments yet. Be the first!</p>
      ) : (
        comments.map((c) => {
          const isMine = !!viewerId && c.author.id === viewerId
          const options = menuOptionsFor(c)
          const isMenuOpen = menuFor?.comment.id === c.id
          return (
            <div key={c.id} className="flex items-start gap-2.5">
              <Avatar src={c.author.avatar} name={c.author.name} size={32} />
              <div className="flex-1 min-w-0">
                <div className="bg-white/5 rounded-2xl rounded-tl-md px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-semibold text-white/90 truncate">
                      {c.author.name ?? 'Someone'}
                      {isMine && <span className="ml-1 text-[10px] font-bold text-[var(--qk-accent)]">(you)</span>}
                    </p>
                    {/* ⋯ per-comment actions (right corner of the chip) */}
                    {options.length > 0 && (
                      <button
                        type="button"
                        className={`ml-auto shrink-0 w-6 h-6 -mr-1 flex items-center justify-center rounded-full ${
                          isMenuOpen ? 'bg-white/15 text-white' : 'text-white/40 hover:text-white/85 hover:bg-white/10'
                        } transition-colors`}
                        aria-label={`Comment options for ${c.author.name ?? 'user'}`}
                        data-testid={`comment-more-${c.id}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (isMenuOpen) setMenuFor(null)
                          else setMenuFor({ comment: c, anchorEl: e.currentTarget })
                        }}
                      >
                        <MoreVertical className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <p className="text-sm text-white/80 break-words">{c.text}</p>
                </div>
                <p className="text-[10px] text-white/30 mt-0.5 ml-1">{timeAgo(c.createdAt)}</p>
              </div>
            </div>
          )
        })
      )}

      {/* The anchored ⋯ popover — portaled to <body> so the scrolling list
          can never clip it; closes on outside tap, list scroll or action. */}
      {menuFor && <CommentMenu anchorEl={menuFor.anchorEl} options={menuOptionsFor(menuFor.comment)} onClose={() => setMenuFor(null)} />}
    </div>
  )
}

/** The ⋯ popover, anchored under the comment chip's ⋯ button. */
function CommentMenu({
  anchorEl,
  options,
  onClose,
}: {
  anchorEl: HTMLElement
  options: MenuOption[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)

  // Measure-then-position (pre-paint, imperative DOM writes — no state round
  // trip): under the ⋯ button, flip above when there is no room, clamped to
  // the viewport on both axes. The menu stays visibility:hidden until placed
  // so it never visibly jumps.
  useLayoutEffect(() => {
    const menu = ref.current
    if (!menu) return
    const r = anchorEl.getBoundingClientRect()
    const mw = menu.offsetWidth || 210
    const mh = menu.offsetHeight || options.length * 42 + 8
    let top = r.bottom + 4
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4)
    let left = r.right - mw
    left = Math.max(8, Math.min(left, window.innerWidth - mw - 8))
    menu.style.top = `${Math.round(top)}px`
    menu.style.left = `${Math.round(left)}px`
    menu.style.visibility = 'visible'
  }, [anchorEl, options.length])

  // The list scrolled → the anchored popover must not detach → close.
  useEffect(() => {
    const onScroll = (ev: Event) => {
      const t = ev.target
      if (ref.current && t instanceof Node && ref.current.contains(t)) return
      onClose()
    }
    window.addEventListener('scroll', onScroll, true)
    return () => window.removeEventListener('scroll', onScroll, true)
  }, [onClose])

  if (typeof document === 'undefined') return null

  return createPortal(
    <>
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 130 }}
        onClick={onClose}
        onPointerDown={onClose}
        aria-hidden
      />
      <div
        ref={ref}
        data-testid="comment-menu"
        className="fixed z-[131] min-w-[200px] py-1.5 px-1.5 rounded-2xl bg-[var(--qk-elev)] border border-white/12 shadow-[0_14px_36px_rgba(0,0,0,0.55)] flex flex-col gap-0.5"
        style={{ visibility: 'hidden', top: -9999, left: -9999 }}
        role="menu"
      >
        {options.map((o) => (
          <button
            key={o.label}
            type="button"
            role="menuitem"
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[12.5px] font-semibold text-left transition-colors ${
              o.danger ? 'text-[#FF6B6B] hover:bg-[#FF3B30]/12' : 'text-white/90 hover:bg-white/8'
            }`}
            onClick={(e) => {
              e.stopPropagation()
              onClose()
              void o.run()
            }}
          >
            {o.icon}
            {o.label}
          </button>
        ))}
      </div>
    </>,
    document.body
  )
}

/** Shared composer (locked hint replaces the input when present). */
function CommentComposer({
  text,
  setText,
  submit,
  sending,
  lockedHint,
}: {
  text: string
  setText: (t: string) => void
  submit: () => void
  sending: boolean
  lockedHint?: string | null
}) {
  return (
    <>
      {lockedHint ? (
        <p className="text-center text-xs text-[var(--qk-gold)] py-2">{lockedHint}</p>
      ) : (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="Add a comment..."
            maxLength={500}
            className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-full px-4 py-2.5 text-sm placeholder:text-white/30 focus:outline-none focus:border-[var(--qk-accent)]/50"
            aria-label="Write a comment"
          />
          <button
            onClick={submit}
            disabled={!text.trim() || sending}
            className="shrink-0 w-10 h-10 rounded-full bg-coral-gradient text-white disabled:opacity-30 active:scale-95 transition-all flex items-center justify-center"
            aria-label="Send comment"
          >
            <SendHorizontal className="w-[18px] h-[18px]" />
          </button>
        </div>
      )}
    </>
  )
}
