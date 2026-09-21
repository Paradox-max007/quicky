'use client'

// Quicky — GAMES CATALOG HOOK (Game Hub PRD §8-§11/§79)
// One fetch feeds the Games screen, the desktop hub and the game landings.
// Loading skeleton → content, or Error + Retry (§79: never a blank screen).
// Games PRD §39 — active-player counts refresh on a light 30s poll so the
// card badges stay near-realtime without re-fetching the whole catalog.

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/quicky/api-client'
import { cacheGet, cacheSet } from '@/lib/quicky/cache'
import type { GameDef } from './types'

const ACTIVE_PLAYERS_POLL_MS = 30_000
/** Catalog cache TTL — the game list rarely changes; 5 min of instant paint
 *  (Capacitor localStorage persists it across app restarts). */
const GAMES_CACHE_TTL_MS = 5 * 60_000
const GAMES_CACHE_KEY = 'games_catalog_v1'

export function useGames() {
  // LOCAL-BOOT: paint the cached catalog instantly (stale is fine — the
  // revalidate below lands within a beat and replaces it), so the Games
  // screen opens with its cards, not a skeleton, on repeat visits.
  const [games, setGames] = useState<GameDef[] | null>(() => {
    const cached = cacheGet<GameDef[]>(GAMES_CACHE_KEY, { allowStale: true })
    return Array.isArray(cached) ? cached : null
  })
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    // retry path — invoked from click handlers only
    setFailed(false)
    try {
      const res = await api.games.list()
      setGames(res.games ?? [])
      cacheSet(GAMES_CACHE_KEY, res.games ?? [], GAMES_CACHE_TTL_MS)
    } catch {
      setFailed(true)
    }
  }, [])

  // Initial fetch: revalidate against the server (cache layer: instant paint
  // above, fresh data here). The effect never calls setState synchronously
  // (react-hooks v6 set-state-in-effect) — the fetch resolves first, then
  // state updates.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await api.games.list()
        if (!cancelled) {
          setGames(res.games ?? [])
          cacheSet(GAMES_CACHE_KEY, res.games ?? [], GAMES_CACHE_TTL_MS)
        }
      } catch {
        // Offline: keep whatever the cache painted; only mark failed when
        // there is nothing to show at all (§79: never a blank screen).
        if (!cancelled && games === null) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // §39 — near-realtime active-player counts: light poll, merge into cards.
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const res = await api.games.activePlayers()
        if (!res?.counts) return
        setGames((prev) =>
          prev
            ? prev.map((g) => ({
                ...g,
                activePlayers: res.counts[g.slug] ?? 0,
              }))
            : prev
        )
      } catch {
        // badge refresh is best-effort; the last counts stay visible
      }
    }, ACTIVE_PLAYERS_POLL_MS)
    return () => clearInterval(timer)
  }, [])

  return { games, loaded: games !== null, failed, retry: load }
}
