// Quicky — REWARDS STORE (admin-console PRD §12)
//
// The client-side reward-collection state: PENDING grants (the collect
// popup's data), the cosmetics inventory + equip state, and the claim flow.
//
// Triggers (§12.1/§12.2):
//   · ONLINE — the per-user `realm:${userId}` Supabase channel receives a
//     `rewards_pending` broadcast the moment settlement creates grants.
//   · OFFLINE — AppRoot fetches pending grants on every session start; the
//     grants persist server-side, so nobody ever loses a reward.
//
// The server stays the authority: claiming is one idempotent transaction;
// this store only renders what the server reports.

import { create } from 'zustand'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { api } from '@/lib/quicky/api-client'
import { getClient } from '@/lib/quicky/realtime'

export type LevelAsset = { kind: 'image'; url: string } | { kind: 'emoji'; glyph: string }
export type CosmeticAnimation = { type: 'animated-image'; url: string } | { type: 'frames'; frameUrls: string[]; fps: number; loop: boolean }

export type PendingGrant = {
  id: string
  name: string
  rewardType: string
  rarity: string
  icon: string
  description: string | null
  quantity: number
  level: number
  coinAmount: number | null
  cratePoints: number | null
  grantedAt: string
  realmLevel: number
  levelAsset: LevelAsset | CosmeticAnimation | null
  bubble?: { color?: string; border?: string; textLight?: boolean; frameUrl?: string }
  decorator?: { left?: string; right?: string }
}

export type CosmeticItem = {
  id: string
  rewardId: string
  rewardType: string
  name: string
  rarity: string
  level: number
  equipped: boolean
  source: string
  levelAsset: LevelAsset | CosmeticAnimation | null
  decorator?: { left?: string; right?: string }
  bubble?: { color?: string; border?: string; textLight?: boolean; frameUrl?: string }
}

type ClaimResult = {
  claimed: { id: string; name: string; rewardType: string; icon: string; quantity: number; level: number }[]
  coinBalance: number
  /** Crate points banked onto the battle pass by this claim. */
  cratePointsAwarded: number
}

type RewardsState = {
  loaded: boolean
  loading: boolean
  grants: PendingGrant[]
  cosmetics: CosmeticItem[]
  claiming: boolean
  lastClaim: ClaimResult | null
  /** Popup visibility (auto-opens when grants exist / a push arrives). */
  popupOpen: boolean
  refresh: () => Promise<void>
  claim: () => Promise<ClaimResult | null>
  equip: (rewardId: string, level: number, equip: boolean) => Promise<void>
  openPopup: () => void
  closePopup: () => void
}

let channel: RealtimeChannel | null = null
let channelUserId: string | null = null

export const useRewardsStore = create<RewardsState>((set, get) => ({
  loaded: false,
  loading: false,
  grants: [],
  cosmetics: [],
  claiming: false,
  lastClaim: null,
  popupOpen: false,

  refresh: async () => {
    if (get().loading) return
    set({ loading: true })
    try {
      const res = await api.rewards.pending()
      const grants = (res?.grants ?? []) as PendingGrant[]
      const cosmetics = (res?.cosmetics ?? []) as CosmeticItem[]
      set({ loaded: true, grants, cosmetics })
      // §12.2 — pending grants ALWAYS surface the popup: it is the only way
      // to collect (online push or next-session fetch alike).
      if (grants.length > 0) set({ popupOpen: true })
    } catch {
      set({ loaded: true })
    } finally {
      set({ loading: false })
    }
  },

  claim: async () => {
    if (get().claiming || get().grants.length === 0) return null
    set({ claiming: true })
    try {
      const res = await api.rewards.claim()
      const result: ClaimResult = {
        claimed: (res?.claimed ?? []) as ClaimResult['claimed'],
        coinBalance: Number(res?.coinBalance ?? 0),
        cratePointsAwarded: Number(res?.cratePointsAwarded ?? 0),
      }
      const cosmetics = (res?.cosmetics ?? []) as CosmeticItem[]
      set({ lastClaim: result, grants: [], cosmetics, popupOpen: true })
      return result
    } catch {
      return null
    } finally {
      set({ claiming: false })
    }
  },

  equip: async (rewardId, level, equip) => {
    try {
      const res = await api.rewards.equip(rewardId, level, equip)
      set({ cosmetics: (res?.cosmetics ?? []) as CosmeticItem[] })
    } catch {
      // server state wins on refresh
      await get().refresh().catch(() => {})
    }
  },

  openPopup: () => set({ popupOpen: true }),
  closePopup: () => set({ popupOpen: false }),
}))

/**
 * ONE `realm:${userId}` subscription for reward pushes. The realm store owns
 * a channel on the same name (Supabase allows multiple channels with
 * distinct channel keys — this one is suffixed to stay independent).
 */
export function subscribeRewardsChannel(userId: string | null) {
  if (!userId || channelUserId === userId) return
  const supabase = getClient()
  if (!supabase) return
  if (channel) {
    void supabase.removeChannel(channel).catch(() => {})
    channel = null
  }
  channelUserId = userId
  channel = supabase.channel(`realm:${userId}`, { config: { broadcast: { self: true } } })
  channel.on('broadcast', { event: 'rewards_pending' }, () => {
    // §12.1 — settlement just created grants for this user: fetch + popup.
    void useRewardsStore.getState().refresh()
  })
  channel.subscribe()
}

export function resetRewardsChannel() {
  channelUserId = null
  if (channel) {
    const supabase = getClient()
    if (supabase) void supabase.removeChannel(channel).catch(() => {})
    channel = null
  }
}
