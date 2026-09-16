'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Data source for the desktop command center (concept doc §11/§22/§23/§44).
 * One lightweight endpoint, polled on a slow interval — the desktop should
 * feel alive (§23) without hammering the API. Polling is the honest option
 * here: the game SSE stream is scoped to the Spin-the-Bottle section and the
 * dashboard must stay live everywhere.
 */

export type DashboardStats = {
  points: number
  coins: number
  kisses: number
  likesReceived: number
  likesSent: number
  matches: number
  gamesPlayed: number
  giftsSent: number
  giftsReceived: number
  streak: { current: number; longest: number } | null
  league: { name: string; minimumPoints: number; nextName: string | null; nextMinimumPoints: number | null } | null
  // Central chemistry score 0-100 (dating + game signals, server-computed)
  chemistry: number
  // Refactor PRD §4 — per-layer breakdown from the central engine
  chemistryBreakdown?: {
    dating: { score: number; activityCount: number }
    games: { score: number; activityCount: number }
    social: { score: number; activityCount: number }
  }
}

export type DashboardActivity = {
  id: string
  kind: 'like' | 'match' | 'kiss' | 'gift' | 'message'
  text: string
  actorName: string | null
  actorPhoto: string | null
  createdAt: string
}

export type DashboardLive = {
  rooms: number
  players: number
  activeGames: number
  online: number
  postsToday: number
}

export type DashboardData = {
  stats: DashboardStats
  activity: DashboardActivity[]
  live: DashboardLive
}

export function useDashboard(enabled: boolean) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/quicky/dashboard', { cache: 'no-store' })
      if (!res.ok) return
      const json = (await res.json()) as DashboardData
      setData(json)
    } catch {
      // Desktop panel stays on last-known values; nothing to crash over
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    void refresh()
    const iv = setInterval(() => void refresh(), 30_000)
    return () => clearInterval(iv)
  }, [enabled, refresh])

  return { data, loaded, refresh }
}

/** "2 minutes ago" style relative time for the activity feed (§22). */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
