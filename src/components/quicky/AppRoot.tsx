'use client'

import { useEffect } from 'react'
import { useQuickyStore } from '@/store/quicky'
import { api } from '@/lib/quicky/api-client'
import { applyThemeToDOM } from '@/lib/quicky/theme'
import { AuthScreen } from './AuthScreen'
import { OnboardingFlow } from './OnboardingFlow'
import { DiscoveryFeed } from './DiscoveryFeed'
import { BottomNav } from './BottomNav'
import { DesktopHome } from './desktop/DesktopHome'
import { useIsDesktopShell } from '@/hooks/useIsDesktopShell'
import { ChatList } from './ChatList'
import { ChatView } from './ChatView'
import { LikesYouView } from './LikesYouView'
import { MyProfileView } from './MyProfileView'
import { EditProfileScreen } from './EditProfileScreen'
import { SettingsScreen } from './SettingsScreen'
import { PhoneNumberScreen } from './PhoneNumberScreen'
import { EmailScreen } from './EmailScreen'
import { DiscoveryPreferencesScreen } from './DiscoveryPreferencesScreen'
import { NotificationsScreen } from './NotificationsScreen'
import { AppearanceScreen } from './AppearanceScreen'
import { BlockedUsersScreen } from './BlockedUsersScreen'
import { PrivacySettingsScreen } from './PrivacySettingsScreen'
import { TermsOfServiceScreen, PrivacyPolicyScreen } from './LegalScreens'
import { HelpSupportScreen } from './HelpSupportScreen'
import { PremiumView } from './PremiumView'
import { CommunityScreen } from './CommunityScreen'
import { ProfileView } from './ProfileView'
import { SpinBottleLanding } from './SpinBottleLanding'
import { GamesScreen } from './GamesScreen'
import { SpinBottleRoom } from './SpinBottleRoom'
import { AdminGiftsScreen } from './AdminGiftsScreen'
import { AdminRulesScreen } from './AdminRulesScreen'
import { AdminStickersScreen } from './AdminStickersScreen'
import { GameChatScreen } from './game-chat/GameChatScreen'
import { GameChatContactsScreen } from './game-chat/GameChatContactsScreen'
import { useGameWakeLock } from '@/hooks/useGameWakeLock'
import { GameDecisionDrawer } from './game-chat/GameDecisionDrawer'
import { MatchCelebration } from './MatchCelebration'
import { PaywallModal } from './PaywallModal'
import { GameInvitePopup } from './GameInvitePopup'
import { Toaster as SonnerToaster } from 'sonner'
import { Capacitor } from '@capacitor/core'
import { useGameChatStore } from '@/store/game-chat'
import { useGameRoomStore } from '@/store/game-room'
import { cn } from '@/lib/utils'
import type { AppView } from '@/store/quicky'

/**
 * Desktop (web) shell width per view — the web app renders bigger, centered
 * screens instead of the old 390px phone frame. Mobile / Capacitor keep the
 * exact same layout (the max-width only kicks in at the `md:` breakpoint).
 *
 * 'spin-bottle-room' is full-window on web: the club layout from the approved
 * design (top bar, wooden table left, chat sidebar right). On mobile it is
 * the same full-width column as Capacitor.
 */
function shellFor(view: AppView): string {
  switch (view) {
    case 'spin-bottle-room':
      // Web: full-window club layout (game table left + chat sidebar right,
      // per the approved web design). Mobile/Capacitor: full width anyway.
      return ''
    case 'discovery':
      return 'md:max-w-xl' // swipe-card column — same arrangement, bigger card
    case 'chat':
      return 'md:max-w-4xl'
    case 'auth':
    case 'onboarding':
      return 'md:max-w-lg'
    case 'spin-bottle':
      // Web: the Spin the Bottle landing is a full-width immersive page
      // (hero + rules + game chats across the whole stage, like the room).
      return ''
    case 'premium':
      return 'md:max-w-2xl'
    case 'game-chat':
    case 'game-chat-contacts':
      // §81: phone-style chat column on web
      return 'md:max-w-lg'
    default:
      return 'md:max-w-3xl'
  }
}

export function AppRoot() {
  const view = useQuickyStore((s) => s.view)
  const hydrated = useQuickyStore((s) => s.hydrated)
  const user = useQuickyStore((s) => s.user)
  const setView = useQuickyStore((s) => s.setView)
  const isDeskShell = useIsDesktopShell() === true

  // Desktop command center (Desktop UI concept §3/§30): at ≥1024px web the
  // five main tab views plug into the three-zone shell; everything else
  // (chat, game room, settings…) keeps the centered-column layout. Mobile
  // and Capacitor are never affected (the hook is null/false there).
  const tabScreen =
    view === 'discovery' ? (
      <DiscoveryFeed />
    ) : view === 'matches' ? (
      <ChatList />
    ) : view === 'likes-you' ? (
      <LikesYouView />
    ) : view === 'community' ? (
      <CommunityScreen />
    ) : view === 'profile-me' ? (
      <MyProfileView />
    ) : null
  // Web Premium PRD §3/§9/§39: the desktop shell now also hosts the Games
  // hub and the Chats page as first-class pages (top-nav destinations).
  const useDesk =
    isDeskShell &&
    ['discovery', 'matches', 'likes-you', 'community', 'profile-me', 'games', 'chats', 'settings'].includes(view)

  // ─── Capacitor hardware back button (lifecycle PRD §56/§57) ────────────
  // The on-screen back arrows are explicit (Community ↔ Game ↔ Room); the
  // native back key must mirror them — never trap the user, never push a
  // stale room route. Views outside the game keep the platform default.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let handle: Awaited<ReturnType<typeof import('@capacitor/app').App.addListener>> | null = null
    let cancelled = false
    void import('@capacitor/app').then(({ App }) =>
      App.addListener('backButton', () => {
        const { view: v, setView: sv } = useQuickyStore.getState()
        if (v === 'spin-bottle') sv('community')
        else if (v === 'spin-bottle-room') {
          useQuickyStore.getState().setSpinBottleRoomId(null)
          sv('spin-bottle')
        } else if (v === 'game-chat-contacts') {
          // Mentions PRD §82: the contacts screen's back → its OWN return
          // view (the live room) — the runtime never stopped. Distinct from
          // gameChatReturnView, which points at THIS screen when the
          // personal chat was opened straight from "Message".
          const qk = useQuickyStore.getState()
          qk.pinGameChatPeer(null)
          sv(qk.gameChatContactsReturnView || 'spin-bottle-room')
        } else if (v === 'game-chat') {
          // game-chat PRD §97: back returns to the context that opened it
          useGameChatStore.getState().closeConversation()
          useQuickyStore.getState().closeGameChat()
        } else if (v === 'admin-gifts' || v === 'admin-rules' || v === 'admin-stickers') {
          sv('settings')
        }
        // anything else → default Android behavior (navigate back / minimize)
      })
    ).then((h) => {
      if (cancelled) h?.remove?.()
      else handle = h
    })
    return () => {
      cancelled = true
      handle?.remove?.()
    }
  }, [])

  useEffect(() => {
    applyThemeToDOM(user?.settings?.theme)
  }, [user?.settings?.theme])

  // ─── Room runtime restore after refresh (game-chat PRD §100) ────────────
  // The server is authoritative: ask it whether the stored room id still
  // has me as an active member. Yes → re-attach the runtime in the
  // background (decision drawer works from any game-section screen). No →
  // drop the stored id and NEVER restore game decision state.
  useEffect(() => {
    if (!hydrated) return
    let cancelled = false
    const stored = (() => {
      try {
        return localStorage.getItem('quicky_room_id')
      } catch {
        return null
      }
    })()
    if (!stored) return
    void (async () => {
      try {
        const res = await api.spinBottle.room(stored)
        if (!cancelled && res?.snapshot) {
          useQuickyStore.getState().setSpinBottleRoomId(stored)
          useGameRoomStore.getState().attach(stored)
        }
      } catch {
        try {
          localStorage.removeItem('quicky_room_id')
        } catch {}
      }
    })()
    return () => {
      cancelled = true
    }
  }, [hydrated])

  // ─── GAME CHAT stream lifecycle (game-chat PRD §91) ──────────────────────
  // ONE lightweight stream serves every conversation. It lives while the
  // user is anywhere in the Spin the Bottle section (landing, table, chat,
  // profile popped from the room) — and ends when they leave the section.
  const gameSectionActive =
    view === 'spin-bottle' ||
    view === 'spin-bottle-room' ||
    view === 'game-chat' ||
    view === 'game-chat-contacts' ||
    view === 'chats' ||
    (view === 'profile-view' && useQuickyStore.getState().profileReturnView === 'spin-bottle-room')
  useEffect(() => {
    if (gameSectionActive) useGameChatStore.getState().connectStream()
    else useGameChatStore.getState().disconnectStream()
  }, [gameSectionActive])

  // ─── WAKE LOCK (layout PRD §9/§48) ───────────────────────────────────────
  // Owned HERE for the whole game section while the room runtime is
  // attached: entering Game Chat / the contacts screen must NOT release the
  // wake lock (§9 forbids exactly that). Released when the room detaches
  // (leave / room deleted / session ended, §48) or the user leaves the game
  // section; visibilitychange inside the hook re-acquires (§78 resume).
  const roomAttached = useGameRoomStore((s) => !!s.roomId)
  useGameWakeLock(roomAttached && gameSectionActive)

  // ─── APP RESUME (layout PRD §78) ─────────────────────────────────────────
  // Capacitor resume → reconcile the authoritative room snapshot + refresh
  // chat state. The server deadline stays the only authority: a response
  // that came due while backgrounded can never be sent stale (the respond
  // route re-checks the server clock), and if both responses were already
  // submitted the reconciled snapshot carries the result.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let handle: Awaited<ReturnType<typeof import('@capacitor/app').App.addListener>> | null = null
    let cancelled = false
    void import('@capacitor/app').then(({ App }) =>
      App.addListener('resume', () => {
        const room = useGameRoomStore.getState()
        if (room.roomId) void room.reconcile()
        const chat = useGameChatStore.getState()
        if (chat.activeConversationId) void chat.refreshActive()
        chat.refreshList(true)
      })
    ).then((h) => {
      if (cancelled) h?.remove?.()
      else handle = h
    })
    return () => {
      cancelled = true
      handle?.remove?.()
    }
  }, [])

  // ─── BLACK SCREEN ROOT FIX (bug-fix PRD §3/§7/§8/§156) ───────────────────
  // "Message" on a player sets `gameChatPeer` and navigates to the
  // game-chat view — but the chat SCREEN renders from the game-chat STORE's
  // `activePeer`. Nothing used to bridge the two, so the screen returned
  // null → an empty (black) page. The bridge lives HERE, in exactly one
  // place: entering game-chat resolves the peer through the shared
  // getOrCreateGameConversation path (server-side §8) and never renders
  // nothing — missing peer bounces back to the section that opened it.
  useEffect(() => {
    if (view !== 'game-chat') return
    const qk = useQuickyStore.getState()
    const chat = useGameChatStore.getState()
    const wanted = qk.gameChatPeer
    if (wanted) {
      if (chat.activePeer?.peerUserId !== wanted.peerUserId) {
        chat.openConversation(wanted)
      }
    } else if (!chat.activePeer) {
      // No peer requested and nothing open — there is nothing to render,
      // so return to the context that opened the view (never a blank page).
      qk.setView(qk.gameChatReturnView || 'spin-bottle')
    }
  }, [view])

  // Web Premium PRD §57: "Chats" is a desktop (≥1024px) experience — the
  // two-pane GameChatShell. If the viewport drops below 1024px (or the app
  // runs inside Capacitor), fall back to the mobile dating chat list instead
  // of stranding the user on a page without its navigation.
  useEffect(() => {
    if (isDeskShell === false && view === 'chats') setView('matches')
  }, [isDeskShell, view, setView])

  // Keep the unread-messages badge fresh across all tabs
  useEffect(() => {
    if (!user) return
    let stopped = false
    const tick = async () => {
      try {
        const res = await api.matches()
        if (!stopped && Array.isArray(res.matches)) {
          useQuickyStore
            .getState()
            .setTotalUnread(res.matches.reduce((sum: number, m: any) => sum + (m.unreadCount ?? 0), 0))
        }
      } catch {}
    }
    tick()
    const interval = setInterval(tick, 30000)
    return () => {
      stopped = true
      clearInterval(interval)
    }
  }, [user?.id])

  if (!hydrated) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[var(--qk-bg)]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-2 border-[var(--qk-accent)] border-t-transparent animate-spin" />
          <span className="text-white/60 text-sm">Loading Quicky...</span>
        </div>
      </div>
    )
  }

  return (
    // transform: translateZ(0) creates a containing block for position:fixed
    // descendants (like Sonner toasts), so they're scoped to this div rather
    // than the whole browser window. This keeps toasts inside the phone frame
    // on desktop and inside the safe-area on mobile.
    <div
      className="w-full h-full relative bg-[var(--qk-bg)] text-white overflow-hidden"
      data-qk-root="true"
      style={{ transform: 'translateZ(0)' }}
    >
      {/* Main view — centered, bigger column on desktop web */}
      <div className="w-full h-full flex flex-col">
        <div className="flex-1 min-h-0 overflow-hidden">
          <div className={cn('relative w-full h-full mx-auto', !useDesk && shellFor(view))}>
            {useDesk && <DesktopHome>{tabScreen}</DesktopHome>}
            {view === 'auth' && <AuthScreen />}
          {view === 'onboarding' && <OnboardingFlow />}
          {!useDesk && tabScreen}
          {view === 'edit-profile' && <EditProfileScreen />}
          {view === 'settings' && !useDesk && <SettingsScreen />}
          {view === 'settings-phone' && <PhoneNumberScreen />}
          {view === 'settings-email' && <EmailScreen />}
          {view === 'settings-discovery' && <DiscoveryPreferencesScreen />}
          {view === 'settings-notifications' && <NotificationsScreen />}
          {view === 'settings-appearance' && <AppearanceScreen />}
          {view === 'settings-blocked' && <BlockedUsersScreen />}
          {view === 'settings-privacy' && <PrivacySettingsScreen />}
          {view === 'settings-terms' && <TermsOfServiceScreen />}
          {view === 'settings-privacy-policy' && <PrivacyPolicyScreen />}
          {view === 'settings-help' && <HelpSupportScreen />}
          {view === 'premium' && <PremiumView />}
          
          {view === 'chat' && <ChatView />}
          {view === 'profile-view' && <ProfileView />}
          {view === 'spin-bottle' && (
            <SpinBottleLanding
              onClose={() => setView('community')}
              onJoined={(roomId) => {
                useQuickyStore.getState().setSpinBottleRoomId(roomId)
                setView('spin-bottle-room')
              }}
            />
          )}
          {view === 'spin-bottle-room' && (() => {
            const roomId = useQuickyStore.getState().spinBottleRoomId
            if (!roomId) {
              return (
                <SpinBottleLanding
                  onClose={() => setView('community')}
                  onJoined={(id) => {
                    useQuickyStore.getState().setSpinBottleRoomId(id)
                    setView('spin-bottle-room')
                  }}
                />
              )
            }
            return (
              <SpinBottleRoom
                roomId={roomId}
                onClose={() => {
                  useQuickyStore.getState().setSpinBottleRoomId(null)
                  // v3 §37: Leave Room returns to the GAME LANDING screen
                  // (Room → Leave → Game Landing → ← Back → Community)
                  setView('spin-bottle')
                }}
              />
            )
          })()}
          {view === 'admin-gifts' && <AdminGiftsScreen />}
          {view === 'admin-rules' && <AdminRulesScreen />}
          {view === 'admin-stickers' && <AdminStickersScreen />}
          {view === 'game-chat-contacts' && <GameChatContactsScreen />}
          {view === 'game-chat' && <GameChatScreen />}
          {/* Web Premium §39/§9: mobile fallbacks — on the desktop shell the
              pages render inside DesktopHome (Games hub / Chats shell). */}
          {view === 'games' && !useDesk && <GamesScreen />}
          {view === 'chats' && !useDesk && <ChatList />}
          </div>
        </div>
        {/* Bottom nav — hidden in chat & auth/onboarding/edit-profile/settings.
            Centered dock on desktop, full-width on mobile (unchanged). */}
        {!useDesk && ['discovery', 'matches', 'likes-you', 'community', 'profile-me'].includes(view) && (
          <div className="shrink-0 w-full flex justify-center">
            <div className="w-full md:max-w-2xl">
              <BottomNav />
            </div>
          </div>
        )}
      </div>

      {/* Overlays */}
      <MatchCelebration />
      <PaywallModal />
      <GameInvitePopup />
      {/* game-chat PRD §82: the off-screen decision drawer is a top-level
          overlay — above chat content, composer and keyboard; it only ever
          renders over game-section screens (§53) and never over the table
          itself (§54), which has its own inline duel UI. */}
      <GameDecisionDrawer />

      {/* Toaster — rendered inside the app container so it's scoped to the
          app on desktop and respects safe-area on mobile.
          offset pushes toasts below the status bar / notch. */}
      <SonnerToaster
        theme="dark"
        position="top-center"
        offset="calc(env(safe-area-inset-top, 0px) + 12px)"
        expand={false}
        visibleToasts={3}
        closeButton={false}
        toastOptions={{
          style: {
            background: 'var(--qk-card)',
            color: '#F5F5F7',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            fontSize: '14px',
            maxWidth: '90%',
          },
        }}
      />
    </div>
  )
}
