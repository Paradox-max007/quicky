'use client'

// Quicky — LUDO LANDING (Ludo PRD §71/§72/§74/§75 + Unified Game Primary PRD)
//
// A thin GAME ADAPTER around the reusable GamePrimaryScreen: it fetches the
// Ludo landing stats + catalog entry, builds the GamePrimaryConfig and wires
// the REAL server-authoritative [Play Now] CTA (§5/§6: the server assigns the
// room+seat, checking table availability AND the 2-male/2-female gender
// weighting). The screen itself — hero, profile/stat card with 💬/👥 icons,
// COMMON stats (same grid as every game), rotating texts, how-it-works — is
// rendered by GamePrimaryScreen for EVERY game (Unified PRD §3/§55).
//
// The statistics grid is the COMMON Quicky set (§6/§7 revised) — identical
// across games. No Kiss Points anywhere (§74).

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Users } from 'lucide-react'
import { api } from '@/lib/quicky/api-client'
import { useQuickyStore } from '@/store/quicky'
import { CoinStoreSheet } from '../CoinStoreSheet'
import { AnimatedPlayIcon } from '../game-primary/AnimatedPlayIcon'
import { GamePrimaryScreen } from '../game-primary/GamePrimaryScreen'
import { MatchmakingModal } from '../game-primary/MatchmakingModal'
import {
  buildLudoPrimaryConfig,
  type GameDef,
  type LudoLandingStats,
} from '../game-primary/game-configs'

const MODE_KEY = 'quicky-ludo-mode'

export function LudoLanding({
  onClose,
  onJoined,
}: {
  onClose: () => void
  onJoined: (roomId: string) => void
}) {
  const user = useQuickyStore((s) => s.user)
  const [game, setGame] = useState<GameDef | null>(null)
  const [stats, setStats] = useState<LudoLandingStats | null>(null)
  const [rules, setRules] = useState<{ id: string; title: string; description: string; icon: string }[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [joining, setJoining] = useState(false)
  const [coinStoreOpen, setCoinStoreOpen] = useState(false)
  const [coinBalance, setCoinBalance] = useState(0)
  // REVISED — the TABLE MODE is chosen BEFORE starting: a 2-player duel
  // (starts the moment the 2nd player joins, 3·2·1) or a full 4-player
  // table (waits for all four — "waiting for players…"). The choice
  // persists across sessions.
  const [mode, setMode] = useState<2 | 4>(2)
  useEffect(() => {
    // Deferred (react-hooks v6: no synchronous setState in effect bodies).
    const t = setTimeout(() => {
      try {
        if (Number(localStorage.getItem(MODE_KEY)) === 4) setMode(4)
      } catch {}
    }, 0)
    return () => clearTimeout(t)
  }, [])
  const pickMode = (m: 2 | 4) => {
    setMode(m)
    try {
      localStorage.setItem(MODE_KEY, String(m))
    } catch {}
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setFailed(false)
      try {
        // Admin-console PRD §5 — ludo's How-It-Works steps come from the DB
        // (admin-managed, per game); the built-in copy is the fallback.
        const [s, cat, rulesRes] = await Promise.all([
          api.ludo.landing(),
          api.games.list(),
          api.games.rules('ludo').catch(() => null),
        ])
        if (!cancelled) {
          setStats(s)
          setCoinBalance(s?.coins ?? 0)
          setGame(cat.games?.find((g: GameDef) => g.slug === 'ludo') ?? null)
          setRules((rulesRes?.rules ?? null) as { id: string; title: string; description: string; icon: string }[] | null)
        }
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const playNow = async () => {
    if (joining) return
    setJoining(true)
    try {
      // Server-authoritative matchmaking (Ludo PRD §6/§117 revised): the
      // client never decides which room or seat it gets — the server checks
      // MODE availability and assigns yards in DIAGONAL fill order (1→3→2→4:
      // the 2nd joiner sits diagonally opposite the 1st).
      const res = await api.ludo.join(mode)
      if (res?.ok && res.roomId) {
        onJoined(res.roomId)
      } else {
        toast.error('Could not find a table')
        setJoining(false)
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't join the table")
      setJoining(false)
    }
  }

  const avatar = user?.photos?.find((p: any) => p.isPrimary)?.url ?? user?.photos?.[0]?.url
  const config = buildLudoPrimaryConfig(game, stats, rules)

  return (
    <div className="w-full h-full flex flex-col bg-[var(--qk-bg)] text-white relative overflow-hidden">
      <GamePrimaryScreen
        config={config}
        backLabel="Back to Games"
        onBack={onClose}
        onPlay={() => void playNow()}
        playLabel="Play Now"
        // §54 revised — the dice icon INSIDE the button ROLLS (tumble + hop),
        // rests, and rolls again — a real die flicked onto the table.
        playIcon={<AnimatedPlayIcon kind="dice" />}
        playBusy={joining}
        playDisabled={failed}
        playTestId="ludo-play-now"
        playExtra={
          <div
            className="flex items-center justify-center gap-1.5 mb-3"
            role="radiogroup"
            aria-label="Table mode"
            data-testid="ludo-mode-pick"
          >
            {([2, 4] as const).map((m) => (
              <button
                key={m}
                role="radio"
                aria-checked={mode === m}
                onClick={() => pickMode(m)}
                data-testid={`ludo-mode-${m}`}
                className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-black tracking-wide transition-all active:scale-95 ${
                  mode === m
                    ? 'bg-coral-gradient glow-coral text-white'
                    : 'border border-white/15 bg-white/5 text-white/60 hover:text-white/90'
                }`}
              >
                <Users className="w-3.5 h-3.5" aria-hidden />
                {m} Players
              </button>
            ))}
          </div>
        }
        coinBalance={coinBalance}
        onBuyCoins={() => setCoinStoreOpen(true)}
        failed={failed}
        failHint="Couldn't load your stats — you can still play."
      />

      {/* Matchmaking MODAL — the SHARED one-for-all-games modal, shown while
          the server checks Ludo table availability (gender-weighted seats). */}
      <MatchmakingModal
        open={joining}
        userName={user?.name}
        userAvatar={avatar}
        level={Math.max(1, Math.floor((stats?.quickyPoints ?? 0) / 50) + 1)}
        messages={[
          mode === 2 ? 'Waiting for 1 more player…' : 'Waiting for players…',
          'Finding a Ludo table…',
          'Checking seat availability…',
          'Placing you diagonally opposite…',
          'Rolling out the board…',
          'Almost ready…',
          'The dice are waiting…',
        ]}
        onCancel={() => {
          // The join request is one round-trip — a cancel just closes the
          // modal; the membership ends server-side via leave/cleanup if the
          // request still lands.
          setJoining(false)
        }}
      />

      <CoinStoreSheet
        open={coinStoreOpen}
        onClose={() => setCoinStoreOpen(false)}
        coinBalance={coinBalance}
        onPurchased={(nb) => setCoinBalance(nb)}
      />
    </div>
  )
}
