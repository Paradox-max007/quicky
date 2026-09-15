'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuickyStore, AppView } from '@/store/quicky'
import { Bell, Coins, Crown, Heart, Sparkles, Gift, MessageCircle, Trophy, Settings as SettingsIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDashboard, timeAgo, DashboardActivity } from './useDashboard'

/**
 * TOP NAVIGATION — the ONLY primary navigation on web (Web Premium PRD §2-§4,
 * §76, §83). Primary links: Discover / Likes / Community / Games / Chats.
 * Utility: coins, notifications, settings, profile. Active state is the
 * Quicky accent underline (§4) — never a heavy box. Keyboard reachable,
 * aria-current marked, sticky, and it never renders inside the game room
 * (§58: DesktopHome is not mounted there).
 */

const NAV: { id: AppView; label: string; active: AppView[]; testId: string }[] = [
  { id: 'discovery', label: 'Discover', active: ['discovery'], testId: 'topnav-discover' },
  { id: 'likes-you', label: 'Likes', active: ['likes-you'], testId: 'topnav-likes' },
  { id: 'community', label: 'Community', active: ['community'], testId: 'topnav-community' },
  { id: 'games', label: 'Games', active: ['games', 'spin-bottle'], testId: 'topnav-games' },
  { id: 'chats', label: 'Chats', active: ['chats', 'matches', 'chat'], testId: 'topnav-chats' },
]

const KIND_ICON: Record<DashboardActivity['kind'], typeof Heart> = {
  like: Heart,
  match: Sparkles,
  kiss: Trophy,
  gift: Gift,
  message: MessageCircle,
}
const KIND_COLOR: Record<DashboardActivity['kind'], string> = {
  like: 'text-[var(--qk-accent)]',
  match: 'text-[var(--qk-purple)]',
  kiss: 'text-[var(--qk-accent-light)]',
  gift: 'text-[var(--qk-gold)]',
  message: 'text-white/70',
}

export function DesktopTopBar() {
  const view = useQuickyStore((s) => s.view)
  const setView = useQuickyStore((s) => s.setView)
  const openChats = useQuickyStore((s) => s.openChats)
  const user = useQuickyStore((s) => s.user)
  const { data } = useDashboard(true)

  const [notifOpen, setNotifOpen] = useState(false)
  const popRef = useRef<HTMLDivElement | null>(null)

  // Close the notification center on outside click or Escape (§41/§64)
  useEffect(() => {
    if (!notifOpen) return
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setNotifOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNotifOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [notifOpen])

  const activity = data?.activity ?? []
  const avatar = user?.photos?.find((p) => p.isPrimary)?.url ?? user?.photos?.[0]?.url ?? null

  const goChats = () => openChats()

  return (
    <header
      className="shrink-0 h-14 border-b border-white/5 bg-black/25 backdrop-blur-md flex items-center gap-3 px-4 min-[1280px]:px-6 relative z-30"
      data-testid="desktop-topnav"
    >
      {/* Wordmark */}
      <button className="flex items-center gap-2 shrink-0" onClick={() => setView('discovery')} aria-label="Quicky home">
        <img src="/quicky-logo.png" alt="" className="w-7 h-7 rounded-lg object-cover" />
        <span className="text-lg font-bold tracking-tight">quicky</span>
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--qk-accent)]" />
      </button>

      {/* Primary navigation — every desktop width (§3.1). No duplication in
          the sidebar (§5/§75): this bar is the ONLY primary navigation. */}
      <nav className="flex items-center gap-1 ml-4" aria-label="Primary" data-testid="topnav-links">
        {NAV.map((l) => {
          const isActive = l.active.includes(view)
          return (
            <button
              key={l.id}
              data-testid={l.testId}
              onClick={l.id === 'chats' ? goChats : () => setView(l.id)}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'qk-topnav-item relative px-3.5 py-2 rounded-lg text-sm font-medium transition-colors',
                isActive ? 'text-[var(--qk-accent)]' : 'text-white/60 hover:text-white/90'
              )}
            >
              {l.label}
              {isActive && <span className="qk-topnav-underline" aria-hidden />}
            </button>
          )
        })}
      </nav>

      <div className="flex-1" />

      {/* Coins → premium / coin store */}
      <button
        onClick={() => setView('premium')}
        className="flex items-center gap-1.5 rounded-full border border-[var(--qk-gold)]/30 bg-[var(--qk-gold)]/10 px-3 py-1.5 text-sm font-semibold text-[var(--qk-gold)] hover:bg-[var(--qk-gold)]/15 transition-colors"
        aria-label="Coins and premium"
      >
        <Coins className="w-4 h-4" />
        {(user?.coinBalance ?? 0).toLocaleString()}
      </button>

      {/* Notification center (§41/§64 — keyboard dismissible) */}
      <div className="relative" ref={popRef}>
        <button
          onClick={() => setNotifOpen((o) => !o)}
          className={cn(
            'w-9 h-9 rounded-full border border-white/10 flex items-center justify-center transition-colors relative',
            notifOpen ? 'bg-white/10 text-white' : 'text-white/70 hover:text-white hover:bg-white/5'
          )}
          aria-label="Notifications"
          aria-expanded={notifOpen}
          data-testid="desktop-bell"
        >
          <Bell className="w-[18px] h-[18px]" />
          {activity.length > 0 && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[var(--qk-accent)] border border-[var(--qk-bg)]" />
          )}
        </button>

        {notifOpen && (
          <div className="qk-desk-pop absolute right-0 top-11 w-80 rounded-2xl overflow-hidden" data-testid="desktop-notifications">
            <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between">
              <p className="text-sm font-bold">Notifications</p>
              <span className="text-[11px] text-white/40">{activity.length} recent</span>
            </div>
            <div className="max-h-80 overflow-y-auto qk-desk-scroll">
              {activity.length === 0 && (
                <div className="px-4 py-8 text-center">
                  <Sparkles className="w-6 h-6 text-white/20 mx-auto mb-2" />
                  <p className="text-xs text-white/50">You're all caught up — likes, kisses, gifts and messages land here.</p>
                </div>
              )}
              {activity.map((a) => {
                const Icon = KIND_ICON[a.kind]
                return (
                  <button
                    key={a.id}
                    onClick={() => {
                      setNotifOpen(false)
                      // §83: chats land on the unified Chats page
                      if (a.kind === 'match' || a.kind === 'message') goChats()
                      else if (a.kind === 'like') setView('likes-you')
                      else setView('community')
                    }}
                    className="w-full flex items-start gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors text-left"
                  >
                    {a.actorPhoto ? (
                      <img src={a.actorPhoto} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                    ) : (
                      <span className="w-8 h-8 rounded-full bg-white/8 flex items-center justify-center shrink-0">
                        <Icon className={cn('w-4 h-4', KIND_COLOR[a.kind])} />
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block text-xs font-medium text-white/90 leading-snug">{a.text}</span>
                      <span className="block text-[10px] text-white/40 mt-0.5">{timeAgo(a.createdAt)}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Settings (§76 utility access without duplicating it in the sidebar) */}
      <button
        onClick={() => setView('settings')}
        className="w-9 h-9 rounded-full border border-white/10 flex items-center justify-center text-white/70 hover:text-white hover:bg-white/5 transition-colors"
        aria-label="Settings"
        data-testid="topnav-settings"
      >
        <SettingsIcon className="w-[18px] h-[18px]" />
      </button>

      {/* Avatar → my profile */}
      <button
        onClick={() => setView('profile-me')}
        className="flex items-center gap-2 rounded-full border border-white/10 pl-1 pr-3 py-1 hover:bg-white/5 transition-colors"
        aria-label="My profile"
      >
        {avatar ? (
          <img src={avatar} alt="" className="w-7 h-7 rounded-full object-cover" />
        ) : (
          <span className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold">
            {(user?.name ?? 'Q').slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="hidden min-[1280px]:inline text-xs font-semibold text-white/85 max-w-[90px] truncate">
          {user?.name ?? 'Me'}
        </span>
        {user?.isPremium && (
          <Crown className="w-3.5 h-3.5 text-[var(--qk-gold)]" fill="currentColor" />
        )}
      </button>
    </header>
  )
}
