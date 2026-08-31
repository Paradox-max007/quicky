'use client'

import { useEffect } from 'react'
import { useQuickyStore } from '@/store/quicky'
import { api } from '@/lib/quicky/api-client'
import { applyThemeToDOM } from '@/lib/quicky/theme'
import { AuthScreen } from './AuthScreen'
import { OnboardingFlow } from './OnboardingFlow'
import { DiscoveryFeed } from './DiscoveryFeed'
import { BottomNav } from './BottomNav'
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
import { MatchCelebration } from './MatchCelebration'
import { PaywallModal } from './PaywallModal'
import { GameInvitePopup } from './GameInvitePopup'
import { Toaster as SonnerToaster } from 'sonner'

export function AppRoot() {
  const view = useQuickyStore((s) => s.view)
  const hydrated = useQuickyStore((s) => s.hydrated)
  const user = useQuickyStore((s) => s.user)

  useEffect(() => {
    applyThemeToDOM(user?.settings?.theme)
  }, [user?.settings?.theme])

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
      style={{ transform: 'translateZ(0)' }}
    >
      {/* Main view */}
      <div className="w-full h-full flex flex-col">
        <div className="flex-1 min-h-0 overflow-hidden">
          {view === 'auth' && <AuthScreen />}
          {view === 'onboarding' && <OnboardingFlow />}
          {view === 'discovery' && <DiscoveryFeed />}
          {view === 'matches' && <ChatList />}
          {view === 'likes-you' && <LikesYouView />}
          {view === 'profile-me' && <MyProfileView />}
          {view === 'edit-profile' && <EditProfileScreen />}
          {view === 'settings' && <SettingsScreen />}
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
          {view === 'community' && <CommunityScreen />}
          {view === 'chat' && <ChatView />}
          {view === 'profile-view' && <ProfileView />}
        </div>
        {/* Bottom nav — hidden in chat & auth/onboarding/edit-profile/settings */}
        {['discovery', 'matches', 'likes-you', 'community', 'profile-me'].includes(view) && <BottomNav />}
      </div>

      {/* Overlays */}
      <MatchCelebration />
      <PaywallModal />
      <GameInvitePopup />

      {/* Toaster — rendered inside the app container so it's scoped to the
          phone frame on desktop and respects safe-area on mobile.
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
