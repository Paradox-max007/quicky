'use client'

// Quicky — UNIFIED CHAT TABS + DATING CONTACT ROWS (Game Hub PRD §28-§33/§50)
//
// One shared Chat Center concept with TWO conversation types — Game Chats
// and Dating Chats (§28). These small shared pieces render the tab switcher
// and the dating contact list inside EVERY unified surface:
//   · UnifiedChatsScreen (mobile main Chats tab)
//   · GameChatContactsScreen (Capacitor in-game contacts screen)
//   · GameContactsPanel (web in-room contacts pane)
// The conversation components themselves stay shared too: GameChatScreen for
// game chats, ChatView for dating chats — only the data source changes (§34).

import { useEffect, useState } from 'react'
import { BadgeCheck, Crown, Flame } from 'lucide-react'
import { api } from '@/lib/quicky/api-client'
import { useQuickyStore, MatchPreview } from '@/store/quicky'
import { cn } from '@/lib/utils'
import { SkeletonBlock } from '../desktop/web-ui'
import { timeAgo } from '../desktop/useDashboard'

// ─── Tabs (§30: active tab has the Quicky accent) ───────────────────────────
export function ChatTypeTabs({
  section,
  onChange,
  gameUnread = 0,
  datingUnread = 0,
}: {
  section: 'game' | 'dating'
  onChange: (s: 'game' | 'dating') => void
  gameUnread?: number
  datingUnread?: number
}) {
  return (
    <div className="flex gap-1 bg-white/5 rounded-full p-1" role="tablist" aria-label="Chat lists">
      <button
        role="tab"
        aria-selected={section === 'game'}
        onClick={() => onChange('game')}
        className={cn(
          'flex-1 rounded-full py-1.5 text-xs font-semibold transition-all',
          section === 'game' ? 'bg-coral-gradient text-white' : 'text-white/55 hover:text-white/80'
        )}
        data-testid="chats-tab-game"
      >
        💬 Game Chats
        {gameUnread > 0 && (
          <span className="ml-1 text-[10px] font-black bg-white/20 rounded-full px-1.5 py-px">{gameUnread}</span>
        )}
      </button>
      <button
        role="tab"
        aria-selected={section === 'dating'}
        onClick={() => onChange('dating')}
        className={cn(
          'flex-1 rounded-full py-1.5 text-xs font-semibold transition-all',
          section === 'dating' ? 'bg-coral-gradient text-white' : 'text-white/55 hover:text-white/80'
        )}
        data-testid="chats-tab-dating"
      >
        💗 Dating Chats
        {datingUnread > 0 && (
          <span className="ml-1 text-[10px] font-black bg-white/20 rounded-full px-1.5 py-px">{datingUnread}</span>
        )}
      </button>
    </div>
  )
}

// ─── Dating contact rows (mobile-size, reused by both mobile surfaces) ─────
export function useDatingMatches(pollMs = 10000) {
  const [matches, setMatches] = useState<MatchPreview[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const refresh = async () => {
    try {
      const res = await api.matches()
      setMatches(res.matches ?? [])
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    const iv = setInterval(() => void refresh(), pollMs)
    return () => clearInterval(iv)
  }, [])

  return { matches, loading, failed, refresh }
}

export function DatingContactRows({
  matches,
  loading,
  failed,
  onRetry,
  onPick,
  activeMatchId,
  searchQuery = '',
}: {
  matches: MatchPreview[]
  loading: boolean
  failed: boolean
  onRetry: () => void
  onPick: (matchId: string) => void
  activeMatchId?: string | null
  searchQuery?: string
}) {
  const unreadByMatch = useQuickyStore((s) => s.unreadByMatch)

  if (loading) {
    return (
      <div className="flex flex-col gap-3 px-2 pt-2" data-testid="chats-dating-skeleton">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <SkeletonBlock className="w-10 h-10 rounded-full shrink-0" />
            <div className="flex-1 flex flex-col gap-1.5">
              <SkeletonBlock className="h-3.5 w-1/2" />
              <SkeletonBlock className="h-3 w-4/5" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (failed && matches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 text-center px-6 py-10">
        <p className="text-white/55 text-xs">Couldn&apos;t load your dating chats.</p>
        <button onClick={onRetry} className="text-xs font-bold text-[var(--qk-accent)]" data-testid="chats-dating-retry">
          Retry
        </button>
      </div>
    )
  }

  const q = searchQuery.trim().toLowerCase()
  const filtered = q
    ? matches.filter((m) => (m.partner.name ?? '').toLowerCase().includes(q))
    : matches

  if (filtered.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-6 py-10">
        <span className="text-3xl" aria-hidden>💌</span>
        <p className="text-white/55 text-xs leading-relaxed">
          {q ? 'No dating chats match that search.' : 'No dating chats yet — start swiping in Discover to make a match.'}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col" data-testid="chats-dating-list">
      {filtered.map((m) => {
        const badge = unreadByMatch[m.id] ?? m.unreadCount ?? 0
        const active = activeMatchId === m.id
        const online =
          !m.partner.hideOnline &&
          m.partner.lastActiveAt &&
          Date.now() - new Date(m.partner.lastActiveAt).getTime() < 5 * 60 * 1000
        return (
          <button
            key={m.id}
            data-testid={`chats-dating-row-${m.id}`}
            onClick={() => onPick(m.id)}
            className={cn(
              'w-full flex items-center gap-3 px-2 py-2.5 rounded-xl text-left transition-colors',
              active ? 'bg-white/8' : 'hover:bg-white/5'
            )}
          >
            <span className="relative shrink-0">
              {m.partner.photo ? (
                <img src={m.partner.photo} alt="" className="w-11 h-11 rounded-full object-cover" />
              ) : (
                <span className="w-11 h-11 rounded-full bg-white/10 flex items-center justify-center text-sm font-bold">
                  {m.partner.name?.[0] ?? '?'}
                </span>
              )}
              {online && <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-[#30D158] border-2 border-[var(--qk-bg)]" />}
              {badge > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-coral-gradient text-[10px] font-black text-white flex items-center justify-center">
                  {badge > 9 ? '9+' : badge}
                </span>
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="flex items-center gap-1 min-w-0">
                  <span className="text-white text-sm font-semibold truncate">
                    {m.partner.name}
                    {m.partner.age != null ? `, ${m.partner.age}` : ''}
                  </span>
                  {m.partner.isVerified && (
                    <BadgeCheck className="w-3.5 h-3.5 text-[var(--qk-accent)] shrink-0" fill="currentColor" stroke="white" />
                  )}
                  {m.partner.isPremium && (
                    <Crown className="w-3 h-3 text-[var(--qk-gold)] shrink-0" fill="currentColor" stroke="none" />
                  )}
                </span>
                {m.streak > 0 && (
                  <span className="flex items-center gap-0.5 shrink-0 text-[11px] font-semibold text-[var(--qk-gold)]">
                    <Flame className="w-3 h-3" fill="currentColor" stroke="none" />
                    {m.streak}
                  </span>
                )}
              </span>
              <span className="flex items-center justify-between gap-2">
                <span className={cn('text-xs truncate', badge > 0 ? 'text-white/85 font-medium' : 'text-white/45')}>
                  {m.preview || 'Say hi 👋'}
                </span>
                <span className="text-white/35 text-[10px] shrink-0">
                  {m.lastMessageAt ? timeAgo(m.lastMessageAt) : ''}
                </span>
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
