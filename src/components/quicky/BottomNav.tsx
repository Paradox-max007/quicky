'use client'

import { useQuickyStore, AppView } from '@/store/quicky'
import { Flame, Heart, MessageCircle, User, Crown, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

export type BottomNavProps = { active: AppView }

const TABS: { id: AppView; label: string; icon: typeof Heart }[] = [
  { id: 'discovery', label: 'Discover', icon: Flame },
  { id: 'likes-you', label: 'Likes', icon: Sparkles },
  { id: 'matches', label: 'Chats', icon: MessageCircle },
  { id: 'premium', label: 'Premium', icon: Crown },
  { id: 'profile-me', label: 'Me', icon: User },
]

export function BottomNav() {
  const view = useQuickyStore((s) => s.view)
  const setView = useQuickyStore((s) => s.setView)
  const user = useQuickyStore((s) => s.user)

  return (
    <nav className="shrink-0 bg-[#0F0F14]/95 backdrop-blur-md border-t border-white/8 px-2 py-2 flex items-center justify-around safe-area-bottom">
      {TABS.map((tab) => {
        const Icon = tab.icon
        const active = view === tab.id
        const isPremiumTab = tab.id === 'premium'
        const isPremium = user?.isPremium
        return (
          <button
            key={tab.id}
            onClick={() => setView(tab.id)}
            className={cn(
              'flex flex-col items-center justify-center gap-0.5 px-2 py-1.5 rounded-xl transition-all min-w-[56px] h-[56px]',
              active ? 'text-[#FF2D55]' : 'text-white/40 hover:text-white/70'
            )}
            aria-label={tab.label}
            aria-current={active ? 'page' : undefined}
          >
            <div
              className={cn(
                'relative flex items-center justify-center',
                isPremiumTab && isPremium && 'text-gradient-gold'
              )}
            >
              {isPremiumTab && isPremium ? (
                <span className="text-gradient-gold">
                  <Crown className="w-5 h-5" strokeWidth={2.5} />
                </span>
              ) : (
                <Icon className="w-5 h-5" strokeWidth={active ? 2.5 : 2} />
              )}
              {active && !isPremiumTab && (
                <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[#FF2D55]" />
              )}
            </div>
            <span className="text-[10px] font-medium tracking-tight">{tab.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
