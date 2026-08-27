'use client'

import { useQuickyStore, AppView } from '@/store/quicky'
import { Flame, Heart, MessageCircle, User, UsersRound, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

export type BottomNavProps = { active: AppView }

const TABS: { id: AppView; label: string; icon: typeof Heart }[] = [
  { id: 'discovery', label: 'Discover', icon: Flame },
  { id: 'likes-you', label: 'Likes', icon: Sparkles },
  { id: 'community', label: 'Community', icon: UsersRound },
  { id: 'matches', label: 'Chats', icon: MessageCircle },
  { id: 'profile-me', label: 'Me', icon: User },
]

export function BottomNav() {
  const view = useQuickyStore((s) => s.view)
  const setView = useQuickyStore((s) => s.setView)
  const totalUnread = useQuickyStore((s) => s.totalUnread)
  const unviewedLikes = useQuickyStore((s) => s.unviewedLikes)

  return (
    <nav className="shrink-0 safe-area-bottom">
      <div className="liquid-glass relative overflow-hidden rounded-t-[28px] px-2 pt-2.5 pb-2 flex items-center justify-around">
        {/* Top light seam along the curved edge */}
        <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent" />
        {TABS.map((tab) => {
          const Icon = tab.icon
          const active = view === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setView(tab.id)}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 px-2 py-1.5 rounded-xl transition-all min-w-[56px] h-[56px]',
                active ? 'text-[var(--qk-accent)]' : 'text-white/50 hover:text-white/80'
              )}
              aria-label={tab.label}
              aria-current={active ? 'page' : undefined}
            >
              <div className="relative flex items-center justify-center">
                <Icon className="w-5 h-5" strokeWidth={active ? 2.5 : 2} />
                {active && (
                  <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[var(--qk-accent)]" />
                )}
                {/* Unread messages badge on the Chats tab */}
                {tab.id === 'matches' && totalUnread > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-[var(--qk-accent)] flex items-center justify-center text-[9px] font-bold text-white border border-[var(--qk-bg)]">
                    {totalUnread > 99 ? '99+' : totalUnread}
                  </span>
                )}
                {/* Unviewed incoming-likes badge on the Likes tab (PRD §3) */}
                {tab.id === 'likes-you' && unviewedLikes > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-[var(--qk-purple)] flex items-center justify-center text-[9px] font-bold text-white border border-[var(--qk-bg)]">
                    {unviewedLikes > 99 ? '99+' : unviewedLikes}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-medium tracking-tight">{tab.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
