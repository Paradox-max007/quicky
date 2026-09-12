'use client'

// Quicky — CoinStoreSheet (v3 PRD §26-§30, §96)
// The "+" on the coin chip opens this purchase panel. The flow is a MOCK /
// DEVELOPMENT PURCHASE (§27/§29): pick a package → simulate success → coins
// are added server-side → balance updates everywhere. Clearly labelled mock.
//
// Architecture (§30): the UI calls the SINGLE purchase entry point
// `api.spinBottle.coins.purchase(packageId)` — swapping the mock for Google
// Play / Apple IAP / Stripe later touches only that route, not this sheet.

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Check } from 'lucide-react'
import { toast } from 'sonner'
import { COIN_PACKS } from '@/lib/quicky/constants'
import { api } from '@/lib/quicky/api-client'

type Props = {
  open: boolean
  onClose: () => void
  coinBalance: number
  /** Called right after a successful purchase with the NEW server balance. */
  onPurchased: (newBalance: number) => void
}

export function CoinStoreSheet({ open, onClose, coinBalance, onPurchased }: Props) {
  const [buying, setBuying] = useState<string | null>(null)

  const purchase = async (packageId: string) => {
    if (buying) return
    setBuying(packageId)
    // Optimistic balance bump — the purchase outcome is unambiguous (mock
    // always succeeds), then the server value reconciles it.
    const pack = COIN_PACKS.find((p) => p.id === packageId)
    try {
      const res = await api.spinBottle.coins.purchase(packageId)
      if (res?.ok) {
        toast.success(`+${res.coinsAdded.toLocaleString('en-US')} 🪙 added`)
        onPurchased(res.coinBalance)
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Purchase failed')
    } finally {
      setBuying(null)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[210] bg-black/60"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            className="sbr-sheet fixed inset-x-0 bottom-0 z-[211] mx-auto max-w-lg p-4 flex flex-col gap-3 sbr-sheet-safe"
          >
            <div className="mx-auto h-1 w-10 rounded-full bg-white/20" />
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black">Buy Coins</h3>
              <button className="p-2 rounded-full hover:bg-white/10" onClick={onClose} aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs font-semibold text-amber-300/90 bg-amber-400/10 border border-amber-300/20 rounded-lg px-3 py-2">
              🧪 MOCK / DEVELOPMENT PURCHASE — no real money is charged.
            </p>
            <p className="text-xs text-white/50 -mt-1">
              Balance: <b className="text-white tabular-nums">🪙 {coinBalance.toLocaleString('en-US')}</b>
            </p>

            <div className="grid grid-cols-2 gap-2">
              {COIN_PACKS.map((pack) => (
                <button
                  key={pack.id}
                  onClick={() => purchase(pack.id)}
                  disabled={!!buying}
                  className={`relative sbr-coin-pack ${buying === pack.id ? 'sbr-coin-pack-buying' : ''}`}
                >
                  {pack.bestValue && (
                    <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-amber-400 text-black text-[9px] font-black uppercase tracking-wide rounded-full px-2 py-0.5">
                      Best value
                    </span>
                  )}
                  <span className="text-xl" aria-hidden>🪙</span>
                  <span className="font-black tabular-nums">{pack.coins.toLocaleString('en-US')}</span>
                  <span className="text-[10px] text-white/50 font-semibold uppercase tracking-wide">
                    Mock Purchase
                  </span>
                  <span className="sbr-coin-pack-cta">
                    {buying === pack.id ? <Check className="w-3.5 h-3.5" /> : 'Get'}
                  </span>
                </button>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
