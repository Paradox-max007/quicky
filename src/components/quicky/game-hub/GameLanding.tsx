'use client'

// Quicky — GAME LANDING dispatcher (Game Hub PRD §12 + Unified Game Primary PRD §55)
//
// Games → [card] → openGameLanding(slug) → THIS dispatcher → the game's
// primary screen. Every slug ends up in the SAME reusable GamePrimaryScreen
// (Unified PRD §3/§55 — never per-game primary screens):
//
//   spin-the-bottle → SpinBottleLanding adapter (matchmaking + admin rules)
//   ludo            → LudoLanding adapter (server-authoritative join)
//   every other     → generic config below (honest "Coming soon" state)
//
// This file only routes + supplies the GENERIC config for future games; the
// screen itself lives in game-primary/GamePrimaryScreen.tsx.

import { useEffect, useState } from 'react'
import { api } from '@/lib/quicky/api-client'
import { useQuickyStore } from '@/store/quicky'
import { SpinBottleLanding } from '../SpinBottleLanding'
import { LudoLanding } from '../ludo/LudoLanding'
import { GamePrimaryScreen } from '../game-primary/GamePrimaryScreen'
import {
  buildGenericPrimaryConfig,
  type GameDef,
  type SpinLandingStats,
} from '../game-primary/game-configs'

export function GameLanding() {
  const slug = useQuickyStore((s) => s.gameLandingSlug)
  const setView = useQuickyStore((s) => s.setView)
  const setSpinBottleRoomId = useQuickyStore((s) => s.setSpinBottleRoomId)

  // Spin the Bottle owns its adapter (hero + matchmaking modal + admin rules)
  // — which itself renders the shared GamePrimaryScreen (Unified PRD §55).
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

  // Quicky Ludo owns its adapter (Ludo PRD §71): same reusable screen —
  // hero, records, info — with a REAL Play Now that joins a room.
  if (slug === 'ludo') {
    return (
      <LudoLanding
        onClose={() => setView('games')}
        onJoined={(roomId) => {
          const qk = useQuickyStore.getState()
          qk.setLudoRoomId(roomId)
          qk.setView('ludo-room')
        }}
      />
    )
  }

  return <GenericGamePrimary slug={slug} onBack={() => setView('games')} />
}

/** Future games (Unified PRD §3: Future Game A / B) — the SAME primary
 * screen with a generic config built from the catalog + overall stats. */
function GenericGamePrimary({ slug, onBack }: { slug: string | null; onBack: () => void }) {
  const [game, setGame] = useState<GameDef | null>(null)
  const [overall, setOverall] = useState<SpinLandingStats | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setFailed(false)
      try {
        const [cat, s] = await Promise.all([
          api.games.list(),
          // Overall §7 stats come from the central landing-stats payload.
          api.spinBottle.landing().catch(() => null),
        ])
        if (cancelled) return
        setGame(cat.games?.find((g: GameDef) => g.slug === slug) ?? null)
        setOverall(s ?? null)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [slug])

  const config = buildGenericPrimaryConfig(game, overall)

  return (
    <div className="w-full h-full flex flex-col bg-[var(--qk-bg)] text-white relative overflow-hidden">
      <GamePrimaryScreen
        config={config}
        backLabel="Back to Games"
        onBack={onBack}
        failed={failed}
        failHint="We couldn't load this game."
      />
    </div>
  )
}
