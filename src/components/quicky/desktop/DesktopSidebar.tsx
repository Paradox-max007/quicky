'use client'

import { Dices } from 'lucide-react'
import { useQuickyStore } from '@/store/quicky'
import { useDashboard, DashboardData } from './useDashboard'
import { getScoreTier } from '@/lib/quicky/constants'
import { SkeletonBlock } from './web-ui'
import { cn } from '@/lib/utils'

/**
 * CONTEXTUAL SIDEBAR — a personal live status panel, NOT navigation
 * (Web Premium PRD §5-§7/§75/§83). Zero duplicated primary navigation
 * links: the top bar owns navigation; this rail owns the user's identity,
 * Quicky progression, dating stats, game stats and quick status — every
 * value a real dashboard read (§59: never fabricated).
 *
 * §7 responsiveness: profile + Quicky progress always visible on desktop;
 * the Dating/Games/Status groups collapse away on medium desktop (<1280px);
 * below 1024px this architecture does not exist at all (mobile keeps its
 * dedicated navigation).
 */

function StatRow({ icon, label, value, accent }: { icon: string; label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 px-1 py-1" data-accent={accent ? 'true' : undefined}>
      <span className="w-5 text-center text-[13px] leading-none" aria-hidden>
        {icon}
      </span>
      <span className="flex-1 text-xs text-white/55">{label}</span>
      <span className={cn('text-xs font-bold tabular-nums', accent ? 'text-[var(--qk-accent)]' : 'text-white/85')}>
        {value}
      </span>
    </div>
  )
}

function Group({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('px-1', className)}>
      <p className="text-[10px] font-bold tracking-[0.18em] text-white/35 uppercase mb-2">{title}</p>
      <div className="flex flex-col gap-0.5">{children}</div>
    </section>
  )
}

export function DesktopSidebar({ data, loaded }: { data: DashboardData | null; loaded: boolean }) {
  const user = useQuickyStore((s) => s.user)
  const roomId = useQuickyStore((s) => s.spinBottleRoomId)
  const setView = useQuickyStore((s) => s.setView)

  const stats = data?.stats ?? null
  const live = data?.live ?? null
  const avatar = user?.photos?.find((ph) => ph.isPrimary)?.url ?? user?.photos?.[0]?.url ?? null
  const tier = stats ? getScoreTier(stats.points) : null

  // §59: league progress is only drawn from REAL tiers
  const leaguePct = (() => {
    if (!stats?.league) return null
    const { minimumPoints, nextMinimumPoints } = stats.league
    if (!nextMinimumPoints || nextMinimumPoints <= minimumPoints) return null
    const pct = Math.round(((stats.points - minimumPoints) / (nextMinimumPoints - minimumPoints)) * 100)
    return Math.max(4, Math.min(100, pct))
  })()

  return (
    <aside
      className="shrink-0 h-full hidden lg:flex flex-col border-r border-white/5 bg-black/20 backdrop-blur-sm w-[248px] min-[1280px]:w-[276px] px-4 py-5 gap-5 overflow-y-auto qk-desk-scroll"
      data-testid="desktop-sidebar"
    >
      {/* ── Profile summary (§6) ─────────────────────────────────────────── */}
      <section className="flex flex-col items-center text-center gap-2.5 pt-1">
        {avatar ? (
          <img src={avatar} alt="" className="w-16 h-16 rounded-2xl object-cover border border-white/10" />
        ) : (
          <span className="w-16 h-16 rounded-2xl bg-white/10 flex items-center justify-center text-xl font-bold" aria-hidden>
            {(user?.name ?? 'Q').slice(0, 1).toUpperCase()}
          </span>
        )}
        <div>
          <p className="text-sm font-bold text-white/95 leading-tight">
            {user?.name ?? 'You'}
            {user?.age != null && <span className="text-white/50 font-medium">, {user.age}</span>}
          </p>
          <div className="flex items-center justify-center gap-1.5 mt-1">
            {user?.isVerified && (
              <span className="text-[10px] font-bold text-[var(--qk-accent)] bg-[var(--qk-accent)]/10 rounded-full px-2 py-0.5">
                Verified
              </span>
            )}
            {tier && (
              <span
                className="text-[10px] font-bold rounded-full px-2 py-0.5"
                style={{ color: tier.current.color, backgroundColor: tier.current.color + '1f' }}
              >
                {tier.current.name}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* ── Quicky Progress (§6) ─────────────────────────────────────────── */}
      <Group title="Quicky Progress">
        {loaded && !stats ? (
          <p className="text-[11px] text-white/35 px-1 py-1">Stats unavailable right now.</p>
        ) : !stats ? (
          <div className="flex flex-col gap-2 py-1">
            <SkeletonBlock className="h-4 w-4/5" />
            <SkeletonBlock className="h-4 w-3/5" />
            <SkeletonBlock className="h-1.5 w-full" />
          </div>
        ) : (
          <>
            <StatRow icon="🔥" label={stats.streak ? 'Day streak' : 'No streak yet'} value={stats.streak ? `${stats.streak.current}` : '—'} accent={!!stats.streak && stats.streak.current > 0} />
            <StatRow icon="✨" label="Quicky Points" value={stats.points.toLocaleString()} />
            <StatRow icon="💫" label="Chemistry" value={`${stats.chemistry}%`} accent />
            <div className="px-1 pt-1 pb-0.5" data-testid="sidebar-chemistry">
              <div className="h-1.5 rounded-full bg-white/8 overflow-hidden">
                <div className="h-full rounded-full bg-coral-gradient transition-all" style={{ width: `${Math.max(3, stats.chemistry)}%` }} />
              </div>
              <p className="text-[10px] text-white/35 mt-1">Dating + games · last 30 days</p>
            </div>
            {stats.league && (
              <div className="px-1 pt-1.5">
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="text-white/55">{stats.league.name} League</span>
                  {stats.league.nextName && (
                    <span className="text-white/35">{stats.league.nextName} @ {stats.league.nextMinimumPoints?.toLocaleString()}</span>
                  )}
                </div>
                {leaguePct !== null && (
                  <div className="h-1.5 rounded-full bg-white/8 overflow-hidden">
                    <div className="h-full rounded-full bg-gold-gradient" style={{ width: `${leaguePct}%` }} />
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </Group>

      {/* ── Dating / Games / Status — full desktop only (§7) ─────────────── */}
      <div className="hidden min-[1280px]:flex flex-col gap-5">
        <Group title="Dating">
          {!stats ? (
            <SkeletonBlock className="h-4 w-4/5" />
          ) : (
            <>
              <StatRow icon="❤️" label="Likes received" value={stats.likesReceived.toLocaleString()} />
              <StatRow icon="💗" label="Matches" value={stats.matches.toLocaleString()} />
            </>
          )}
        </Group>

        <Group title="Games">
          {!stats ? (
            <SkeletonBlock className="h-4 w-4/5" />
          ) : (
            <>
              <StatRow icon="🎮" label="Games played" value={stats.gamesPlayed.toLocaleString()} />
              <StatRow icon="💋" label="Game Points" value={stats.kisses.toLocaleString()} />
              <StatRow icon="🎁" label="Gifts received" value={stats.giftsReceived.toLocaleString()} />
            </>
          )}
        </Group>

        <Group title="Status">
          <div className="flex items-center gap-2 px-1 py-1">
            <span className="w-2.5 h-2.5 rounded-full bg-[#30D158] shrink-0" aria-hidden />
            <span className="text-xs text-white/70">Available</span>
          </div>
          {user?.lookingFor && (
            <p className="text-[11px] text-white/45 px-1 leading-relaxed">
              Looking for: <span className="text-white/70">{user.lookingFor.replace(/-/g, ' ')}</span>
            </p>
          )}
          {live && live.online > 0 && (
            <p className="text-[11px] text-white/40 px-1">
              <span className="text-[#30D158] font-semibold">{live.online}</span> members online now
            </p>
          )}
        </Group>
      </div>

      <div className="flex-1" />

      {/* §17/§84: one click back into the live table — the runtime never
          stopped while the user browses other pages. */}
      {roomId && (
        <button
          onClick={() => setView('spin-bottle-room')}
          className="flex items-center gap-2.5 rounded-2xl border border-[var(--qk-accent)]/25 bg-[var(--qk-accent)]/8 px-3 py-3 mx-1 hover:bg-[var(--qk-accent)]/15 transition-colors"
          data-testid="sidebar-return-to-table"
        >
          <Dices className="w-4.5 h-4.5 text-[var(--qk-accent)]" size={18} />
          <span className="min-w-0 text-left">
            <span className="block text-[11px] font-bold text-white/90 leading-tight">Game in progress</span>
            <span className="block text-[10px] text-white/50 leading-tight mt-0.5">Return to the table</span>
          </span>
        </button>
      )}
    </aside>
  )
}
