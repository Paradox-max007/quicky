'use client'

import { useQuickyStore, AppView } from '@/store/quicky'
import { Heart, Sparkles, UsersRound, MessageCircle, Gamepad2, User, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Desktop sidebar — a game/social navigation rail, NOT an enterprise admin
 * panel (concept doc §4/§5). Icon-only between 1024–1279px, icon + label
 * from 1280px. Every destination is a real view; badges are the same live
 * counters the mobile bottom nav uses.
 */

const MAIN_NAV: { id: AppView; label: string; icon: typeof Heart }[] = [
  { id: 'discovery', label: 'Discover', icon: Heart },
  { id: 'likes-you', label: 'Likes', icon: Sparkles },
  { id: 'community', label: 'Community', icon: UsersRound },
  { id: 'matches', label: 'Chats', icon: MessageCircle },
  { id: 'spin-bottle', label: 'Games', icon: Gamepad2 },
]

const SECONDARY_NAV: { id: AppView; label: string; icon: typeof Heart }[] = [
  { id: 'profile-me', label: 'My Profile', icon: User },
  { id: 'settings', label: 'Settings', icon: Settings },
]

function NavItem({
  item,
  active,
  badge,
  onNavigate,
}: {
  item: { id: AppView; label: string; icon: typeof Heart }
  active: boolean
  badge: number
  onNavigate: (v: AppView) => void
}) {
  const Icon = item.icon
  return (
    <button
      data-active={active}
      aria-label={item.label}
      aria-current={active ? 'page' : undefined}
      onClick={() => onNavigate(item.id)}
      className="qk-desk-navitem h-11 w-full px-3.5 text-white/60 data-[active=true]:text-[var(--qk-accent)]"
    >
      <span className="relative flex shrink-0 items-center justify-center">
        <Icon className="w-5 h-5" strokeWidth={active ? 2.5 : 2} />
        {badge > 0 && (
          <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-[var(--qk-accent)] flex items-center justify-center text-[9px] font-bold text-white border border-[var(--qk-bg)]">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </span>
      <span className="hidden min-[1280px]:inline ml-3 text-sm font-medium tracking-tight truncate">{item.label}</span>
    </button>
  )
}

export function DesktopSidebar() {
  const view = useQuickyStore((s) => s.view)
  const setView = useQuickyStore((s) => s.setView)
  const totalUnread = useQuickyStore((s) => s.totalUnread)
  const unviewedLikes = useQuickyStore((s) => s.unviewedLikes)

  return (
    <aside
      className={cn(
        'shrink-0 h-full flex flex-col border-r border-white/5 bg-black/20 backdrop-blur-sm',
        'w-[68px] min-[1280px]:w-[212px] px-3 py-5'
      )}
      data-testid="desktop-sidebar"
    >
      <nav className="flex flex-col gap-1.5">
        {MAIN_NAV.map((item) => (
          <NavItem
            key={item.id}
            item={item}
            active={view === item.id || (item.id === 'matches' && view === 'chat')}
            badge={item.id === 'matches' ? totalUnread : item.id === 'likes-you' ? unviewedLikes : 0}
            onNavigate={setView}
          />
        ))}
      </nav>

      <div className="my-4 h-px bg-white/8 mx-1" />

      <nav className="flex flex-col gap-1.5">
        {SECONDARY_NAV.map((item) => (
          <NavItem key={item.id} item={item} active={view === item.id} badge={0} onNavigate={setView} />
        ))}
      </nav>

      <div className="flex-1" />

      {/* Streak flourish — the rail should feel like a game, not a filing cabinet (§4) */}
      <div className="hidden min-[1280px]:flex items-center gap-2.5 rounded-2xl border border-[var(--qk-accent)]/20 bg-[var(--qk-accent)]/5 px-3 py-3 mx-1">
        <span className="text-xl leading-none">🔥</span>
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-white/90 leading-tight">Keep the spark</p>
          <p className="text-[10px] text-white/50 leading-tight mt-0.5">Play daily to grow your streak</p>
        </div>
      </div>
    </aside>
  )
}
