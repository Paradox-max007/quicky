'use client'

import { useQuickyStore } from '@/store/quicky'
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
import { PremiumView } from './PremiumView'
import { ProfileView } from './ProfileView'
import { MatchCelebration } from './MatchCelebration'
import { PaywallModal } from './PaywallModal'
import { Toaster as SonnerToaster } from 'sonner'

export function AppRoot() {
  const view = useQuickyStore((s) => s.view)
  const hydrated = useQuickyStore((s) => s.hydrated)

  if (!hydrated) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#0F0F14]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-2 border-[#FF2D55] border-t-transparent animate-spin" />
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
      className="w-full h-full relative bg-[#0F0F14] text-white overflow-hidden"
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
          {view === 'premium' && <PremiumView />}
          {view === 'chat' && <ChatView />}
          {view === 'profile-view' && <ProfileView />}
        </div>
        {/* Bottom nav — hidden in chat & auth/onboarding/edit-profile/settings */}
        {['discovery', 'matches', 'likes-you', 'profile-me', 'premium'].includes(view) && <BottomNav />}
      </div>

      {/* Overlays */}
      <MatchCelebration />
      <PaywallModal />

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
            background: '#1A1A2E',
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
