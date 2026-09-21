'use client'

// Quicky — GAME ALERT CENTER (the in-game notification layer, one mount point)
//
// Mounted ONCE in AppRoot above every screen. It renders, for every game
// registered in turn-alert-sources.ts, the "your game needs you" card
// (Dismiss + Go to Game — Spin-the-Bottle-decision-drawer choreography,
// Ludo-revision buttons), plus the private game-chat message TOP DRAWER
// (same slide-down + swipe choreography, theme-accent paint — one-line
// preview + Reply → that sender's chat screen).
//
// GATES — split by notification KIND (notification-policy revision):
//   1. GAMEPLAY alerts (turn cards) are ALWAYS ON while the user plays on
//      the mobile surface. The "In-game Notifications" toggle does NOT
//      touch them — a game round can not be muted, exactly like the Spin
//      the Bottle decision drawer: the modal opens every time the user is
//      selected, wherever they are.
//   2. PERSONAL-MESSAGE modals are gated by the "In-game Notifications"
//      toggle (user.settings.notifGameEvents, the row in Settings →
//      Notifications). Toggling it off affects ONLY these private chat
//      popups — never the gameplay layer. Default ON; free for every user.
//   3. MOBILE SURFACE ONLY: Capacitor app or mobile web view (<1024px). On
//      the ≥1024px desktop shell the game table stays visible beside the
//      chat (embedded panels), so an overlay alert has no job there —
//      exactly like the Spin Bottle decision drawer.
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

  // Gate — the in-game notification toggle governs the PERSONAL-MESSAGE
  // modal ONLY. Unknown (missing row / legacy response) defaults to ON: the
  // column defaults true in the schema. Gameplay cards below ignore it.
  const messagesEnabled = user?.settings?.notifGameEvents !== false

  // Mobile / Capacitor surface only. null (SSR first paint) is treated as
  // mobile so the layer is present from the first paint.
  const mobileSurface = isDeskShell !== true

  if (!mobileSurface || !user) return null

  return (
    <>
      {/* Gameplay layer — ALWAYS on while a room runtime is attached. */}
      {TURN_ALERT_SOURCES.map((source) => (
        <SourceAlert key={source.gameId} source={source} />
      ))}
      {/* Personal-message layer — switchable by the user. */}
      {messagesEnabled && <GameMessageAlert />}
    </>
  )
}

function SourceAlert({ source }: { source: TurnAlertSource }) {
  const state = source.useAlertState()
  if (!state) return null
  return <TurnAlertCard emoji={source.emoji} label={source.label} state={state} />
}
