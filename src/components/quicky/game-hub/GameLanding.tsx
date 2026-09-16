'use client'

// Quicky — GAME LANDING (Game Hub PRD §12-§27/§59-§62/§70)
//
// One landing page per game, reached from its Game Card:
//   Games → [card] → Game Landing → (Play Now) → room / coming-soon state
//
// Structure follows the reference translation (§61):
//   records → game identity → game description → mode selection → Play Now
//   → progress / chemistry / league
// Spin the Bottle reuses the rich existing landing (hero + matchmaking modal
// + rules + game chats); every other game gets this generic, honest landing
// (no gameplay yet → real "Coming soon" state, §70).

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Trophy, Flame, Sparkles, Gift, Heart, Gamepad2, Users, HeartHandshake, Lock, Plus } from 'lucide-react'
import { api } from '@/lib/quicky/api-client'
import { useQuickyStore } from '@/store/quicky'
import { SpinBottleLanding } from '../SpinBottleLanding'
import { CoinStoreSheet } from '../CoinStoreSheet'
import { ChemistryIndicator } from './ChemistryIndicator'
import { GameFriendsSection } from './GameFriendsSection'
import { artworkGradient, modeLabel, type GameDef } from './types'

type LandingStats = {
  gamesPlayed: number
  kissesReceived: number
  kissesGiven: number
  giftsSent: number
  giftsReceived: number
  coins: number
  level: number
  quickyPoints: number
  streak: { current: number; longest: number }
  league: { name: string; minimumPoints: number; nextName: string | null; nextMinimumPoints: number | null } | null
  chemistry: { overall: number; datingContribution: number; gameContribution: number }
  dating: { likesReceived: number; matches: number }
}

export function GameLanding() {
  const slug = useQuickyStore((s) => s.gameLandingSlug)
  const setView = useQuickyStore((s) => s.setView)
  const setSpinBottleRoomId = useQuickyStore((s) => s.setSpinBottleRoomId)
  const [game, setGame] = useState<GameDef | null>(null)
  const [stats, setStats] = useState<LandingStats | null>(null)
  const [failed, setFailed] = useState(false)
  // Refactor PRD §24 — coin chip with "+" opens the Coin Purchase modal
  // (the same CoinStoreSheet architecture used in the room).
  const [coinStoreOpen, setCoinStoreOpen] = useState(false)
  const [coinBalance, setCoinBalance] = useState(0)
  const [mode, setMode] = useState<'group' | 'two'>('group')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setFailed(false)
      try {
        const [cat, s] = await Promise.all([api.games.list(), api.spinBottle.landing()])
        if (cancelled) return
        setGame(cat.games?.find((g: GameDef) => g.slug === slug) ?? null)
        setCoinBalance(s?.coins ?? 0)
        setStats(s as LandingStats)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [slug])

  // Spin the Bottle owns its rich landing (hero + matchmaking modal + rules).
  if (slug === 'spin-the-bottle') {
    return (
      <SpinBottleLanding
        onClose={() => setView('games')}
        backLabel="Back to Games"
        onJoined={(roomId) => {
          setSpinBottleRoomId(roomId)
          setView('spin-bottle-room')
        }}
      />
    )
  }

  const back = () => setView('games')

  if (failed) {
    return (
      <div className="w-full h-full flex flex-col bg-[var(--qk-bg)] text-white">
        <LandingHeader title="Game" onBack={back} />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8 text-center">
          <span className="text-4xl" aria-hidden>🎮</span>
          <p className="text-white/60 text-sm">We couldn&apos;t load this game.</p>
          <button
            onClick={() => setView('games')}
            className="text-sm font-bold text-[var(--qk-accent)] px-5 py-2.5 rounded-full border border-[var(--qk-accent)]/30"
          >
            Back to Games
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full h-full flex flex-col bg-[var(--qk-bg)] text-white relative overflow-hidden">
      {/* Ambient glow (§24: dark background + theme-colored glow) */}
      <div
        className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-96 h-72 rounded-full bg-[var(--qk-accent)]/12 blur-3xl"
        aria-hidden
      />

      <LandingHeader title={game?.name ?? 'Game'} onBack={back} />

      <div className="flex-1 overflow-y-auto no-scrollbar relative z-10 px-5 pb-10">
        <div className="w-full max-w-2xl mx-auto flex flex-col gap-5">
          {/* ── Hero (§24: artwork + theme glow; §62 art → name) ─────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="relative rounded-3xl overflow-hidden border border-white/10"
          >
            <div className={`relative aspect-[16/9] ${artworkGradient(game?.artwork ?? 'coral')} flex items-center justify-center`}>
              <div
                className="absolute inset-0 bg-[radial-gradient(circle_at_28%_20%,rgba(255,255,255,0.25),transparent_55%)]"
                aria-hidden
              />
              <span className="text-7xl drop-shadow-xl" aria-hidden>{game?.icon ?? '🎲'}</span>
              {!game?.isPlayable && (
                <span className="absolute top-3 left-3 rounded-full bg-black/50 backdrop-blur px-3 py-1 text-[10px] font-black tracking-wider text-white/80">
                  COMING SOON
                </span>
              )}
            </div>
            <div className="bg-[var(--qk-card)]/80 border-t border-white/8 px-5 py-4">
              <h2 className="text-2xl font-black tracking-tight">{game?.name ?? 'Game'}</h2>
              <p className="text-sm text-white/60 mt-1">{game?.shortDescription}</p>
              <p className="text-[11px] font-semibold text-white/45 mt-2">{game ? modeLabel(game) : ''}</p>
            </div>
          </motion.div>

          {/* ── Coin chip (§24: existing box + "+" → purchase modal) ──── */}
          <div className="flex items-center justify-between rounded-2xl border border-white/8 bg-[var(--qk-card)]/70 px-4 py-3">
            <span className="flex items-center gap-2 text-sm font-bold tabular-nums">
              🪙 {coinBalance.toLocaleString('en-US')}
            </span>
            <button
              onClick={() => setCoinStoreOpen(true)}
              className="w-8 h-8 rounded-full bg-[var(--qk-accent)]/15 border border-[var(--qk-accent)]/30 flex items-center justify-center active:scale-95 transition-transform"
              aria-label="Buy coins"
              data-testid="landing-coin-add"
            >
              <Plus className="w-4 h-4 text-[var(--qk-accent-light)]" />
            </button>
          </div>

          {/* ── Your records (§59: icon + value + label, real user data) ── */}
          <section>
            <p className="text-[11px] font-black tracking-[0.18em] text-white/40 uppercase mb-2.5">Your records</p>
            <div className="grid grid-cols-2 gap-3">
              <RecordBox icon={<Heart className="w-4 h-4" />} value={stats?.kissesReceived ?? 0} label="Game Points" tint="var(--qk-accent)" />
              <RecordBox icon={<Gamepad2 className="w-4 h-4" />} value={stats?.gamesPlayed ?? 0} label="Games" tint="var(--qk-purple)" />
              <RecordBox icon={<Flame className="w-4 h-4" />} value={stats?.streak.current ?? 0} label="Streak" tint="#FF9120" />
              <RecordBox icon={<Sparkles className="w-4 h-4" />} value={stats?.quickyPoints ?? 0} label="Quicky Points" tint="var(--qk-gold)" />
              <RecordBox icon={<Gift className="w-4 h-4" />} value={(stats?.giftsSent ?? 0) + (stats?.giftsReceived ?? 0)} label="Gifts" tint="#f472b6" />
              <RecordBox
                icon={<Trophy className="w-4 h-4" />}
                value={stats?.league?.name ?? '—'}
                label="League"
                tint="#30D158"
                isText
              />
            </div>
          </section>

          {/* ── Your progress (§60: league / streak / chemistry / points) ── */}
          <section>
            <p className="text-[11px] font-black tracking-[0.18em] text-white/40 uppercase mb-2.5">Your progress</p>
            <div className="rounded-3xl border border-white/8 bg-[var(--qk-card)]/60 p-5 flex flex-col gap-4">
              {stats?.league && (
                <div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 font-bold">
                      <Trophy className="w-4 h-4 text-[var(--qk-gold)]" /> {stats.league.name} League
                    </span>
                    {stats.league.nextName && (
                      <span className="text-[11px] text-white/40">
                        {Math.max(0, stats.league.nextMinimumPoints! - stats.quickyPoints).toLocaleString('en-US')} to {stats.league.nextName}
                      </span>
                    )}
                  </div>
                  {stats.league.nextName && stats.league.nextMinimumPoints != null && (
                    <div className="h-1.5 rounded-full bg-white/8 overflow-hidden mt-2">
                      <div
                        className="h-full rounded-full bg-gold-gradient"
                        style={{
                          width: `${Math.max(4, Math.min(100, Math.round(((stats.quickyPoints - stats.league.minimumPoints) / Math.max(1, stats.league.nextMinimumPoints - stats.league.minimumPoints)) * 100)))}%`,
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
              {stats && <ChemistryIndicator value={stats.chemistry.overall} />}
              <div className="flex items-center gap-4 text-xs text-white/55">
                <span className="flex items-center gap-1.5">
                  <Flame className="w-3.5 h-3.5 text-[#FF9120]" /> {stats?.streak.current ?? 0}-day streak
                </span>
                <span className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-[var(--qk-gold)]" /> {(stats?.quickyPoints ?? 0).toLocaleString('en-US')} points
                </span>
                <span className="flex items-center gap-1.5">
                  <Heart className="w-3.5 h-3.5 text-[var(--qk-accent)]" /> {stats?.dating.likesReceived ?? 0} likes
                </span>
              </div>
            </div>
          </section>

          {/* ── My Friends (§26: real friendships, Chat + Profile per friend) */}
          <GameFriendsSection returnView="game-landing" />

          {/* ── Game information (§13: GAME INFORMATION section) ─────────── */}
          <section>
            <p className="text-[11px] font-black tracking-[0.18em] text-white/40 uppercase mb-2.5">Game information</p>
            <div className="rounded-3xl border border-white/8 bg-[var(--qk-card)]/60 p-5 text-sm text-white/70 leading-relaxed">
              {game?.description || game?.shortDescription || 'Details are on the way.'}
            </div>
          </section>

          {/* ── Mode selection (§25: only modes supported by that game) ──── */}
          {game && game.supportedModes !== 'GROUP' && (
            <section>
              <p className="text-[11px] font-black tracking-[0.18em] text-white/40 uppercase mb-2.5">How do you want to play?</p>
              <div className="grid grid-cols-2 gap-3">
                <ModeOption
                  active={mode === 'group'}
                  onClick={() => setMode('group')}
                  icon={<Users className="w-5 h-5" />}
                  title="Group"
                  sub="Play with people"
                />
                <ModeOption
                  active={mode === 'two'}
                  onClick={() => setMode('two')}
                  icon={<HeartHandshake className="w-5 h-5" />}
                  title="2 Players"
                  sub="Play with a partner"
                />
              </div>
            </section>
          )}

          {/* ── Honest CTA (§70: no fake play — real coming-soon state) ──── */}
          {game && !game.isPlayable && (
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6 flex flex-col items-center text-center gap-2">
              <span className="text-3xl" aria-hidden>🎮</span>
              <p className="font-black">This one is still in the works</p>
              <p className="text-xs text-white/55 leading-relaxed max-w-[36ch]">
                More games are coming soon. Check back for new ways to play — Spin the Bottle is live right now.
              </p>
              <button
                onClick={() => setView('games')}
                className="mt-1 flex items-center gap-2 rounded-full bg-white/8 border border-white/12 px-5 py-2.5 text-xs font-bold text-white/75 hover:bg-white/12 transition-colors"
              >
                <Lock className="w-3.5 h-3.5" aria-hidden /> Playable games
              </button>
            </div>
          )}
        </div>
      </div>
      <CoinStoreSheet
        open={coinStoreOpen}
        onClose={() => setCoinStoreOpen(false)}
        coinBalance={coinBalance}
        onPurchased={(nb) => setCoinBalance(nb)}
      />
    </div>
  )
}

function LandingHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="shrink-0 safe-area-top px-3 pt-2.5 pb-2 flex items-center gap-2 relative z-20">
      <button onClick={onBack} className="p-2 rounded-full hover:bg-white/10" aria-label="Back to Games">
        <ArrowLeft className="w-5 h-5" />
      </button>
      <h1 className="text-lg font-bold truncate">{title}</h1>
    </header>
  )
}

function RecordBox({
  icon,
  value,
  label,
  tint,
  isText = false,
}: {
  icon: React.ReactNode
  value: number | string
  label: string
  tint: string
  isText?: boolean
}) {
  return (
    <div className="rounded-2xl border border-white/8 bg-[var(--qk-card)]/70 p-4 flex flex-col items-center text-center gap-1">
      <span style={{ color: tint }}>{icon}</span>
      <p className="text-xl font-black tabular-nums leading-none mt-1">
        {isText ? value : typeof value === 'number' ? value.toLocaleString('en-US') : value}
      </p>
      <p className="text-[10px] text-white/50 uppercase tracking-wide">{label}</p>
    </div>
  )
}

function ModeOption({
  active,
  onClick,
  icon,
  title,
  sub,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  title: string
  sub: string
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-2xl border p-4 text-left transition-all ${
        active
          ? 'border-[var(--qk-accent)]/60 bg-[var(--qk-accent)]/10'
          : 'border-white/10 bg-[var(--qk-card)]/60 hover:border-white/20'
      }`}
      aria-pressed={active}
    >
      <span className={active ? 'text-[var(--qk-accent)]' : 'text-white/70'}>{icon}</span>
      <p className="font-bold text-sm mt-1.5">{title}</p>
      <p className="text-[11px] text-white/50">{sub}</p>
    </button>
  )
}
