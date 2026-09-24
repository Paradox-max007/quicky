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
import { GameLanding } from './game-hub/GameLanding'
import { UnifiedChatsScreen } from './game-hub/UnifiedChatsScreen'
import { SpinBottleRoom } from './SpinBottleRoom'
import { LudoRoom } from './ludo/LudoRoom'
import { AdminGiftsScreen } from './AdminGiftsScreen'
import { AdminRulesScreen } from './AdminRulesScreen'
import { AdminStickersScreen } from './AdminStickersScreen'
import { AdminGamesScreen } from './AdminGamesScreen'
import { GameChatScreen } from './game-chat/GameChatScreen'
import { GameChatContactsScreen } from './game-chat/GameChatContactsScreen'
import { GameFriendsScreen } from './game-primary/GameFriendsScreen'
import { useGameWakeLock } from '@/hooks/useGameWakeLock'
import { GameDecisionDrawer } from './game-chat/GameDecisionDrawer'
import { GameAlertCenter } from './game-alerts/GameAlertCenter'
import { GameGiftAlert } from './game-alerts/GameGiftAlert'
import { GiftFlyLayer } from './gift-fly/GiftFlyLayer'
import { GiftBackSheet } from './gift-back/GiftBackSheet'
import { RealmDetails } from './realm/RealmDetails'
import { RealmResult } from './realm/RealmResult'
import { RealmLeaderboardScreen } from './realm/RealmLeaderboardScreen'
import { initPushSession } from '@/lib/quicky/push-client'
import { RewardCollectPopup } from './rewards/RewardCollectPopup'
import { useRealmStore } from '@/store/realm'
import { useRewardsStore, subscribeRewardsChannel, resetRewardsChannel } from '@/store/rewards'
import { primeMentionSound } from '@/lib/quicky/mention-sound'
import { MatchCelebration } from './MatchCelebration'
import { PaywallModal } from './PaywallModal'
import { GameInvitePopup } from './GameInvitePopup'
import { Toaster as SonnerToaster } from 'sonner'
import { Capacitor } from '@capacitor/core'
import { useGameChatStore } from '@/store/game-chat'
import { useGameRoomStore } from '@/store/game-room'
import { useLudoRoomStore } from '@/store/ludo-room'
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
    case 'ludo-room':
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
    case 'game-landing':
      // Web: game landings are full-width immersive pages (Game Hub PRD §61
      // reference translation + the approved Spin the Bottle stage).
      return ''
    case 'premium':
      return 'md:max-w-2xl'
    case 'game-chat':
    case 'game-chat-contacts':
    case 'game-friends':
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
  const commentsSheetOpen = useQuickyStore((s) => s.commentsSheetOpen)
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
        if (v === 'game-landing') sv('games')
        else if (v === 'chats') sv('community')
        else if (v === 'spin-bottle') sv('community')
        else if (v === 'spin-bottle-room') {
          useQuickyStore.getState().setSpinBottleRoomId(null)
          sv('spin-bottle')
        } else if (v === 'ludo-room') {
          // Ludo PRD §110: hardware back leaves the room via the leave API
          // (never a dangling membership server-side) and returns to Games.
          void api.ludo.leave(useQuickyStore.getState().ludoRoomId ?? '').catch(() => {})
          useLudoRoomStore.getState().detach()
          useQuickyStore.getState().setLudoRoomId(null)
          sv('games')
        } else if (v === 'game-friends') {
          // Unified Game Primary Screen PRD §17/§18/§40: hardware back on the
          // dedicated Friends screen returns to the Game Primary Screen that
          // opened it — never the Games list.
          const qk = useQuickyStore.getState()
          sv(qk.gameFriendsReturnView || 'games')
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
        } else if (v === 'admin-gifts' || v === 'admin-rules' || v === 'admin-stickers' || v === 'admin-games') {
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

  // ─── Realm progression (realm PRD §68) ──────────────────────────────────
  // Signed in → fetch the authoritative realm snapshot once per session:
  // realm status + active multiplier (banner/preview) + any UNSEEN settled
  // cycle result (the RealmResult modal). The per-user `realm:${id}`
  // Supabase channel then keeps points moving live.
  useEffect(() => {
    if (!user?.id) return
    void useRealmStore.getState().refresh()
    // FCM — reconcile the device token while the permission stands (never
    // prompts; the explicit enable lives in Settings → Notifications).
    initPushSession()
  }, [user?.id])

  // ─── Rewards collection (admin-console PRD §12) ──────────────────────────
  // Pending grants are fetched on EVERY session start — offline users see
  // the popup the moment they return (§12.2). The rewards_pending broadcast
  // from settlement re-fetches instantly for online users (§12.1).
  useEffect(() => {
    if (!user?.id) {
      resetRewardsChannel()
      return
    }
    subscribeRewardsChannel(user.id)
    void useRewardsStore.getState().refresh()
  }, [user?.id])

  // ─── Mention notification sound unlock (room-chat-settings revision) ────
  // WebAudio needs one user gesture before it may play: prime the context at
  // the first tap/keystroke so the mention chime works on every later
  // mention alert, on any screen (in the room or not).
  useEffect(() => {
    primeMentionSound()
  }, [])

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

  // ─── LUDO room restore after refresh (Ludo PRD §63) — same contract: the
  // server decides whether the stored board still has me as a member; a
  // stale id is dropped and NEVER restored into a ghost room.
  useEffect(() => {
    if (!hydrated) return
    let cancelled = false
    const storedLudo = (() => {
      try {
        return localStorage.getItem('quicky_ludo_room_id')
      } catch {
        return null
      }
    })()
    if (!storedLudo) return
    void (async () => {
      try {
        const res = await api.ludo.room(storedLudo)
        if (!cancelled && res?.snapshot) {
          useQuickyStore.getState().setLudoRoomId(storedLudo)
          useLudoRoomStore.getState().attach(storedLudo)
        }
      } catch {
        try {
          localStorage.removeItem('quicky_ludo_room_id')
        } catch {}
      }
    })()
    return () => {
      cancelled = true
    }
  }, [hydrated])

  // ─── GAME CHAT stream lifecycle (game-chat PRD §91) ──────────────────────
  // ONE lightweight stream serves every conversation. It lives while the
  // user is anywhere in the game section (game primary screens, landing,
  // table, chat, friends, profile popped from the room) — and ends when they
  // leave the section. The game primary screens are included so the Chat
  // icon's unread badge stays live (Unified Game Primary PRD §47).
  const gameSectionActive =
    view === 'spin-bottle' ||
    view === 'game-landing' ||
    view === 'game-friends' ||
    view === 'spin-bottle-room' ||
    view === 'ludo-room' ||
    view === 'game-chat' ||
    view === 'game-chat-contacts' ||
    view === 'chats' ||
    (view === 'profile-view' &&
      (useQuickyStore.getState().profileReturnView === 'spin-bottle-room' ||
        useQuickyStore.getState().profileReturnView === 'ludo-room' ||
        useQuickyStore.getState().profileReturnView === 'game-friends'))
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
  const ludoAttached = useLudoRoomStore((s) => !!s.roomId)
  useGameWakeLock(roomAttached && gameSectionActive)
  useGameWakeLock(ludoAttached && gameSectionActive)

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
        const ludo = useLudoRoomStore.getState()
        if (ludo.roomId) void ludo.reconcile() // Ludo PRD §63: resume → reconcile board
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

  // Game Hub PRD §29: the unified Chat Center works on EVERY width — below
  // 1024px it renders as the mobile UnifiedChatsScreen (tabs → conversation),
  // at ≥1024px as the desktop two-pane shell. No fallback redirect needed.

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
          {view === 'game-landing' && <GameLanding />}
          {/* Quicky Ludo room (Ludo PRD §33/§34) — same full-window shell
              contract as the Spin Bottle room. Missing id → back to Games. */}
          {view === 'ludo-room' && (() => {
            const ludoRoomId = useQuickyStore.getState().ludoRoomId
            if (!ludoRoomId) {
              return null
            }
            return (
              <LudoRoom
                roomId={ludoRoomId}
                onClose={() => {
                  useQuickyStore.getState().setLudoRoomId(null)
                  setView('games')
                }}
              />
            )
          })()}
          {view === 'admin-gifts' && <AdminGiftsScreen />}
          {view === 'admin-rules' && <AdminRulesScreen />}
          {view === 'admin-stickers' && <AdminStickersScreen />}
          {view === 'admin-games' && <AdminGamesScreen />}
          {view === 'game-chat-contacts' && <GameChatContactsScreen />}
          {view === 'game-chat' && <GameChatScreen />}
          {/* Unified Game Primary Screen PRD §15: dedicated Capacitor Friends
              screen (Game Primary → 👥 → Friends → Profile/Chat). */}
          {view === 'game-friends' && <GameFriendsScreen />}
          {/* Web Premium §39/§9: mobile fallbacks — on the desktop shell the
              pages render inside DesktopHome (Games hub / Chats shell). */}
          {view === 'games' && !useDesk && <GamesScreen />}
          {view === 'chats' && !useDesk && <UnifiedChatsScreen />}
          </div>
        </div>
        {/* Bottom nav — hidden in chat & auth/onboarding/edit-profile/settings,
            and while a mobile comment sheet is open (the sheet then owns the
            full screen height — community: "use that space for the comment
            section"). Centered dock on desktop, full-width on mobile. */}
        {!useDesk && !commentsSheetOpen && ['discovery', 'matches', 'chats', 'likes-you', 'community', 'profile-me'].includes(view) && (
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
      {/* In-game notification layer (Ludo + future games): turn alerts with
          Dismiss + Go-to-Game while off the game screen, and private
          game-chat message modals (one-line preview + Reply). Gated by the
          "In-game Notifications" setting toggle; mobile/Capacitor only. */}
      <GameAlertCenter />

      {/* Gifting-revision global surfaces:
          · GameGiftAlert — "You received N × 🎁 from {sender}" top drawer
            whenever the player is NOT in a room view (mobile off-game-screen
            OR desktop off-room). Inside a room the chat-shell drawer / the
            timeline gift card carry it.
          · GiftFlyLayer — the sender→receiver fly animation overlay (inert,
            pointer-events-none, paints only while flights are active).
          · GiftBackSheet — the per-recipient gift sheet opened from the
            drawers / timeline cards; works on ANY screen (no navigation —
            the room runtime never detaches). */}
      <GameGiftAlert />
      <GiftFlyLayer />
      <GiftBackSheet />

      {/* Realm PRD §41/§58/§71 — global realm surfaces: the 👑-chip details
          sheet (works on any screen, no navigation) + the settled-cycle
          result modal (shown once per completed cycle) + the dedicated realm
          leaderboard (mobile full screen / desktop left drawer, opened from
          the Games hub trophy badge). */}
      <RealmDetails />
      <RealmResult />
      <RealmLeaderboardScreen />

      {/* Admin-console PRD §12 — the reward-collection popup: pending grants
          from settled realm cycles (online push + offline return). */}
      <RewardCollectPopup />

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
