'use client'

// Quicky — GAME ALERT CENTER (the in-game notification layer, one mount point)
//
// Mounted ONCE in AppRoot above every screen. It renders, for every game
// registered in turn-alert-sources.ts, the "your turn while off the game
// screen" card (Dismiss + Go to Game — Spin-the-Bottle-decision-drawer
// choreography, Ludo-revision buttons), plus the private game-chat message
// modal (one-line preview + Reply → that sender's chat screen).
//
// TWO gates, both required, both exact:
//   1. THE IN-GAME NOTIFICATION TOGGLE (user.settings.notifGameEvents, the
//      "In-game Notifications" row in Settings → Notifications). It governs
//      the ENTIRE layer — turn alerts AND message modals — so one switch
//      behaves perfectly and predictably. Default ON; free for every user.
//   2. MOBILE SURFACE ONLY: Capacitor app or mobile web view. On the ≥1024px
//      desktop shell the game table stays visible beside the chat (embedded
//      panels), so an overlay alert has no job there — exactly like the
//      Spin Bottle decision drawer, which is also mobile/Capacitor-only.
//
// Every registered source renders through its OWN component instance
// (SourceAlert) so hooks stay order-stable no matter how many games join
// the registry — new games need zero changes in this file.

import { useQuickyStore } from '@/store/quicky'
import { useIsDesktopShell } from '@/hooks/useIsDesktopShell'
import { TURN_ALERT_SOURCES, type TurnAlertSource } from './turn-alert-sources'
import { TurnAlertCard } from './TurnAlertCard'
import { GameMessageAlert } from './GameMessageAlert'

export function GameAlertCenter() {
  const user = useQuickyStore((s) => s.user)
  const isDeskShell = useIsDesktopShell()

  // Gate 1 — the in-game notification toggle. Unknown (missing row / legacy
  // response) defaults to ON: the column defaults true in the schema.
  const enabled = user?.settings?.notifGameEvents !== false

  // Gate 2 — mobile / Capacitor surface only. null (SSR first paint) is
  // treated as mobile so the layer is present from the first paint.
  const mobileSurface = isDeskShell !== true

  if (!enabled || !mobileSurface || !user) return null

  return (
    <>
      {TURN_ALERT_SOURCES.map((source) => (
        <SourceAlert key={source.gameId} source={source} />
      ))}
      <GameMessageAlert />
    </>
  )
}

function SourceAlert({ source }: { source: TurnAlertSource }) {
  const state = source.useAlertState()
  if (!state) return null
  return <TurnAlertCard emoji={source.emoji} label={source.label} state={state} />
}
