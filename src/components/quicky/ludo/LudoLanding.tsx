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
import { Dice5 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/quicky/api-client'
import { useQuickyStore } from '@/store/quicky'
import { CoinStoreSheet } from '../CoinStoreSheet'
import { GamePrimaryScreen } from '../game-primary/GamePrimaryScreen'
import { MatchmakingModal } from '../game-primary/MatchmakingModal'
import {
  buildLudoPrimaryConfig,
  type GameDef,
  type LudoLandingStats,
} from '../game-primary/game-configs'

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
  const [failed, setFailed] = useState(false)
  const [joining, setJoining] = useState(false)
  const [coinStoreOpen, setCoinStoreOpen] = useState(false)
  const [coinBalance, setCoinBalance] = useState(0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setFailed(false)
      try {
        const [s, cat] = await Promise.all([api.ludo.landing(), api.games.list()])
        if (!cancelled) {
          setStats(s)
          setCoinBalance(s?.coins ?? 0)
          setGame(cat.games?.find((g: GameDef) => g.slug === 'ludo') ?? null)
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
      // Server-authoritative matchmaking (Ludo PRD §6/§117): the client
      // never decides which room or seat it gets — the server checks table
      // availability AND the 2-male/2-female gender weighting before
      // assigning a seat.
      const res = await api.ludo.join()
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
  const config = buildLudoPrimaryConfig(game, stats)

  return (
    <div className="w-full h-full flex flex-col bg-[var(--qk-bg)] text-white relative overflow-hidden">
      <GamePrimaryScreen
        config={config}
        backLabel="Back to Games"
        onBack={onClose}
        onPlay={() => void playNow()}
        playLabel="Play Now"
        playIcon={<Dice5 className="w-5 h-5" aria-hidden />}
        playBusy={joining}
        playDisabled={failed}
        playTestId="ludo-play-now"
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
          'Finding a Ludo table…',
          'Checking seat availability…',
          'Balancing the table…',
          'Looking for players…',
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
