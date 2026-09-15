'use client'

import { useQuickyStore } from '@/store/quicky'
import { Flame, Sparkles, Heart, Trophy, Gamepad2, Gift, MessageCircle, ChevronRight, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DashboardData, timeAgo } from './useDashboard'

/**
 * Right-side "MY QUICKY" panel (concept doc §11/§12/§36): progression stats
 * with distinct meanings — Streak (return visits), Quicky Points
 * (engagement), Kiss Points (game-specific), League (game progression from
 * real GameLeague tiers), Games played. Empty numbers become actions, not
 * empty cards (§48). Below it: RECENT ACTIVITY (§22).
 */

function StatRow({
  icon,
  color,
  label,
  value,
  hint,
  cta,
  onCta,
  testid,
}: {
  icon: React.ReactNode
  color: string
  label: string
  value: string
  hint?: string | null
  cta?: string | null
  onCta?: () => void
  testid?: string
}) {
  if (cta && onCta) {
    return (
      <button onClick={onCta} className="qk-desk-stat w-full flex items-center gap-3 px-3 py-2.5 group" data-testid={testid}>
        <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: color + '1f' }}>
          {icon}
        </span>
        <span className="min-w-0 text-left">
          <span className="block text-[10px] font-bold tracking-widest text-white/40 uppercase">{label}</span>
          <span className="block text-xs font-medium text-[var(--qk-accent)] group-hover:text-[var(--qk-accent-light)] truncate">
            {cta} →
          </span>
        </span>
        <ChevronRight className="w-4 h-4 text-white/25 ml-auto shrink-0 group-hover:text-white/50 transition-colors" />
      </button>
    )
  }
  return (
    <div className="qk-desk-stat w-full flex items-center gap-3 px-3 py-2.5" data-testid={testid}>
      <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: color + '1f' }}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[10px] font-bold tracking-widest text-white/40 uppercase">{label}</span>
        <span className="block text-sm font-bold text-white/90 leading-tight">{value}</span>
      </span>
      {hint && <span className="ml-auto text-[10px] text-white/35 text-right leading-tight max-w-[110px]">{hint}</span>}
    </div>
  )
}

const ACTIVITY_ICON = {
  like: Heart,
  match: Sparkles,
  kiss: Flame,
  gift: Gift,
  message: MessageCircle,
} as const
const ACTIVITY_COLOR = {
  like: 'text-[var(--qk-accent)]',
  match: 'text-[var(--qk-purple)]',
  kiss: 'text-[var(--qk-accent-light)]',
  gift: 'text-[var(--qk-gold)]',
  message: 'text-white/70',
} as const

export function MyQuickyPanel({ dashboard, onRefresh }: { dashboard: DashboardData | null; onRefresh: () => void }) {
  const setView = useQuickyStore((s) => s.setView)
  const stats = dashboard?.stats ?? null
  const activity = dashboard?.activity ?? []

  return (
    <div className="flex flex-col gap-5" data-testid="desktop-my-quicky">
      {/* ─── MY QUICKY (§11) ─────────────────────────────────────────────── */}
      <section className="rounded-3xl border border-white/8 bg-[var(--qk-card)]/60 p-4">
        <div className="flex items-center justify-between px-1 mb-2">
          <p className="text-[11px] font-bold tracking-widest text-white/40 uppercase">My Quicky</p>
          <button
            onClick={onRefresh}
            className="text-white/30 hover:text-white/70 transition-colors"
            aria-label="Refresh stats"
          >
            <Zap className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex flex-col gap-0.5">
          <StatRow
            icon={<Flame className="w-[18px] h-[18px] text-[var(--qk-accent)]" />}
            color="var(--qk-accent)"
            label="Day Streak"
            value={stats ? (stats.streak ? `${stats.streak.current} day${stats.streak.current === 1 ? '' : 's'}` : '0 days') : '—'}
            hint={stats?.streak && stats.streak.longest > stats.streak.current ? `Best: ${stats.streak.longest}` : stats?.streak && stats.streak.current > 0 ? 'Keep it going!' : null}
            cta={stats && (!stats.streak || stats.streak.current === 0) ? 'Send a Quicky Image to start' : null}
            onCta={() => setView('community')}
            testid="stat-streak"
          />
          <StatRow
            icon={<Sparkles className="w-[18px] h-[18px] text-[var(--qk-purple)]" />}
            color="var(--qk-purple)"
            label="Quicky Points"
            value={stats ? stats.points.toLocaleString() : '—'}
            hint="Engagement score"
            testid="stat-points"
          />
          <StatRow
            icon={<Heart className="w-[18px] h-[18px] text-[var(--qk-accent-light)]" />}
            color="var(--qk-accent-light)"
            label="Kiss Points"
            value={stats ? stats.kisses.toLocaleString() : '—'}
            hint="Game interactions"
            cta={stats && stats.kisses === 0 ? 'Play Spin the Bottle to earn' : null}
            onCta={() => setView('spin-bottle')}
            testid="stat-kisses"
          />
          <StatRow
            icon={<Trophy className="w-[18px] h-[18px] text-[var(--qk-gold)]" />}
            color="var(--qk-gold)"
            label="League"
            value={stats?.league ? stats.league.name : '—'}
            hint={stats?.league?.nextName ? `${stats.league.nextMinimumPoints! - Math.max(stats.league.minimumPoints, stats?.points ?? 0)} pts to ${stats.league.nextName}` : stats?.league ? 'Top tier' : null}
            testid="stat-league"
          />
          <StatRow
            icon={<Gamepad2 className="w-[18px] h-[18px] text-white/80" />}
            color="#9CA3AF"
            label="Games"
            value={stats ? `${stats.gamesPlayed}` : '—'}
            cta={stats && stats.gamesPlayed === 0 ? 'Play your first game' : null}
            onCta={() => setView('spin-bottle')}
            testid="stat-games"
          />
        </div>
      </section>

      {/* ─── RECENT ACTIVITY (§22) ───────────────────────────────────────── */}
      <section className="rounded-3xl border border-white/8 bg-[var(--qk-card)]/60 p-4" data-testid="desktop-recent-activity">
        <p className="text-[11px] font-bold tracking-widest text-white/40 uppercase px-1 mb-2">Recent Activity</p>

        <div className="flex flex-col">
          {activity.length === 0 && (
            <div className="px-2 py-6 text-center">
              <Sparkles className="w-6 h-6 text-white/20 mx-auto mb-2" />
              <p className="text-xs text-white/50 leading-relaxed">
                Likes, matches, kisses, gifts and messages will show up here as they happen.
              </p>
            </div>
          )}
          {activity.map((a, idx) => {
            const Icon = ACTIVITY_ICON[a.kind]
            return (
              <button
                key={a.id}
                onClick={() => setView(a.kind === 'like' ? 'likes-you' : a.kind === 'gift' || a.kind === 'kiss' ? 'community' : 'matches')}
                className={cn(
                  'qk-desk-stat w-full flex items-start gap-3 px-2 py-2.5 text-left',
                  idx < 4 && 'qk-desk-fade'
                )}
              >
                {a.actorPhoto ? (
                   
                  <img src={a.actorPhoto} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                ) : (
                  <span className="w-8 h-8 rounded-full bg-white/8 flex items-center justify-center shrink-0">
                    <Icon className={cn('w-4 h-4', ACTIVITY_COLOR[a.kind])} />
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
      </section>
    </div>
  )
}
