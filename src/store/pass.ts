// Quicky — PASS STORE (crate-pass PRD)
//
// The crown 👑 room chip opens the REALM PASS: the viewer's current realm
// details + the crates store ("Get Crate" → the crate's 100-level track).
//   · mobile web / Capacitor → DEDICATED SLIDING SCREENS (full-screen pages,
//     the room underneath never unmounts)
//   · desktop web            → CENTERED MODAL
//
// Also carries the MONTHLY SEASON state (the ❤ room chip value + season
// boost/events/gifts) — one store, one refresh call per surface.

import { create } from 'zustand'
import { api } from '@/lib/quicky/api-client'

export type SeasonStatusClient = {
  season: { id: string; name: string; imageUrl: string | null; endsAt: string; daysLeft: number } | null
  points: number
  boost: number
  events: { id: string; name: string; emoji: string; description: string | null; multiplier: number; startsAt: string; endsAt: string; running: boolean }[]
  gifts: { itemId: string; name: string; emoji: string; iconType: string; iconValue: string | null; coinPrice: number }[]
}

export type CrateCatalogRowClient = {
  id: string
  name: string
  description: string | null
  imageUrl: string | null
  priceCoins: number
  levelCount: number
  unlocked: boolean
  currentLevel: number
  cratePoints: number
  isPointsTarget: boolean
}

export type CrateLevelRowClient = {
  level: number
  /** Cumulative crate points needed to reach this level (level 1 = 0). */
  thresholdPoints: number
  prizeType: string
  prizeName: string | null
  prizeEmoji: string | null
  quantity: number
  priceCoins: number
  reached: boolean
  /** Claimed by the user (the tap → modal → CLAIM flow). */
  freeCollected: boolean
  crateCollected: boolean
  /** Reached (+ unlocked for CRATE) but NOT claimed yet → tappable. */
  freeClaimable: boolean
  crateClaimable: boolean
  freePrizeType: string
  freePrizeName: string | null
  freePrizeEmoji: string | null
  freeQuantity: number
}

export type CratePackRowClient = { levels: number; priceCoins: number; label: string; affordable: boolean }

export type CrateDetailClient = {
  crate: CrateCatalogRowClient & {
    nextThreshold: number | null
    pointsToNext: number | null
  }
  levels: CrateLevelRowClient[]
  packs: CratePackRowClient[]
}

export type ClaimPrizeClientResult =
  | { ok: true; prize: { type: string; name: string; emoji: string; quantity: number }; coinBalance: number | null }
  | { ok: false; error: 'level_locked' | 'crate_locked' | 'already_claimed' | 'no_prize' | 'failed' }

/** The prize currently offered in the CLAIM MODAL (null = closed). Kept in
 *  the store so the Capacitor hardware back button can close the modal
 *  before anything else (AppRoot back handler order: modal → details → pass). */
export type ClaimTargetClient = {
  lv: CrateLevelRowClient
  track: 'free' | 'crate'
  /** The tapped tile's viewport center — the modal flies out from here. */
  cx: number
  cy: number
}

type PassState = {
  /** The Realm Pass surface is open (screen 1 — realm details + crate store). */
  passOpen: boolean
  /** A crate is selected → the details screen (screen 2) shows on top. */
  crateId: string | null
  /** Monthly season state (❤ chip + strip). */
  season: SeasonStatusClient | null
  seasonLoaded: boolean
  crates: CrateCatalogRowClient[]
  cratesLoaded: boolean
  detail: CrateDetailClient | null
  detailLoading: boolean
  busy: boolean
  /** The prize offered in the claim modal (tap → modal → CLAIM). */
  claimTarget: ClaimTargetClient | null
  openPass: () => void
  closePass: () => void
  openCrate: (crateId: string) => void
  backToStore: () => void
  /** Banner shortcut: open the FEATURED crate's details straight away
   *  (mobile → the sliding crate screen, desktop → the crates modal). */
  openCrates: () => Promise<void>
  openClaim: (target: ClaimTargetClient) => void
  closeClaim: () => void
  refreshSeason: () => Promise<void>
  refreshCrates: () => Promise<void>
  refreshDetail: (crateId?: string) => Promise<void>
  purchaseCrate: (crateId: string) => Promise<{ ok: boolean; error?: string }>
  buyLevels: (crateId: string, levels: number) => Promise<{ ok: boolean; error?: string }>
  /** Claim one level's prize (the tile → claim modal → CLAIM button). */
  claimPrize: (level: number, track: 'FREE' | 'CRATE') => Promise<ClaimPrizeClientResult>
}

export const usePassStore = create<PassState>((set, get) => ({
  passOpen: false,
  crateId: null,
  season: null,
  seasonLoaded: false,
  crates: [],
  cratesLoaded: false,
  detail: null,
  detailLoading: false,
  busy: false,
  claimTarget: null,

  openPass: () => {
    set({ passOpen: true, crateId: null, detail: null, claimTarget: null })
    // Fresh state every open (like the realm leaderboard §68).
    void get().refreshSeason()
    void get().refreshCrates()
  },
  closePass: () => set({ passOpen: false, crateId: null, detail: null, claimTarget: null }),

  openCrate: (crateId) => {
    set({ crateId, detail: null, claimTarget: null })
    void get().refreshDetail(crateId)
  },
  backToStore: () => set({ crateId: null, detail: null, claimTarget: null }),

  openCrates: async () => {
    // Banner shortcut: pass shell + the FEATURED crate's details on top.
    set({ passOpen: true, crateId: null, detail: null, claimTarget: null })
    void get().refreshSeason()
    await get().refreshCrates()
    if (!get().passOpen) return // closed while loading
    const list = get().crates
    const target = list.find((c) => c.isPointsTarget) ?? list[0]
    if (target) get().openCrate(target.id)
  },

  openClaim: (target) => set({ claimTarget: target }),
  closeClaim: () => set({ claimTarget: null }),

  refreshSeason: async () => {
    try {
      const res = await api.season.status()
      set({ season: (res ?? null) as SeasonStatusClient | null, seasonLoaded: true })
    } catch {
      set({ seasonLoaded: true })
    }
  },

  refreshCrates: async () => {
    try {
      const res = await api.crates.list()
      set({ crates: (res?.crates ?? []) as CrateCatalogRowClient[], cratesLoaded: true })
    } catch {
      set({ cratesLoaded: true })
    }
  },

  refreshDetail: async (crateId) => {
    const id = crateId ?? get().crateId
    if (!id) return
    set({ detailLoading: true })
    try {
      const res = await api.crates.detail(id)
      set({ detail: (res ?? null) as CrateDetailClient | null, detailLoading: false })
    } catch {
      set({ detailLoading: false })
    }
  },

  purchaseCrate: async (crateId) => {
    if (get().busy) return { ok: false, error: 'busy' }
    set({ busy: true })
    try {
      const res = await api.crates.purchase(crateId)
      await Promise.all([get().refreshDetail(crateId), get().refreshCrates()])
      return { ok: true }
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status
      if (status === 402) return { ok: false, error: 'insufficient_coins' }
      if (status === 409) return { ok: false, error: 'already_unlocked' }
      return { ok: false, error: 'failed' }
    } finally {
      set({ busy: false })
    }
  },

  buyLevels: async (crateId, levels) => {
    if (get().busy) return { ok: false, error: 'busy' }
    set({ busy: true })
    try {
      await api.crates.buyLevels(crateId, levels)
      await Promise.all([get().refreshDetail(crateId), get().refreshCrates()])
      return { ok: true }
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status
      if (status === 402) return { ok: false, error: 'insufficient_coins' }
      return { ok: false, error: 'failed' }
    } finally {
      set({ busy: false })
    }
  },

  claimPrize: async (level, track) => {
    const crateId = get().crateId
    if (!crateId) return { ok: false, error: 'failed' }
    try {
      const res = await api.crates.claim(crateId, level, track)
      await Promise.all([get().refreshDetail(crateId), get().refreshCrates()])
      return { ok: true, prize: res.prize, coinBalance: res.coinBalance ?? null } as ClaimPrizeClientResult
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status
      if (status === 412) return { ok: false, error: 'level_locked' }
      if (status === 403) return { ok: false, error: 'crate_locked' }
      if (status === 409) return { ok: false, error: 'already_claimed' }
      return { ok: false, error: 'failed' }
    }
  },
}))

/** The ❤ room-chip value: my points for the ACTIVE monthly season. */
export function seasonPointsNow(): number | null {
  const s = usePassStore.getState().season
  return s ? s.points : null
}
