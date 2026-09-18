'use client'

// Quicky — GAME INTERACTION PANEL (Unified Game Primary Screen PRD §19-§30,
// revised §v2 desktop architecture: 3-column layout)
//
// The WEB multi-purpose interaction area that REPLACES the old bottom Game
// Chats section (§11). It behaves like a small application inside the Game
// Primary Screen (§29):
//
//   CHAT  ──────────→ CONTACTS ──→ PERSONAL CHAT
//   FRIENDS ────────→ FRIEND LIST ──→ FRIEND PROFILE ──→ (chat)
//
// TWO presentation variants (v2 §3):
// · variant="overlay" (default) — narrow web viewports. Closed until the user
//   taps 💬 / 👥 (§21); opens as a floating panel in the content flow.
// · variant="column" — DESKTOP (lg+). Rendered persistently inside one of the
//   TWO social columns beside the main profile column (GAME CHATS | MY
//   FRIENDS). The root view is PERMANENT: Back from a personal chat returns
//   to the contact list, Back from a friend profile returns to the friends
//   list — the column never closes (there is no close button).
//
// ── Key contracts ────────────────────────────────────────────────────────────
// · §19/§22: on web this is NOT a page — the Game Primary Screen stays
//   mounted and visible; only the panel/column content transitions.
// · §37: interaction views closed | chat | personalChat | friends |
//   friendProfile, driven by a lightweight LOCAL stack (§39) so nested back
//   navigation is predictable (§38: Friends→Profile→Back returns to Friends,
//   Chat→Personal Chat→Back returns to Chat).
// · §30: transitions are subtle fade + slide via the EXISTING Framer Motion
//   dependency — no new animation library.
// · §34/§52/§53: everything reuses the existing chat/friends systems —
//   the shared game-chat store, GameChatScreen, GET /friends.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useGameChatStore } from '@/store/game-chat'
import { GameChatContacts } from './GameChatContacts'
import { GameFriendsList, type GameFriendRow } from './GameFriendsList'
import { GameFriendProfile } from './GameFriendProfile'
import { GameChatScreen } from '../game-chat/GameChatScreen'

// §37 — the web interaction view state machine
type GameInteractionView = 'closed' | 'chat' | 'personalChat' | 'friends' | 'friendProfile'

type InteractionState =
  | { view: 'chat' }
  | { view: 'personalChat'; peerLabel: string | null }
  | { view: 'friends' }
  | { view: 'friendProfile'; friendId: string; friendName: string | null; friendPhoto: string | null }

const VIEW_LABEL: Record<Exclude<GameInteractionView, 'closed'>, string> = {
  chat: 'Game Chats',
  personalChat: 'Chat',
  friends: 'Friends',
  friendProfile: 'Profile',
}

export type GameInteractionPanelHandle = {
  /** Imperative open for the 💬 / 👥 icons (§22/§25). Resets the stack to
   * the requested root view — opening Chat while Friends is open swaps the
   * panel content, matching the icon-first mental model. */
  open: (view: 'chat' | 'friends') => void
}

type GameInteractionPanelProps = {
  /** v2 §3 — `overlay` (default): narrow viewports, closed until opened via
   * the 💬 / 👥 icons. `column`: persistent desktop social column with a
   * pinned root view that never closes. */
  variant?: 'overlay' | 'column'
  /** Required for `column` — the permanent root view of the column. */
  rootView?: 'chat' | 'friends'
}

export const GameInteractionPanel = forwardRef<GameInteractionPanelHandle, GameInteractionPanelProps>(
function GameInteractionPanel({ variant = 'overlay', rootView }, ref) {
  // v2 §3 — column variant pins a permanent root view (chat | friends).
  const isColumn = variant === 'column' && !!rootView
  // §39 — lightweight internal navigation stack; back = history.pop()
  const [stack, setStack] = useState<InteractionState[]>(() =>
    isColumn ? [rootView === 'friends' ? { view: 'friends' } : { view: 'chat' }] : []
  )
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')
  const inPersonalChatRef = useRef(false)

  const current: InteractionState | null = stack.length > 0 ? stack[stack.length - 1] : null
  const view: GameInteractionView = current?.view ?? 'closed'

  // v2 §5 — the GAME CHATS column header carries the shared unread badge.
  const chatList = useGameChatStore((s) => s.list)
  const totalUnread = chatList.reduce((s, c) => s + (c.unread || 0), 0)

  useImperativeHandle(ref, () => ({
    open: (root: 'chat' | 'friends') => {
      setDirection('forward')
      setStack((prev) => {
        // An open personal chat must be torn down before swapping roots.
        if (prev.some((s) => s.view === 'personalChat')) useGameChatStore.getState().closeConversation()
        return [root === 'chat' ? { view: 'chat' } : { view: 'friends' }]
      })
    },
  }))

  const push = useCallback((state: InteractionState) => {
    setDirection('forward')
    setStack((prev) => [...prev, state])
  }, [])

  const pop = useCallback(() => {
    setDirection('back')
    setStack((prev) => {
      const next = prev.slice(0, -1)
      // v2 §3 — column variant: the root view is PERMANENT. Back from a
      // personal chat restores the contact list; back from a friend profile
      // restores the friends list — the column itself never closes.
      if (next.length === 0 && rootView) {
        return [rootView === 'friends' ? { view: 'friends' } : { view: 'chat' }]
      }
      return next
    })
  }, [rootView])

  const close = useCallback(() => {
    setDirection('back')
    setStack([])
  }, [])

  // Leaving the panel (or the whole screen) with an open personal chat must
  // tear the conversation state down — the shared store stays the single
  // source of truth (§34).
  useEffect(() => {
    inPersonalChatRef.current = view === 'personalChat'
  }, [view])
  useEffect(() => {
    return () => {
      if (inPersonalChatRef.current) useGameChatStore.getState().closeConversation()
    }
  }, [])

  const openPersonalChat = useCallback(
    (peer: { peerUserId: string; peerName: string | null; peerAvatar: string | null }) => {
      // Existing messaging entry path — no new service (§34).
      useGameChatStore.getState().openConversation(peer)
      push({ view: 'personalChat', peerLabel: peer.peerName ?? null })
    },
    [push]
  )

  const slide = direction === 'forward' ? 26 : -26
  const exit = direction === 'forward' ? -26 : 26

  return (
    <div
      className={isColumn ? 'w-full h-full min-h-0' : 'w-full flex justify-center'}
      data-testid={isColumn ? `game-primary-${rootView}-column` : 'game-interaction-panel'}
    >
      <AnimatePresence mode="wait">
        {/* §21: closed → nothing occupies the screen (overlay variant only —
            the column variant pins its root, so current is never null). */}
        {current && (
          <motion.div
            key="panel-shell"
            initial={{ opacity: 0, y: isColumn ? 0 : 14, scale: isColumn ? 1 : 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.985 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className={
              isColumn
                ? 'w-full h-full rounded-3xl border border-white/10 bg-[var(--qk-card)]/70 backdrop-blur overflow-hidden flex flex-col shadow-2xl'
                : 'w-full max-w-md h-[500px] max-h-[68vh] rounded-3xl border border-white/10 bg-[var(--qk-card)]/70 backdrop-blur overflow-hidden flex flex-col shadow-2xl'
            }
          >
            {/* Panel header — hidden for personalChat (GameChatScreen has its
                own §33 header with back). The column variant has NO close
                button: the social columns are permanent desktop furniture. */}
            {current.view !== 'personalChat' && (
              <div className="shrink-0 flex items-center gap-2 px-4 pt-3.5 pb-2.5 border-b border-white/10">
                <p className="font-black text-sm text-white">{VIEW_LABEL[current.view]}</p>
                {isColumn && rootView === 'chat' && totalUnread > 0 && (
                  <span
                    className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-coral-gradient text-[10px] font-black text-white flex items-center justify-center"
                    aria-label={`${totalUnread} unread messages`}
                    data-testid="game-primary-chat-column-unread"
                  >
                    {totalUnread > 9 ? '9+' : totalUnread}
                  </span>
                )}
                {!isColumn && (
                  <button
                    onClick={close}
                    className="ml-auto w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center"
                    aria-label="Close panel"
                    data-testid="panel-close"
                  >
                    <X className="w-4 h-4 text-white/70" />
                  </button>
                )}
              </div>
            )}

            {/* §30: content transitions — fade + soft horizontal slide */}
            <div className="flex-1 min-h-0 relative overflow-hidden">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={stackKey(current)}
                  initial={{ opacity: 0, x: slide }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: exit }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className="absolute inset-0"
                >
                  {current.view === 'chat' && (
                    <GameChatContacts
                      onPick={(row) => openPersonalChat({ peerUserId: row.peer.id, peerName: row.peer.name, peerAvatar: row.peer.avatar })}
                    />
                  )}

                  {current.view === 'personalChat' && (
                    // §23: the EXISTING personal chat experience, embedded in
                    // the same area — realtime, replies, reactions, stickers,
                    // unread state all keep working (§52).
                    <div className="h-full w-full" data-testid="panel-personal-chat">
                      <GameChatScreen
                        onBack={() => {
                          useGameChatStore.getState().closeConversation()
                          pop()
                        }}
                      />
                    </div>
                  )}

                  {current.view === 'friends' && (
                    <GameFriendsList
                      testIdPrefix="panel-friends"
                      onOpenProfile={(f: GameFriendRow) =>
                        push({ view: 'friendProfile', friendId: f.id, friendName: f.name ?? null, friendPhoto: f.photo ?? null })
                      }
                      onOpenChat={(f: GameFriendRow) =>
                        openPersonalChat({ peerUserId: f.id, peerName: f.name ?? null, peerAvatar: f.photo ?? null })
                      }
                    />
                  )}

                  {current.view === 'friendProfile' && (
                    <GameFriendProfile
                      friendId={current.friendId}
                      fallbackName={current.friendName}
                      fallbackPhoto={current.friendPhoto}
                      onBack={pop}
                      onMessage={openPersonalChat}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
)

function stackKey(state: InteractionState): string {
  switch (state.view) {
    case 'personalChat':
      return 'personalChat'
    case 'friendProfile':
      return `friendProfile:${state.friendId}`
    default:
      return state.view
  }
}