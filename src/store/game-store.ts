// Quicky — GAME STORE STORE (Game Economy PRD §6/§74)
//
// ONE global surface: mobile web/Capacitor → sliding full-screen store;
// desktop web → centered modal. Entry points (PRD §74): the coin balance
// chips (top bar / room HUD), the Games hub, the gift sheet's Buy Coins,
// the insufficient-coins prompt, realm/pass screens — every entry goes
// through openStore(tab) so the prompt-frequency controller (§48) sees it.
//
// Purchases never trust the client: the store calls the server routes and
// only re-renders from the server's response (balance, entitlements).

import { create } from 'zustand'
import { api } from '@/lib/quicky/api-client'
import { useQuickyStore } from '@/store/quicky'
import { useGameRoomStore } from '@/store/game-room'
import { noteBuyCoinsPromptShown } from '@/lib/quicky/monetization'
import { toast } from 'sonner'

export type StoreTab = 'coins' | 'crates' | 'cosmetics' | 'featured'

export type StoreBoost = {
  active: boolean
  multiplier: number
  hoursBeforeEnd: number
  endsAt: string | null
  startsAt: string | null
  realmLevel: number | null
}

export type StorePayloadClient = {
  ok: boolean
  coinBalance: number
  isPremium: boolean
  platform: string
  coinPackages: {
    id: string
    name: string
    coins: number
    bonusCoins: number
    price: number
    currency: string
    badge: string | null
    featured: boolean
    premiumOnly: boolean
  }[]
  crates: {
    id: string
    name: string
    description: string | null
    crateType: string
    price: number
    currency: string
    emoji: string
    imageUrl: string | null
    realmPoints: number
    coins: number
    gift: { itemId: string; name: string; emoji: string; quantity: number } | null
    cosmetic: { rewardId: string; name: string; rarity: string } | null
    bonusLabel: string | null
    featured: boolean
  }[]
  cosmetics: {
    id: string
    rewardType: string
    name: string
    description: string | null
    rarity: string
    priceCoins: number | null
    realmExclusive: boolean
    owned: boolean
    icon: string
  }[]
  pendingCrates: { id: string; crateProductId: string; name: string; emoji: string; purchasedAt: string }[]
  boost: StoreBoost
  sandbox: boolean
}

export type CrateOpenRewards = {
  realmPoints: number
  coins: number
  coinBalance: number
  realmPointsAwarded: boolean
  gift: { itemId: string; name: string; emoji: string; quantity: number } | null
  cosmetic: { rewardId: string; name: string; icon: string } | null
}

type GameState = {
  open: boolean
  tab: StoreTab
  payload: StorePayloadClient | null
  loading: boolean
  busy: string | null
  /** The crate reveal modal (purchase → OPEN → rewards, PRD §45/§46). */
  reveal: CrateOpenRewards | null
  revealCrate: { name: string; emoji: string } | null
  openingCrateId: string | null
  openStore: (tab?: StoreTab) => void
  closeStore: () => void
  setTab: (tab: StoreTab) => void
  refresh: () => Promise<void>
  buyCoins: (packageId: string) => Promise<boolean>
  buyCrate: (crateProductId: string) => Promise<boolean>
  openCrate: (cratePurchaseId: string, meta: { name: string; emoji: string }) => Promise<boolean>
  buyCosmetic: (rewardId: string) => Promise<'ok' | 'insufficient_coins' | 'already_owned' | 'failed'>
  closeReveal: () => void
}

/** Apply a fresh server balance to BOTH live stores (global + in-room). */
function applyBalance(newBalance: number) {
  const qk = useQuickyStore.getState()
  if (qk.user) qk.setUser({ ...qk.user, coinBalance: newBalance })
  try {
    useGameRoomStore.getState().setCoinBalance(newBalance)
  } catch {}
}

export const useGameStoreStore = create<GameState>((set, get) => ({
  open: false,
  tab: 'coins',
  payload: null,
  loading: false,
  busy: null,
  reveal: null,
  revealCrate: null,
  openingCrateId: null,

  openStore: (tab) => {
    const target = tab ?? get().tab ?? 'coins'
    set({ open: true, tab: target, reveal: null })
    noteBuyCoinsPromptShown('store_opened')
    void get().refresh()
  },
  closeStore: () => set({ open: false, reveal: null, revealCrate: null, openingCrateId: null }),
  setTab: (tab) => set({ tab }),

  refresh: async () => {
    if (get().loading) return
    set({ loading: true })
    try {
      const res = await api.gameStore.payload(get().tab)
      const payload = (res ?? null) as StorePayloadClient | null
      if (payload) {
        set({ payload })
        // PRD §15 — reconcile the visible balance from the server snapshot.
        applyBalance(payload.coinBalance)
      }
    } catch {
      // keep whatever we had — the store opens with cached/empty state
    } finally {
      set({ loading: false })
    }
  },

  buyCoins: async (packageId) => {
    if (get().busy) return false
    set({ busy: packageId })
    try {
      const res = await api.gameStore.purchaseCoins(packageId)
      if (res?.ok) {
        applyBalance(res.coinBalance)
        // PRD §69 — only ever confirm AFTER the server verified the payment.
        toast.success(`Payment successful — +${res.coinsAdded.toLocaleString('en-US')} 🪙`, {
          description: res.bonusCoins ? `Includes +${res.bonusCoins.toLocaleString('en-US')} bonus coins` : undefined,
        })
        void get().refresh()
        return true
      }
      return false
    } catch (e: unknown) {
      const status = (e as { status?: number })?.status
      if (status === 403) toast.error('That coin set is exclusive to Premium members')
      else toast.error('Payment failed — no coins were charged.')
      return false
    } finally {
      set({ busy: null })
    }
  },

  buyCrate: async (crateProductId) => {
    if (get().busy) return false
    set({ busy: crateProductId })
    try {
      const res = await api.gameStore.purchaseCrate(crateProductId)
      if (res?.ok) {
        // Payment verified → entitlement OWNED. The reveal modal takes it
        // from here (separate OPEN step, PRD §46).
        set({ openingCrateId: res.cratePurchaseId, revealCrate: { name: res.name, emoji: res.emoji } })
        void get().refresh()
        return true
      }
      return false
    } catch {
      toast.error('Payment failed — nothing was charged.')
      return false
    } finally {
      set({ busy: null })
    }
  },

  openCrate: async (cratePurchaseId, meta) => {
    const opening = get().openingCrateId ?? cratePurchaseId
    if (get().busy) return false
    set({ busy: opening, revealCrate: meta })
    try {
      const res = await api.gameStore.openCrate(opening)
      if (res?.ok) {
        set({ reveal: res.rewards, revealCrate: meta, openingCrateId: null })
        applyBalance(res.rewards.coinBalance)
        void get().refresh()
        return true
      }
      return false
    } catch {
      return false
    } finally {
      set({ busy: null })
    }
  },

  buyCosmetic: async (rewardId) => {
    if (get().busy) return 'failed'
    set({ busy: rewardId })
    try {
      const res = await api.gameStore.purchaseCosmetic(rewardId)
      if (res?.ok) {
        applyBalance(res.coinBalance)
        void get().refresh()
        return 'ok'
      }
      return 'failed'
    } catch (e: unknown) {
      const status = (e as { status?: number })?.status
      if (status === 402) return 'insufficient_coins'
      if (status === 409) return 'already_owned'
      return 'failed'
    } finally {
      set({ busy: null })
    }
  },

  closeReveal: () => set({ reveal: null, revealCrate: null, openingCrateId: null }),
}))

/** Convenience for any surface: open the Game Store (default Coins tab). */
export function openGameStore(tab: StoreTab = 'coins') {
  useGameStoreStore.getState().openStore(tab)
}
