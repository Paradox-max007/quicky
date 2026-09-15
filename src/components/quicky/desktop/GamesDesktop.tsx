'use client'

// Quicky — DESKTOP GAMES HUB (Web Premium PRD §39-§43/§59/§74)
// Full desktop page: featured game (Spin the Bottle) with REAL live numbers
// from the dashboard endpoint, the all-games grid, and the league
// progression block. No fabricated events, no fake player counts (§59).

import { Dices, Users, CircleDot as RouletteIcon, Play, Crown, Zap } from 'lucide-react'
import { useQuickyStore } from '@/store/quicky'
import { useDashboard } from './useDashboard'
import { SectionHeader, SkeletonBlock } from './web-ui'
import { cn } from '@/lib/utils'

export function GamesDesktop() {
  const setView = useQuickyStore((s) => s.setView)
  const roomId = useQuickyStore((s) => s.spinBottleRoomId)
  const user = useQuickyStore((s) => s.user)
  const { data, loaded } = useDashboard(true)
  const stats = data?.stats ?? null
  const live = data?.live ?? null

  const play = () => setView(roomId ? 'spin-bottle-room' : 'spin-bottle')

  return (
    <div className="flex flex-col gap-10">
      {/* Page purpose (§78): title + one primary action */}
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Games</h1>
          <p className="text-sm text-white/50 mt-1">Discover games, compete and connect.</p>
        </div>
        {roomId && (
          <span className="text-[11px] font-semibold text-[var(--qk-accent)] bg-[var(--qk-accent)]/10 border border-[var(--qk-accent)]/25 rounded-full px-3 py-1.5">
            Your table is live
          </span>
        )}
      </header>

      {/* ── Featured game (§41) ─────────────────────────────────────────── */}
      <section data-testid="games-featured">
        <button
          onClick={play}
          className="qk-featured group relative w-full text-left rounded-3xl overflow-hidden border border-white/10 bg-gradient-to-br from-[var(--qk-accent)] via-[#B23A6E] to-[var(--qk-purple)]"
          data-testid="games-featured-card"
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(255,255,255,0.22),transparent_55%)]" aria-hidden />
          <div className="relative flex items-center gap-8 p-8 min-[1600px]:p-10">
            <div className="shrink-0 w-24 h-24 min-[1600px]:w-28 min-[1600px]:h-28 rounded-3xl bg-black/25 border border-white/15 flex items-center justify-center transition-transform duration-200 group-hover:scale-105">
              <Dices className="w-12 h-12 text-white" aria-hidden />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-bold tracking-[0.22em] text-white/70 uppercase">Featured game</p>
              <h2 className="text-3xl font-black text-white mt-1.5 tracking-tight">Spin the Bottle</h2>
              <p className="text-sm text-white/85 mt-2 max-w-[52ch] leading-relaxed">
                Join a live table with up to 12 players — spins, dares, kisses and gifts in real time.
              </p>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 mt-4 text-xs text-white/85">
                {live ? (
                  <>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-[#30D158]" aria-hidden />
                      <b className="font-bold">{live.players}</b>&nbsp;players at tables
                    </span>
                    <span>
                      <b className="font-bold">{live.rooms}</b>&nbsp;live room{live.rooms === 1 ? '' : 's'}
                    </span>
                  </>
                ) : (
                  <SkeletonBlock className="h-4 w-48" />
                )}
                {stats && stats.gamesPlayed > 0 && <span>You've played <b className="font-bold">{stats.gamesPlayed}</b></span>}
                {stats && stats.kisses > 0 && <span>💋 <b className="font-bold">{stats.kisses}</b> Kiss Points</span>}
              </div>
            </div>
            <div className="shrink-0 flex flex-col items-center gap-2">
              <span className="qk-cta flex items-center gap-2 rounded-full bg-white text-[var(--qk-accent)] font-black text-sm px-7 py-3.5 shadow-xl">
                <Play className="w-4 h-4" fill="currentColor" />
                {roomId ? 'RETURN TO TABLE' : 'PLAY NOW'}
              </span>
              <span className="text-[10px] text-white/70">Free to join</span>
            </div>
          </div>
        </button>
      </section>

      {/* ── All games (§42): honest statuses, no tiny fake cards ────────── */}
      <section>
        <SectionHeader title="All games" />
        <div className="grid grid-cols-3 gap-5">
          <div
            className={cn(
              'rounded-3xl border border-[var(--qk-accent)]/25 bg-[var(--qk-card)]/60 p-5 flex flex-col gap-3',
              'transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-lg'
            )}
            data-testid="games-grid"
          >
            <div className="w-12 h-12 rounded-2xl bg-[var(--qk-accent)]/15 flex items-center justify-center">
              <Dices className="w-6 h-6 text-[var(--qk-accent)]" />
            </div>
            <div className="flex-1">
              <p className="font-bold">Spin the Bottle</p>
              <p className="text-xs text-white/50 mt-1 leading-relaxed">Live multiplayer party game with system-controlled spins.</p>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-[#30D158] bg-[#30D158]/10 rounded-full px-2 py-0.5">LIVE</span>
              <button onClick={play} className="text-xs font-bold text-[var(--qk-accent)] hover:text-white transition-colors">
                Play →
              </button>
            </div>
          </div>

          {/* Real roadmap entries — honest "coming soon" status (§59) */}
          {[
            { icon: RouletteIcon, name: 'Roulette', color: 'var(--qk-gold)' },
            { icon: Users, name: 'Ludo', color: 'var(--qk-purple)' },
          ].map((g) => (
            <div
              key={g.name}
              className="rounded-3xl border border-white/8 bg-[var(--qk-card)]/40 p-5 flex flex-col gap-3 opacity-80"
            >
              <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center">
                <g.icon className="w-6 h-6" style={{ color: g.color }} />
              </div>
              <div className="flex-1">
                <p className="font-bold text-white/85">{g.name}</p>
                <p className="text-xs text-white/40 mt-1 leading-relaxed">In the works — launching in a future update.</p>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-white/40 bg-white/5 rounded-full px-2 py-0.5">COMING SOON</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Progression (§74: league info from real data) ────────────────── */}
      <section>
        <SectionHeader title="Your progression" />
        <div className="rounded-3xl border border-white/8 bg-[var(--qk-card)]/60 p-6 flex items-center gap-6" data-testid="games-progress">
          <div className="w-14 h-14 rounded-2xl bg-[var(--qk-gold)]/12 border border-[var(--qk-gold)]/25 flex items-center justify-center shrink-0">
            <Crown className="w-7 h-7 text-[var(--qk-gold)]" />
          </div>
          {stats ? (
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-3 flex-wrap">
                <p className="font-bold">{stats.league ? `${stats.league.name} League` : 'Build your league standing'}</p>
                <span className="text-xs text-white/45">✨ {stats.points.toLocaleString()} Quicky Points</span>
                {stats.streak && stats.streak.current > 0 && (
                  <span className="text-xs text-white/45">🔥 {stats.streak.current}-day streak</span>
                )}
                {user?.isPremium && (
                  <span className="flex items-center gap-1 text-[11px] font-bold text-[var(--qk-gold)]">
                    <Zap className="w-3 h-3" fill="currentColor" /> Premium
                  </span>
                )}
              </div>
              {stats.league?.nextName && stats.league.nextMinimumPoints != null && (
                <div className="mt-3">
                  <div className="h-1.5 rounded-full bg-white/8 overflow-hidden max-w-md">
                    <div
                      className="h-full rounded-full bg-gold-gradient"
                      style={{
                        width: `${Math.max(4, Math.min(100, Math.round(((stats.points - stats.league.minimumPoints) / Math.max(1, stats.league.nextMinimumPoints - stats.league.minimumPoints)) * 100)))}%`,
                      }}
                    />
                  </div>
                  <p className="text-[11px] text-white/40 mt-1.5">
                    {Math.max(0, stats.league.nextMinimumPoints - stats.points).toLocaleString()} points to {stats.league.nextName}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col gap-2">
              <SkeletonBlock className="h-5 w-52" />
              <SkeletonBlock className="h-1.5 w-full max-w-md" />
            </div>
          )}
          <button
            onClick={play}
            className="shrink-0 text-sm font-bold bg-coral-gradient rounded-full px-5 py-2.5 active:scale-95 transition-transform"
          >
            Earn points
          </button>
        </div>
      </section>
    </div>
  )
}
