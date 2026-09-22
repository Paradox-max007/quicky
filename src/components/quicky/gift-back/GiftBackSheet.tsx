'use client'

// Quicky — GIFT BACK SHEET (gifting-revision: reply-gifting, any surface)
//
// The per-recipient gift sheet opened by "Send gift back" (room-chat gift
// card), "Send Gift" (GameGiftAlert top drawer + the chat-panel drawer) —
// it OPENS ON WHATEVER SCREEN THE USER IS ON (AppRoot surface, no
// navigation, the room runtime never detaches). Recipient profile header +
// DB-driven catalog (local-cache paint) + QUANTITY chips (1 default — same
// chips as the group gifting) + transparent total + fast send:
//
//   · success  → fly animation sender → receiver, toast, room economy sync
//   · 402      → "Not Enough Coins" + Buy Coins (the existing CoinStoreSheet)
//
// MOBILE: classic bottom sheet. DESKTOP shell (≥1024px): centered modal —
// same split as the bulk GiftSheet.

import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ShoppingBag, Send } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { api } from '@/lib/quicky/api-client'
import { cacheGet, cacheSet } from '@/lib/quicky/cache'
import { useIsDesktopShell } from '@/hooks/useIsDesktopShell'
import { useQuickyStore } from '@/store/quicky'
import { useGameRoomStore } from '@/store/game-room'
import { useLudoRoomStore } from '@/store/ludo-room'
import { useGiftBackStore } from '@/store/gift-back'
import { launchGiftFly } from '@/components/quicky/gift-fly/GiftFlyLayer'
import { GiftIcon } from '@/components/quicky/GiftIcon'
import { CoinStoreSheet } from '@/components/quicky/CoinStoreSheet'
import type { CatalogGift } from '@/components/quicky/PlayerInteractionSheet'

const QUANTITY_CHIPS = [1, 10, 50, 100, 1000] as const
const CATALOG_CACHE_KEY = 'gifts_catalog'
const CATALOG_TTL_MS = 5 * 60_000

export function GiftBackSheet() {
  const isDeskShell = useIsDesktopShell() === true
  const { open, peer, roomId, close } = useGiftBackStore()
  const meId = useQuickyStore((s) => s.user?.id ?? '')

  const [gifts, setGifts] = useState<CatalogGift[]>(() => cacheGet<CatalogGift[]>(CATALOG_CACHE_KEY) ?? [])
  const [coinBalance, setCoinBalance] = useState(() => useQuickyStore.getState().user?.coinBalance ?? 0)
  const [selectedItem, setSelectedItem] = useState<string | null>(null)
  const [quantity, setQuantity] = useState<number>(1)
  const [sending, setSending] = useState(false)
  const [insufficient, setInsufficient] = useState<{ total: number } | null>(null)
  const [showCoinStore, setShowCoinStore] = useState(false)

  // Catalog + fresh balance on open (stale-while-revalidate — instant paint).
  useEffect(() => {
    if (!open) return
    setSelectedItem(null)
    setQuantity(1)
    setInsufficient(null)
    void (async () => {
      try {
        const res = await api.spinBottle.gifts.catalog()
        const catalog = (res.catalog ?? []) as CatalogGift[]
        if (catalog.length) {
          setGifts(catalog)
          cacheSet(CATALOG_CACHE_KEY, catalog, CATALOG_TTL_MS)
        }
        if (typeof res.coinBalance === 'number') setCoinBalance(res.coinBalance)
      } catch {
        /* cached rows still render */
      }
    })()
  }, [open])

  const giftDef = useMemo(() => gifts.find((g) => g.id === selectedItem) ?? null, [gifts, selectedItem])
  const unitPrice = giftDef?.priceCoins ?? 0
  const totalCost = unitPrice * quantity
  const affordable = totalCost <= coinBalance
  const canSend = !!giftDef && !sending && !!roomId && !!peer

  const send = async () => {
    if (!canSend || !giftDef || !roomId || !peer) return
    setSending(true)
    setInsufficient(null)
    try {
      const res = await api.spinBottle.gifts.send(roomId, peer.id, giftDef.id, quantity)
      if (res?.ok) {
        setCoinBalance(res.coinBalance)
        // Keep whichever room runtime is attached honest (HUD chips).
        const qk = useQuickyStore.getState()
        if (qk.spinBottleRoomId === roomId) useGameRoomStore.getState().setCoinBalance(res.coinBalance)
        else if (qk.ludoRoomId === roomId) useLudoRoomStore.getState().setCoinBalance(res.coinBalance)
        if (qk.user) qk.setUser({ ...qk.user, coinBalance: res.coinBalance })
        launchGiftFly({
          fromUserId: meId || undefined,
          toUserIds: [peer.id],
          icon: giftDef.icon,
          iconType: giftDef.iconType,
          quantity,
        })
        toast.success(
          `🎁 You sent ${quantity} ${giftDef.name}${quantity > 1 ? 's' : ''} to ${peer.name}`,
          { description: `−${totalCost.toLocaleString('en-US')} coins` }
        )
        close()
      }
    } catch (e: any) {
      if (e?.body?.error === 'insufficient_coins') {
        if (typeof e?.body?.coinBalance === 'number') setCoinBalance(Number(e.body.coinBalance))
        setInsufficient({ total: totalCost })
      } else {
        toast.error(e?.message ?? 'Failed to send gift')
      }
    } finally {
      setSending(false)
    }
  }

  const body = peer ? (
    <>
      {/* Handle */}
      <div className="flex justify-center pt-3 pb-1">
        <div className="w-10 h-1 rounded-full bg-white/20" />
      </div>

      {/* Recipient header */}
      <div className="px-4 pb-3 flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl overflow-hidden bg-white/10 border border-white/15 shrink-0">
          {peer.avatar ? (
            <img src={peer.avatar} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="w-full h-full flex items-center justify-center text-lg font-black">
              {peer.name.slice(0, 1).toUpperCase()}
            </span>
          )}
        </div>
        <div className="min-w-0">
          <h3 className="font-bold text-base truncate">Send a Gift 🎁</h3>
          <p className="text-xs text-white/55 truncate">
            To <span className="font-bold text-white/85">{peer.name}</span>
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1 shrink-0" title="Your coin balance">
          <span className="text-[var(--qk-gold)] text-sm">🪙</span>
          <span className="text-sm font-semibold text-[var(--qk-gold)] tabular-nums">
            {coinBalance.toLocaleString('en-US')}
          </span>
        </div>
        <button onClick={close} className="p-2 rounded-full bg-white/5" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Gift grid — DB catalog, PNG icons render through GiftIcon */}
      <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-4 pb-3">
        {gifts.length === 0 ? (
          <p className="text-xs text-white/40 text-center py-8">Loading gifts…</p>
        ) : (
          <div className="grid grid-cols-4 gap-3">
            {gifts.map((gift) => {
              const isSelected = selectedItem === gift.id
              return (
                <button
                  key={gift.id}
                  onClick={() => setSelectedItem(isSelected ? null : gift.id)}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-2xl p-2.5 border transition-all active:scale-95',
                    isSelected
                      ? 'bg-[var(--qk-accent)]/15 border-[var(--qk-accent)]'
                      : 'bg-white/5 border-white/10 hover:bg-white/10'
                  )}
                >
                  <GiftIcon icon={gift.icon} iconType={gift.iconType} className="h-7 w-7" imgClassName="h-7 w-7" />
                  <span className="text-[9px] text-white/60 font-medium truncate w-full text-center">{gift.name}</span>
                  <div className="flex items-center gap-0.5">
                    <span className="text-[var(--qk-gold)] text-[9px]">🪙</span>
                    <span className="text-[9px] font-bold text-[var(--qk-gold)]">{gift.priceCoins}</span>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {/* Quantity chips — same set as the group gifting, 1 pre-selected */}
        <div className="mt-4" data-testid="giftback-quantity-block">
          <p className="text-[10px] text-white/50 mb-2 font-bold uppercase tracking-wider">Quantity</p>
          <div className="flex gap-2">
            {QUANTITY_CHIPS.map((q) => (
              <button
                key={q}
                onClick={() => setQuantity(q)}
                className={cn(
                  'flex-1 py-2 rounded-xl text-xs font-black border transition-all active:scale-95',
                  quantity === q
                    ? 'bg-[var(--qk-accent)] border-transparent text-white'
                    : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'
                )}
                data-testid={`giftback-qty-${q}`}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Transparent total + Send / Not-enough-coins */}
      <div className="px-4 pb-6 pt-2 safe-area-bottom border-t border-white/10 flex flex-col gap-2">
        {giftDef && (
          <div className="flex items-center justify-between text-[11px] text-white/60 pt-2">
            <span>
              {unitPrice.toLocaleString('en-US')} coins × {quantity}
            </span>
            <span className="font-black text-[var(--qk-gold)]">Total: {totalCost.toLocaleString('en-US')}</span>
          </div>
        )}
        {!affordable && giftDef && (
          <p className="text-[11px] font-semibold text-amber-300/90">
            That&apos;s more than your {coinBalance.toLocaleString('en-US')} coins.
          </p>
        )}
        {insufficient ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-bold text-center pt-1">Not Enough Coins</p>
            <p className="text-[11px] text-white/55 text-center -mt-1">
              You don&apos;t have enough coins to send these gifts.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setInsufficient(null)}
                className="flex-1 rounded-2xl py-3 font-bold text-white/80 bg-white/10 active:scale-[0.98] transition-transform"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setInsufficient(null)
                  setShowCoinStore(true)
                }}
                className="flex-1 rounded-2xl py-3 font-bold text-white bg-coral-gradient glow-coral active:scale-[0.98] transition-transform flex items-center justify-center gap-1.5"
                data-testid="giftback-buy-coins"
              >
                <ShoppingBag className="w-4 h-4" /> Buy Coins
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={send}
            disabled={!canSend}
            className="w-full rounded-2xl py-3.5 font-bold text-white bg-coral-gradient glow-coral disabled:opacity-30 disabled:glow-none transition-all active:scale-[0.98] flex items-center justify-center gap-2"
            data-testid="giftback-send"
          >
            {sending ? (
              <span className="text-sm">Sending…</span>
            ) : giftDef ? (
              <>
                <Send className="w-4 h-4" />
                <span className="flex items-center gap-1.5">
                  Send {quantity} {giftDef.name}
                  {quantity > 1 ? 's' : ''}
                </span>
                <span className="flex items-center gap-0.5 opacity-90">
                  <GiftIcon icon={giftDef.icon} iconType={giftDef.iconType} className="h-4 w-4 text-base" /> · 🪙{' '}
                  {totalCost.toLocaleString('en-US')}
                </span>
              </>
            ) : (
              <span>Select a gift to continue</span>
            )}
          </button>
        )}
      </div>
    </>
  ) : null

  return (
    <>
      <AnimatePresence>
        {open && peer && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[180] bg-black/60"
              onClick={close}
            />
            {isDeskShell ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.94, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 8 }}
                transition={{ type: 'spring', stiffness: 340, damping: 28 }}
                className="fixed inset-0 z-[181] flex items-center justify-center p-4 pointer-events-none"
                data-testid="gift-back-sheet"
                aria-modal
                role="dialog"
                aria-label={`Send a gift to ${peer.name}`}
              >
                <div className="pointer-events-auto w-full max-w-[26rem] max-h-[86vh] bg-[var(--qk-card)] border border-white/10 rounded-3xl shadow-2xl flex flex-col overflow-hidden">
                  {body}
                </div>
              </motion.div>
            ) : (
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', stiffness: 320, damping: 30 }}
                className="fixed bottom-0 inset-x-0 z-[181] mx-auto max-w-md bg-[var(--qk-card)] border-t border-white/10 rounded-t-3xl flex flex-col"
                style={{ maxHeight: '78vh' }}
                data-testid="gift-back-sheet"
                role="dialog"
                aria-label={`Send a gift to ${peer.name}`}
              >
                {body}
              </motion.div>
            )}
          </>
        )}
      </AnimatePresence>

      <CoinStoreSheet
        open={showCoinStore}
        onClose={() => setShowCoinStore(false)}
        coinBalance={coinBalance}
        onPurchased={(newBalance) => setCoinBalance(newBalance)}
      />
    </>
  )
}
