'use client'

// Quicky — ROOM REALM HOOK (realm PRD §41/§70-§72 + crate-pass PRD)
// The ONE shared bridge between the global realm/pass stores and ANY game
// room:
//   · hudRealm     — the 👑 HUD chip payload (level/name/points/threshold)
//   · seasonPoints — the ❤ HUD chip value (MONTHLY season points)
//   · bannerEvents — the event-banner rotation queue: multiplier (§14/§17,
//                    high priority) + realm-cycle-ending + the legacy
//                    tonight event as the eternal fallback
//   · refresh      — mounted rooms fetch a fresh authoritative snapshot (§68)
//   · openDetails  — the realm details sheet (Cohort/History tabs)
//   · openLeaderboard — the 🏆 chip → the realm leaderboard screen/drawer
//   · openPass     — the 👑 chip → the REALM PASS (realm details + crates
//                    store — a sliding screen on mobile, a modal on desktop)
// Both room games (and future ones) consume this — never a per-game realm
// system (§70).

import { useEffect, useMemo } from 'react'
import { useRealmStore } from '@/store/realm'
import { usePassStore } from '@/store/pass'
import { tonightEvent, type RoomEvent } from '@/components/quicky/RoomEventBanner'
import type { RealmHudData } from '@/components/quicky/RoomTopHud'

export function useRoomRealm() {
  const snapshot = useRealmStore((s) => s.snapshot)
  const multiplier = useRealmStore((s) => s.multiplier)
  const loaded = useRealmStore((s) => s.loaded)
  const refresh = useRealmStore((s) => s.refresh)
  const openDetails = useRealmStore((s) => s.openDetails)
  const openLeaderboard = useRealmStore((s) => s.openLeaderboard)

  const season = usePassStore((s) => s.season)
  const refreshSeason = usePassStore((s) => s.refreshSeason)
  const openPass = usePassStore((s) => s.openPass)

  // §68 — the room mounts → authoritative snapshot (one fetch, shared state).
  useEffect(() => {
    void refresh()
    // Crate-pass PRD — the ❤ chip needs the monthly season state too.
    void refreshSeason()
  }, [refresh, refreshSeason])

  const hudRealm: RealmHudData | null = useMemo(
    () =>
      snapshot
        ? { level: snapshot.realm.level, name: snapshot.realm.name, points: snapshot.points, threshold: snapshot.threshold }
        : null,
    [snapshot]
  )

  /** ❤ MONTHLY season points (crate-pass PRD) — null while loading. */
  const seasonPoints = season?.points ?? 0

  const bannerEvents: RoomEvent[] = useMemo(() => {
    const list: RoomEvent[] = []
    if (multiplier.multiplier > 1 && multiplier.expiresAt) {
      list.push({
        kind: 'multiplier',
        emoji: '⚡',
        title: `${multiplier.multiplier}× time`,
        expiresAt: multiplier.expiresAt,
      })
    }
    const cycleEndsAt = snapshot?.cycle?.endsAt
    if (cycleEndsAt && new Date(cycleEndsAt).getTime() - Date.now() < 24 * 60 * 60 * 1000) {
      list.push({
        kind: 'realm',
        emoji: '🔥',
        title: 'Realm battle',
        sub: 'Cycle ending soon — hold your rank',
        expiresAt: cycleEndsAt,
      })
    }
    if (list.length === 0) list.push(tonightEvent())
    return list
  }, [multiplier, snapshot])

  return { hudRealm, seasonPoints, bannerEvents, openDetails, openLeaderboard, openPass, loaded }
}
