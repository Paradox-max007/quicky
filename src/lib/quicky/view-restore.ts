// Quicky — SESSION VIEW PERSISTENCE (the "auto redirect to Discover" fix)
//
// PROBLEM: the app is a single-route SPA whose boot (page.tsx) always paints
// view='discovery' from the cached user. ANY full page reload — mobile
// browsers discarding background tabs, a flaky network triggering a chunk
// reload, an HMR refresh in dev, or a recovered render error — therefore
// dumped the user back on Discover even when they were mid-chat, mid-room
// or deep in Settings. On phones this looked like the app "keeps getting
// redirected to the discover page at intervals".
//
// FIX: remember the last view (+ the context it needs) in localStorage and
// restore it on the next boot. The server stays the authority:
//   · sessions expire / logout clears the saved view,
//   · a short TTL (15 min) never resurrects an ancient screen,
//   · context-dependent views (chat / profile / rooms) only restore when
//     their context (match id, peer, stored room id) still exists,
//   · auth/onboarding/splash are never restored.
//
// The restore runs BEFORE the first paint (page.tsx cache-paint path), so
// the user lands directly on their screen — no Discover flash.

import type { AppView } from '@/store/quicky'

export type PersistedViewState = {
  view: AppView
  /** 'chat' */
  activeMatchId?: string | null
  /** 'profile-view' */
  activeProfileUserId?: string | null
  profileReturnView?: AppView
  /** 'chat' back target */
  chatReturnView?: AppView | null
  /** 'game-chat' peer + back target */
  gameChatPeer?: { peerUserId: string; peerName: string | null; peerAvatar: string | null } | null
  gameChatReturnView?: AppView
  /** room chat sidebar section (web) */
  roomChatPanel?: 'room' | 'contacts' | 'personal' | 'dating'
  savedAt: number
}

const KEY = 'quicky_session_view_v1'

/** Views that must never be persisted or restored. */
const NEVER_RESTORE: AppView[] = ['splash', 'auth', 'onboarding']

/** A saved view older than this is ignored (the user has moved on). */
export const VIEW_RESTORE_TTL_MS = 15 * 60 * 1000

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

export function persistViewState(state: PersistedViewState): void {
  const ls = safeLocalStorage()
  if (!ls) return
  if (NEVER_RESTORE.includes(state.view)) {
    // Sitting on auth/onboarding — drop any previously saved view so a
    // later login starts clean (AuthScreen lands on Discover by design).
    try {
      ls.removeItem(KEY)
    } catch {}
    return
  }
  try {
    ls.setItem(KEY, JSON.stringify(state))
  } catch {}
}

export function clearPersistedViewState(): void {
  const ls = safeLocalStorage()
  if (!ls) return
  try {
    ls.removeItem(KEY)
  } catch {}
}

export function readPersistedViewState(): PersistedViewState | null {
  const ls = safeLocalStorage()
  if (!ls) return null
  try {
    const raw = ls.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedViewState
    if (!parsed || typeof parsed !== 'object' || !parsed.view) return null
    if (NEVER_RESTORE.includes(parsed.view)) return null
    if (typeof parsed.savedAt !== 'number' || Date.now() - parsed.savedAt > VIEW_RESTORE_TTL_MS) {
      ls.removeItem(KEY)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

/**
 * Can this saved view be restored, given what still exists on the device?
 * Context-bearing views are only restored when their context survived
 * (stored room ids, match id, peer…); everything else restores directly.
 */
export function canRestoreView(
  state: PersistedViewState,
  ctx: { hasSpinRoom: boolean; hasLudoRoom: boolean }
): boolean {
  if (NEVER_RESTORE.includes(state.view)) return false
  switch (state.view) {
    case 'chat':
      return !!state.activeMatchId
    case 'profile-view':
      return !!state.activeProfileUserId
    case 'game-chat':
      return !!state.gameChatPeer?.peerUserId
    case 'spin-bottle-room':
      // The room runtime restore (AppRoot) needs a stored room id; without
      // one the view would fall back to the join landing — cleaner to skip.
      return ctx.hasSpinRoom
    case 'ludo-room':
      return ctx.hasLudoRoom
    default:
      return true
  }
}
