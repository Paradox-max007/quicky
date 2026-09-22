// Quicky — REALM STORE (realm PRD §41-§46, §68, §79)
//
// The single client-side realm state: my status (level, cycle points,
// threshold, cohort rank), the active gift multiplier + countdown, point
// history and the pending settled-cycle result. Optimistic on
// `realm_points_updated` pushes (§45) — the server snapshot stays the
// authority (§68: every refresh fetches it fresh).
//
// Subscription: ONE per-user Supabase channel `realm:${userId}`; the gift
// route's after() hook emits on it for sender + every recipient.

import { create } from 'zustand'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { api } from '@/lib/quicky/api-client'
import { getClient } from '@/lib/quicky/realtime'

export type RealmLeaderboardRow = {
  rank: number
  userId: string
  name: string
  avatar: string | null
  cyclePoints: number
  isMe: boolean
  qualifies: boolean
}

export type RealmSnapshot = {
  realm: { level: number; name: string; description: string | null }
  nextRealm: { level: number; name: string } | null
  cycle: { id: string; endsAt: string; status: string } | null
  points: number
  threshold: number
  rank: number | null
  cohortSize: number
  lifetimeRealmPoints: number
  leaderboard: RealmLeaderboardRow[]
  pendingResult: {
    cycleId: string
    realmName: string
    rank: number
    points: number
    threshold: number
    promoted: boolean
    rewards: { itemId: string; name: string; emoji: string; quantity: number }[]
  } | null
}

export type MultiplierSnapshot = {
  multiplier: number
  eventId: string | null
  name: string | null
  expiresAt: string | null
}

export type PointHistoryRow = {
  id: string
  sourceType: string
  basePoints: number
  multiplier: number
  awardedPoints: number
  createdAt: string
  itemName: string | null
  itemEmoji: string | null
  multiplierEventName: string | null
}

type RealmState = {
  loaded: boolean
  loading: boolean
  snapshot: RealmSnapshot | null
  multiplier: MultiplierSnapshot
  history: PointHistoryRow[]
  historyLoaded: boolean
  /** One-shot optimistic bump from a realm_points_updated push (§45). */
  lastAward: { points: number; at: number } | null
  /** Global Realm details sheet (opened from any room HUD, PRD §71). */
  detailsOpen: boolean
  refresh: () => Promise<void>
  refreshHistory: () => Promise<void>
  applyPointPush: (awardedPoints: number, newCyclePoints?: number) => void
  dismissResult: (cycleId?: string) => Promise<void>
  openDetails: () => void
  closeDetails: () => void
}

const IDLE_MULTIPLIER: MultiplierSnapshot = { multiplier: 1, eventId: null, name: null, expiresAt: null }

let channel: RealtimeChannel | null = null
let channelUserId: string | null = null

export const useRealmStore = create<RealmState>((set, get) => ({
  loaded: false,
  loading: false,
  snapshot: null,
  multiplier: IDLE_MULTIPLIER,
  history: [],
  historyLoaded: false,
  lastAward: null,
  detailsOpen: false,

  refresh: async () => {
    if (get().loading) return
    set({ loading: true })
    try {
      const [statusRes, eventsRes] = await Promise.all([api.realm.status(), api.realm.activeEvents()])
      const snapshot = (statusRes?.realm ?? null) as RealmSnapshot | null
      const me = snapshot?.leaderboard.find((r) => r.isMe)?.userId ?? null
      const ev = eventsRes?.multiplierEvent
      set({
        loaded: true,
        snapshot,
        multiplier: ev
          ? { multiplier: Number(eventsRes?.multiplier ?? 1), eventId: ev.id, name: ev.name, expiresAt: ev.expiresAt }
          : { multiplier: Number(eventsRes?.multiplier ?? 1), eventId: null, name: null, expiresAt: null },
      })
      subscribeRealmChannel(me)
    } catch {
      // Offline/unauthenticated — keep whatever we had; next mount retries.
      set({ loaded: true })
    } finally {
      set({ loading: false })
    }
  },

  refreshHistory: async () => {
    try {
      const res = await api.realm.history(50)
      set({ history: (res?.history ?? []) as PointHistoryRow[], historyLoaded: true })
    } catch {
      set({ historyLoaded: true })
    }
  },

  applyPointPush: (awardedPoints, newCyclePoints) => {
    const snap = get().snapshot
    if (!snap) return
    if (typeof newCyclePoints === 'number' && newCyclePoints >= 0) {
      set({ snapshot: { ...snap, points: newCyclePoints }, lastAward: { points: awardedPoints, at: Date.now() } })
    } else {
      set({ snapshot: { ...snap, points: snap.points + awardedPoints }, lastAward: { points: awardedPoints, at: Date.now() } })
    }
  },

  dismissResult: async (cycleId) => {
    const snap = get().snapshot
    const target = cycleId ?? snap?.pendingResult?.cycleId
    if (snap?.pendingResult) {
      set({ snapshot: { ...snap, pendingResult: null } })
    }
    try {
      await api.realm.claim(target)
    } catch {
      // claimedAt write failed — the server still holds it; next refresh
      // re-shows the result until it succeeds (safe direction).
    }
  },

  openDetails: () => set({ detailsOpen: true }),
  closeDetails: () => set({ detailsOpen: false }),
}))

/** ONE `realm:${userId}` broadcast subscription for the whole app (§44). */
function subscribeRealmChannel(userId: string | null) {
  if (!userId || channelUserId === userId) return
  const supabase = getClient()
  if (!supabase) return
  if (channel) {
    void supabase.removeChannel(channel).catch(() => {})
    channel = null
  }
  channelUserId = userId
  channel = supabase.channel(`realm:${userId}`)
  channel.on('broadcast', { event: 'realm_points_updated' }, ({ payload }: { payload: { awardedPoints?: number; newCyclePoints?: number } }) => {
    const awarded = Number(payload?.awardedPoints ?? 0)
    if (awarded > 0) useRealmStore.getState().applyPointPush(awarded, payload?.newCyclePoints !== undefined ? Number(payload.newCyclePoints) : undefined)
  })
  channel.subscribe()
}

// Reset the subscription on logout/identity change.
export function resetRealmChannel() {
  channelUserId = null
  if (channel) {
    const supabase = getClient()
    if (supabase) void supabase.removeChannel(channel).catch(() => {})
    channel = null
  }
}

/** Convenience hook-level helpers used across the game surfaces. */
export function currentMultiplier(): number {
  return useRealmStore.getState().multiplier.multiplier || 1
}
