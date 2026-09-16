'use client'

// Quicky — WEB COIN STORE (centered modal)
// Clicking the coin balance in the top bar opens THIS store — deliberately a
// different surface from Premium (the crown/paywall flow): it sells coins.
// Premium members get the premium treatment: +20% bonus coins on every
// standard pack, discounted pricing, and two exclusive coin sets that are
// hidden (and server-enforced) for free members.
// Purchases stay MOCK / DEVELOPMENT (v3 PRD §27/§29) — no real money.

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Crown, Coins } from 'lucide-react'
import { toast } from 'sonner'
import {
  COIN_PACKS,
  PREMIUM_EXCLUSIVE_COIN_PACKS,
  PREMIUM_COIN_BONUS_PCT,
  PREMIUM_PRICE_DISCOUNT_PCT,
} from '@/lib/quicky/constants'
import { api } from '@/lib/quicky/api-client'
import { useQuickyStore } from '@/store/quicky'
import { cn } from '@/lib/utils'

type Pack = {
  id: string
  coins: number
  price: number
  label: string
  bestValue: boolean
  exclusive?: boolean
}

type Props = {
  open: boolean
  onClose: () => void
  coinBalance: number
  /** Called right after a successful purchase with the NEW server balance. */
  onPurchased: (newBalance: number) => void
}

export function CoinStoreModal({ open, onClose, coinBalance, onPurchased }: Props) {
  const isPremium = useQuickyStore((s) => s.user?.isPremium ?? false)
  const [buying, setBuying] = useState<string | null>(null)

  const standardPacks = COIN_PACKS as unknown as Pack[]
  const exclusivePacks = PREMIUM_EXCLUSIVE_COIN_PACKS as unknown as Pack[]

  const displayPrice = (p: Pack) =>
    isPremium && !p.exclusive ? p.price * (1 - PREMIUM_PRICE_DISCOUNT_PCT) : p.price

  const purchase = async (pack: Pack) => {
    if (buying) return
    setBuying(pack.id)
    try {
      const res = await api.spinBottle.coins.purchase(pack.id)
      if (res?.ok) {
        const added = res.coinsAdded ?? pack.coins
        toast.success(`+${added.toLocaleString('en-US')} 🪙 added${res.bonusCoins ? ` (incl. +${res.bonusCoins} premium bonus)` : ''}`)
        onPurchased(res.coinBalance)
      }
    } catch (e: any) {
      if (e?.status === 403) toast.error('That coin set is exclusive to Premium members')
      else toast.error(e?.message ?? 'Purchase failed')
    } finally {
      setBuying(null)
    }
  }

  const renderPack = (pack: Pack) => {
    const price = displayPrice(pack)
    return (
      <button
        key={pack.id}
        onClick={() => void purchase(pack)}
        disabled={!!buying}
        className={cn(
          'relative flex flex-col items-center gap-1 rounded-2xl border p-3.5 transition-all active:scale-[0.98] disabled:opacity-60',
          pack.exclusive
            ? 'border-[var(--qk-gold)]/40 bg-[var(--qk-gold)]/8 hover:bg-[var(--qk-gold)]/15'
            : 'border-white/10 bg-white/5 hover:bg-white/10'
        )}
        data-testid={`coin-pack-${pack.id}`}
      >
        {pack.bestValue && (
          <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-amber-400 text-black text-[9px] font-black uppercase tracking-wide rounded-full px-2 py-0.5 whitespace-nowrap">
            Best value
          </span>
        )}
        {pack.exclusive && (
          <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-[var(--qk-gold)] text-black text-[9px] font-black uppercase tracking-wide rounded-full px-2 py-0.5 whitespace-nowrap">
            Exclusive
          </span>
        )}
        <Coins className="w-5 h-5 text-amber-300" />
        <span className="font-black tabular-nums text-sm">{pack.coins.toLocaleString('en-US')}</span>
        {isPremium && !pack.exclusive && (
          <span className="text-[9px] font-bold text-[var(--qk-gold)] bg-[var(--qk-gold)]/15 rounded-full px-1.5 py-0.5">
            +{Math.round(pack.coins * PREMIUM_COIN_BONUS_PCT).toLocaleString('en-US')} bonus
          </span>
        )}
        <span className="text-xs mt-0.5">
          {isPremium && !pack.exclusive && (
            <span className="text-white/35 line-through mr-1.5 tabular-nums">${pack.price.toFixed(2)}</span>
          )}
          <span className="font-bold text-amber-300 tabular-nums">${price.toFixed(2)}</span>
        </span>
        <span className="text-[9px] text-white/40 font-semibold uppercase tracking-wide">
          {buying === pack.id ? 'Processing…' : 'Mock purchase'}
        </span>
      </button>
    )
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[210] flex items-center justify-center bg-black/70 backdrop-blur-md p-4"
          onClick={onClose}
          data-testid="coin-store-modal"
        >
          <motion.div
            initial={{ scale: 0.94, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.94, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="w-full max-w-md bg-[var(--qk-card)] border border-white/10 rounded-3xl p-5 max-h-[85vh] overflow-y-auto qk-desk-scroll"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-amber-400/15 flex items-center justify-center shrink-0">
                <Coins className="w-6 h-6 text-amber-300" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-extrabold tracking-tight">Coin Store</h2>
                <p className="text-xs text-white/50">
                  Balance: <b className="text-white tabular-nums">🪙 {coinBalance.toLocaleString('en-US')}</b>
                </p>
              </div>
              <button className="p-2 rounded-full hover:bg-white/10" onClick={onClose} aria-label="Close coin store">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs font-semibold text-amber-300/90 bg-amber-400/10 border border-amber-300/20 rounded-xl px-3 py-2 mt-4">
              🧪 MOCK / DEVELOPMENT PURCHASE — no real money is charged.
            </p>

            {/* Standard packs */}
            <p className="text-[10px] font-bold tracking-[0.18em] text-white/35 uppercase mt-4 mb-2">Coin packs</p>
            <div className="grid grid-cols-2 gap-2.5">
              {standardPacks.map((p) => renderPack(p))}
            </div>

            {/* Premium exclusives */}
            {isPremium ? (
              <>
                <p className="text-[10px] font-bold tracking-[0.18em] text-[var(--qk-gold)] uppercase mt-5 mb-2">
                  Premium exclusive sets
                </p>
                <div className="grid grid-cols-2 gap-2.5">
                  {exclusivePacks.map((p) => renderPack(p))}
                </div>
                <p className="text-[11px] text-white/40 mt-3">
                  Premium pricing active: +{Math.round(PREMIUM_COIN_BONUS_PCT * 100)}% bonus coins and{' '}
                  {Math.round(PREMIUM_PRICE_DISCOUNT_PCT * 100)}% off every standard pack.
                </p>
              </>
            ) : (
              <button
                onClick={() => {
                  onClose()
                  useQuickyStore.getState().setView('premium')
                }}
                className="mt-4 w-full flex items-center justify-center gap-2 rounded-2xl border border-[var(--qk-gold)]/30 bg-[var(--qk-gold)]/10 px-4 py-3 text-sm font-semibold text-[var(--qk-gold)] hover:bg-[var(--qk-gold)]/15 transition-colors"
                data-testid="coin-store-premium-hint"
              >
                <Crown className="w-4 h-4" fill="currentColor" stroke="none" />
                Go Premium for exclusive coin sets &amp; bonus coins
              </button>
            )}

            <p className="text-center text-[11px] text-white/30 mt-4">
              Coins buy kisses, gifts and table perks. Demo purchases flip instantly.
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
