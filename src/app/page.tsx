'use client'

import { useEffect } from 'react'
import { useQuickyStore, type AppView } from '@/store/quicky'
import { api } from '@/lib/quicky/api-client'
import { PhoneFrame } from '@/components/quicky/PhoneFrame'
import { AppRoot } from '@/components/quicky/AppRoot'
import { initSafeArea } from '@/lib/quicky/safe-area'
import { cacheGet, cacheSet, cacheRemove } from '@/lib/quicky/cache'
import {
  persistViewState,
  readPersistedViewState,
  clearPersistedViewState,
  canRestoreView,
} from '@/lib/quicky/view-restore'

// Calibrate the safe-area model BEFORE first render on the client (no-op on
// the server — see lib/quicky/safe-area.ts).
initSafeArea()

/**
 * SESSION VIEW RESTORE (the "auto redirect to Discover" fix): apply a saved
 * view (plus the context it needs — match id, peer, room ids) through the
 * store's own navigation actions so the first paint after a reload is the
 * screen the user was actually on, not always Discover. Context first,
 * view LAST, so AppRoot only ever renders the final destination.
 */
function applyRestoredView(state: ReturnType<typeof readPersistedViewState>): boolean {
  if (!state) return false
  const qk = useQuickyStore.getState()
  const storedSpinRoom = (() => {
    try {
      return localStorage.getItem('quicky_room_id')
    } catch {
      return null
    }
  })()
  const storedLudoRoom = (() => {
    try {
      return localStorage.getItem('quicky_ludo_room_id')
    } catch {
      return null
    }
  })()
  if (!canRestoreView(state, { hasSpinRoom: !!storedSpinRoom, hasLudoRoom: !!storedLudoRoom })) {
    return false
  }

  // Context first (room ids / chat / profile / peer), view LAST.
  if (state.view === 'spin-bottle-room' && storedSpinRoom) {
    qk.setSpinBottleRoomId(storedSpinRoom)
  }
  if (state.view === 'ludo-room' && storedLudoRoom) {
    qk.setLudoRoomId(storedLudoRoom)
  }
  if (state.view === 'chat' && state.activeMatchId) {
    qk.openChat(state.activeMatchId, state.chatReturnView ?? undefined)
  }
  if (state.view === 'profile-view' && state.activeProfileUserId) {
    qk.openProfile(state.activeProfileUserId, state.profileReturnView ?? undefined)
  }
  if (state.view === 'game-chat' && state.gameChatPeer?.peerUserId) {
    qk.openGameChat(state.gameChatPeer, state.gameChatReturnView ?? 'spin-bottle')
  }
  if (state.roomChatPanel) {
    qk.setRoomChatPanel(state.roomChatPanel)
  }
  const view = state.view as AppView
  qk.setView(view)
  return true
}

/** Keep the session view on the device whenever the user navigates. */
function watchAndPersistView(): () => void {
  let lastSig = ''
  return useQuickyStore.subscribe((s) => {
    if (s.view === 'auth' || s.view === 'onboarding' || s.view === 'splash') {
      if (lastSig) clearPersistedViewState()
      lastSig = ''
      return
    }
    // Signature covers the view AND the context-bearing fields, so e.g.
    // switching conversations (same 'chat' view, new match id) re-saves.
    const sig = [
      s.view,
      s.activeMatchId ?? '',
      s.activeProfileUserId ?? '',
      s.gameChatPeer?.peerUserId ?? '',
      s.roomChatPanel,
    ].join('|')
    if (sig === lastSig) return
    lastSig = sig
    persistViewState({
      view: s.view,
      activeMatchId: s.activeMatchId,
      activeProfileUserId: s.activeProfileUserId,
      profileReturnView: s.profileReturnView,
      chatReturnView: s.chatReturnView,
      gameChatPeer: s.gameChatPeer,
      gameChatReturnView: s.gameChatReturnView,
      roomChatPanel: s.roomChatPanel,
      savedAt: Date.now(),
    })
  })
}

export default function Home() {
  const setUser = useQuickyStore((s) => s.setUser)
  const setView = useQuickyStore((s) => s.setView)
  const setHydrated = useQuickyStore((s) => s.setHydrated)
  const user = useQuickyStore((s) => s.user)
  const view = useQuickyStore((s) => s.view)

  // Persist the live view for the next session (single subscription for the
  // app's whole lifetime — page.tsx never unmounts).
  useEffect(() => watchAndPersistView(), [])

  // On mount: fetch current user (if logged in).
  // LOCAL-BOOT (Capacitor / repeat visits): the last session's user is cached
  // in localStorage, so the app paints its real screens INSTANTLY instead of
  // the loading splash, then the server response reconciles (still the only
  // authority — a logged-out answer clears the cache and lands on auth).
  // SESSION VIEW RESTORE: when a saved view exists it is applied instead of
  // the hard-coded Discover — reloads (tab discard, network chunk retry,
  // dev HMR) land the user back where they were.
  useEffect(() => {
    let cancelled = false
    let paintedFromCache = false

    // Instant paint from the device cache (stale is fine for the first frame).
    const cachedUser = cacheGet<any>('user_cache_v1', { allowStale: true })
    if (cachedUser?.id) {
      paintedFromCache = true
      setUser(cachedUser)
      if (!cachedUser.onboardedAt) {
        setView('onboarding')
      } else if (!applyRestoredView(readPersistedViewState())) {
        setView('discovery')
      }
      setHydrated(true)
    }

    ;(async () => {
      try {
        const res = await api.auth.me()
        if (cancelled) return
        if (res.user) {
          setUser(res.user)
          if (!res.user.onboardedAt) setView('onboarding')
          else if (!paintedFromCache && !applyRestoredView(readPersistedViewState())) setView('discovery')
          cacheSet('user_cache_v1', res.user)
        } else {
          cacheRemove('user_cache_v1')
          clearPersistedViewState()
          setView('auth')
        }
      } catch (e) {
        // Offline (Capacitor app with no server reach): keep the cached
        // session painted; only a definitive logged-out answer logs out.
        if (!paintedFromCache) setView('auth')
      } finally {
        if (!cancelled) setHydrated(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [setUser, setView, setHydrated])

  return (
    <PhoneFrame>
      <AppRoot />
    </PhoneFrame>
  )
}
