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
import { PremiumView } from './PremiumView'
import { ProfileView } from './ProfileView'
import { MatchCelebration } from './MatchCelebration'
import { PaywallModal } from './PaywallModal'

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
    <div className="w-full h-full relative bg-[#0F0F14] text-white overflow-hidden">
      {/* Main view */}
      <div className="w-full h-full flex flex-col">
        <div className="flex-1 min-h-0 overflow-hidden">
          {view === 'auth' && <AuthScreen />}
          {view === 'onboarding' && <OnboardingFlow />}
          {view === 'discovery' && <DiscoveryFeed />}
          {view === 'matches' && <ChatList />}
          {view === 'likes-you' && <LikesYouView />}
          {view === 'profile-me' && <MyProfileView />}
          {view === 'premium' && <PremiumView />}
          {view === 'chat' && <ChatView />}
          {view === 'profile-view' && <ProfileView />}
        </div>
        {/* Bottom nav — hidden in chat & auth/onboarding */}
        {['discovery', 'matches', 'likes-you', 'profile-me', 'premium'].includes(view) && <BottomNav />}
      </div>

      {/* Overlays */}
      <MatchCelebration />
      <PaywallModal />
    </div>
  )
}
