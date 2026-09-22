'use client'

// Quicky — Gift Sheet (Games PRD §18-§28 — gifting-revision)
// Bulk gifting for the game rooms (Spin the Bottle, Ludo…). The catalog is
// DB-DRIVEN (admin-managed, nothing hardcoded) and served from the LOCAL
// CACHE (stale-while-revalidate) so the sheet paints instantly — no loading
// beat on open. PRD structure:
//
//   Send a Gift
//   [ All ] [ Guys ] [ Girls ]          ← recipient filter (§18), default All
//   Recipients  (server resolves the list — sender always excluded, §23)
//   Gift grid (admin catalog)
//   Quantity [ 1 ] [ 10 ] [ 50 ] [ 100 ] [ 1000 ]   (§21 — ALWAYS visible,
//   default 1: pick the gift, pick the count, hit Send)
//   Selected Gift · Price: 50 × 10 × 11 · Total: 5,500 coins  (§22)
//   [ Send Gift ]
//
// PLATFORM LAYOUT (gifting-revision): MOBILE keeps the classic bottom sheet;
// the ≥1024px DESKTOP shell gets a centered modal (max-width 26rem) — the
// old full-width bottom sheet stretched its buttons across the whole window
// on desktop, which read as oversized. Both layouts share one body.
//
// Insufficient coins NEVER breaks the flow (§27): the server answers 402 and
// the sheet shows "Not Enough Coins" with Cancel / Buy Coins — Buy Coins
// opens the EXISTING coin-purchase modal (CoinStoreSheet), on Web, Capacitor
// Android and iOS alike. Success shows ONE aggregated confirmation
// ("🎁 You sent 10 Roses to 11 players", §28).

import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/quicky/api-client'
import { cacheGet, cacheSet } from '@/lib/quicky/cache'
import { useIsDesktopShell } from '@/hooks/useIsDesktopShell'
import { GiftMultiplierHeader } from '@/components/quicky/realm/RealmProgress'
import { toast } from 'sonner'
import type { CatalogGift } from './PlayerInteractionSheet'
import { normalizeGenderClient } from './gender'
import { GiftIcon } from './GiftIcon'
import { launchGiftFly } from './gift-fly/GiftFlyLayer'

type Player = { userId: string; displayName: string; gender?: string | null; seatIndex?: number }

type RecipientFilter = 'all' | 'male' | 'female'
const QUANTITY_CHIPS = [1, 10, 50, 100, 1000] as const

/** Local cache key for the DB-driven gift catalog (instant sheet paint). */
const CATALOG_CACHE_KEY = 'gifts_catalog'
const CATALOG_TTL_MS = 5 * 60_000

type Props = {
  open: boolean
  onClose: () => void
  roomId: string
  players: Player[]
  meId: string
  coinBalance: number
  onGiftSent?: (newBalance: number) => void
  /** §27 — opens the EXISTING coin-purchase modal (CoinStoreSheet). */
  onBuyCoins?: () => void
}

export function GiftSheet({ open, onClose, roomId, players, meId, coinBalance, onGiftSent, onBuyCoins }: Props) {
  const isDeskShell = useIsDesktopShell() === true
  const [selectedItem, setSelectedItem] = useState<string | null>(null)
  const [filter, setFilter] = useState<RecipientFilter>('all')
  const [quantity, setQuantity] = useState<number>(1)
  const [sending, setSending] = useState(false)
  const [gifts, setGifts] = useState<CatalogGift[]>(() => cacheGet<CatalogGift[]>(CATALOG_CACHE_KEY) ?? [])
  const [insufficient, setInsufficient] = useState<{ total: number } | null>(null)

  // DB-driven catalog (§47/§71) — LOCAL CACHE first (paints instantly on
  // open), then a background refresh keeps it honest; the SERVER still
  // validates price/active state on every send.
  useEffect(() => {
    if (!open) return
    void (async () => {
      try {
        const res = await api.spinBottle.gifts.catalog()
        const catalog = (res.catalog ?? []) as CatalogGift[]
        if (catalog.length) {
          setGifts(catalog)
          cacheSet(CATALOG_CACHE_KEY, catalog, CATALOG_TTL_MS)
        }
      } catch {
        // Cached rows still render; a total failure only matters when the
        // sheet opened with nothing cached at all.
        if (!cacheGet<CatalogGift[]>(CATALOG_CACHE_KEY)) toast.error('Could not load gifts')
      }
    })()
  }, [open])

  // Reset the transient states whenever the sheet re-opens
  useEffect(() => {
    if (open) {
      setInsufficient(null)
      setFilter('all')
      setQuantity(1)
    }
  }, [open])

  // §18/§19 — recipient resolution mirrors the SERVER rules for DISPLAY only
  // (the server recomputes everything before charging, §25). Sender always
  // excluded; Guys/Girls filter by effective seat gender.
  const eligible = useMemo(
    () =>
      players.filter((p) => {
        if (p.userId === meId) return false
        if (filter === 'all') return true
        return normalizeGenderClient(p.gender ?? undefined, p.seatIndex) === filter
      }),
    [players, meId, filter]
  )
  const eligibleIds = useMemo(() => new Set(eligible.map((p) => p.userId)), [eligible])

  const giftDef = gifts.find((g) => g.id === selectedItem)
  const recipientCount = giftDef ? eligibleIds.size : 0
  const unitPrice = giftDef?.priceCoins ?? 0
  const totalCost = unitPrice * quantity * recipientCount
  const affordable = totalCost <= coinBalance
  const canSend = !!giftDef && recipientCount > 0 && !sending

  const send = async () => {
    if (!canSend || !giftDef) return
    setSending(true)
    setInsufficient(null)
    try {
      const res = await api.spinBottle.gifts.sendBulk(roomId, giftDef.id, filter, quantity, crypto.randomUUID())
      if (res?.ok) {
        // §28 — aggregated success, single animation, immediate balance update.
        // The icons fan out from MY seat to every eligible recipient's seat
        // (gifting-revision: the fly animation for group gifting too).
        launchGiftFly({
          fromUserId: meId || undefined,
          toUserIds: eligible.map((p) => p.userId),
          icon: giftDef.icon,
          iconType: giftDef.iconType,
          quantity,
        })
        toast.success(
          `🎁 You sent ${quantity} ${giftDef.name}${quantity > 1 ? 's' : ''} to ${res.recipientCount} ${res.recipientCount === 1 ? 'player' : 'players'}`,
          { description: `−${(res.totalCost ?? totalCost).toLocaleString()} coins` }
        )
        onGiftSent?.(res.coinBalance)
        setSelectedItem(null)
        onClose()
      }
    } catch (e: any) {
      const msg = e?.body?.error
      if (msg === 'insufficient_coins') {
        // §27 — open the Not-Enough-Coins state inside the sheet; the gift
        // drawer stays open, nothing was sent.
        setInsufficient({ total: totalCost })
      } else if (msg === 'no_recipients') {
        toast.error('No eligible recipients for this filter right now.')
      } else {
        toast.error(e?.message ?? 'Failed to send gift')
      }
    } finally {
      setSending(false)
    }
  }

  const filters: { key: RecipientFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'male', label: 'Guys' },
    { key: 'female', label: 'Girls' },
  ]

  const body = (
    <>
      {/* Handle */}
      <div className="flex justify-center pt-3 pb-1">
        <div className="w-10 h-1 rounded-full bg-white/20" />
      </div>

      {/* Header */}
      <div className="px-4 pb-3 flex items-center justify-between">
        <div>
          <h3 className="font-bold text-base">Send a Gift 🎁</h3>
          <div className="flex items-center gap-1 mt-0.5">
            <span className="text-[var(--qk-gold)] text-sm">🪙</span>
            <span className="text-sm font-semibold text-[var(--qk-gold)]">{coinBalance.toLocaleString()}</span>
            <span className="text-xs text-white/50">coins</span>
          </div>
        </div>
        <button onClick={onClose} className="p-2 rounded-full bg-white/5" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Realm PRD §72 — the active multiplier event rides the gift panel so
          the user knows the point rate BEFORE spending coins. */}
      <div className="px-4 pb-2">
        <GiftMultiplierHeader compact />
      </div>

      {/* §18 — recipient filter chips: All | Guys | Girls (default All) */}
      <div className="px-4 pb-3 flex items-center gap-2" data-testid="gift-filters">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              'px-4 py-1.5 rounded-full text-xs font-bold border transition-all active:scale-95',
              filter === f.key
                ? 'bg-[var(--qk-accent)] border-transparent text-white'
                : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'
            )}
            data-testid={`gift-filter-${f.key}`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-1 text-[11px] text-white/50 font-semibold">
          <Users className="w-3.5 h-3.5" aria-hidden />
          {eligibleIds.size} recipient{eligibleIds.size === 1 ? '' : 's'}
        </span>
      </div>

      {/* Recipients preview (display only — the server decides §25) */}
      <div className="px-4 pb-3">
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
          {eligible.map((p) => (
            <span
              key={p.userId}
              className="shrink-0 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-white/5 border border-white/10 text-white/70"
            >
              {p.displayName}
            </span>
          ))}
          {eligible.length === 0 && (
            <span className="text-[11px] text-white/40">No players match this filter yet.</span>
          )}
        </div>
      </div>

      {/* Gift grid — DB-driven catalog (§47) */}
      <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-4 pb-3">
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

        {/* §21 (gifting-revision) — quantity chips are ALWAYS visible with 1
            pre-selected: pick the gift, pick the count, hit Send. */}
        <div className="mt-4" data-testid="gift-quantity-block">
          <p className="text-[10px] text-white/50 mb-2 font-bold uppercase tracking-wider">Quantity</p>
          <div className="flex gap-2" data-testid="gift-quantity">
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
                data-testid={`gift-qty-${q}`}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* §22 — transparent bulk calculation + Send */}
      <div className="px-4 pb-6 pt-2 safe-area-bottom border-t border-white/10 flex flex-col gap-2">
        {giftDef && recipientCount > 0 && (
          <div className="flex items-center justify-between text-[11px] text-white/60 pt-2">
            <span data-testid="gift-calc">
              {unitPrice.toLocaleString()} coins × {quantity} × {recipientCount}{' '}
              {recipientCount === 1 ? 'player' : 'players'}
            </span>
            <span className="font-black text-[var(--qk-gold)]" data-testid="gift-total">
              Total: {totalCost.toLocaleString()}
            </span>
          </div>
        )}
        {!affordable && giftDef && recipientCount > 0 && (
          <p className="text-[11px] font-semibold text-amber-300/90">
            That&apos;s more than your {coinBalance.toLocaleString()} coins.
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
                  onBuyCoins?.()
                }}
                className="flex-1 rounded-2xl py-3 font-bold text-white bg-coral-gradient glow-coral active:scale-[0.98] transition-transform"
                data-testid="gift-buy-coins"
              >
                Buy Coins
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={send}
            disabled={!canSend}
            className="w-full rounded-2xl py-3.5 font-bold text-white bg-coral-gradient glow-coral disabled:opacity-30 disabled:glow-none transition-all active:scale-[0.98] flex items-center justify-center gap-2"
            data-testid="gift-send"
          >
            {sending ? (
              <span className="text-sm">Sending…</span>
            ) : giftDef && recipientCount > 0 ? (
              <>
                <GiftIcon icon={giftDef.icon} iconType={giftDef.iconType} className="h-4 w-4 text-base" imgClassName="h-4 w-4" />
                <span>
                  Send {quantity} {giftDef.name}
                  {quantity > 1 ? 's' : ''} × {recipientCount}
                </span>
                <span className="opacity-70">· 🪙 {totalCost.toLocaleString()}</span>
              </>
            ) : (
              <span>Select a gift to continue</span>
            )}
          </button>
        )}
      </div>
    </>
  )

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[180] bg-black/60"
            onClick={onClose}
          />

          {/* Sheet — MOBILE: classic bottom sheet. DESKTOP (≥1024px shell):
              centered modal, capped at 26rem so buttons never stretch across
              the whole window (gifting-revision). */}
          {isDeskShell ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ type: 'spring', stiffness: 340, damping: 28 }}
              className="fixed inset-0 z-[181] flex items-center justify-center p-4 pointer-events-none"
              data-testid="gift-sheet"
              aria-modal
              role="dialog"
              aria-label="Send a gift"
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
              data-testid="gift-sheet"
            >
              {body}
            </motion.div>
          )}
        </>
      )}
    </AnimatePresence>
  )
}
