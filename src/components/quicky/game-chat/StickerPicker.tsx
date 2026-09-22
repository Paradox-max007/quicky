'use client'

// Quicky — SHARED sticker picker: two tabs over the user-facing sticker
// catalog (`/api/quicky/game-chat/stickers`):
//
//   · My Stickers — every sticker inside bundles the user owns; tapping one
//     fires onPick (the parent decides how it's sent: game chat message,
//     room-chat message, dating-chat message…).
//   · Sticker Shop — bundles available for purchase with coins (🪙) or a
//     claimable unlock (free / realm win / season / event / subscription).
//     Purchase + claim run through the SAME server-validated route — the
//     client never grants itself anything (§64/§76/§32).
//
// Used by three surfaces: the game-chat composer tray, the room-chat
// composer tray (spin bottle + ludo) and the dating personal-chat sheet —
// web AND Capacitor (same React tree). All colors follow the user's app
// theme through --qk-* tokens.
import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Coins, Lock, Sparkles, Check } from 'lucide-react'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export type PickableSticker = { id: string; name: string; assetUrl: string }

export type StickerCatalogBundle = {
  id: string
  name: string
  description: string | null
  icon: string
  unlockType: string
  season: string | null
  event: string | null
  realmLevel: number | null
  priceCoins: number
  purchaseEnabled: boolean
  rewardEnabled: boolean
  owned: boolean
  canClaimNow: boolean
  stickers: PickableSticker[]
}

/** A sticker asset is either an uploaded image URL or an emoji glyph. */
export function isStickerImage(asset: string): boolean {
  return /^https?:\/\//i.test(asset) || asset.startsWith('data:image/') || asset.startsWith('/')
}

/** Renders a sticker asset — image when it's a URL, emoji text otherwise. */
export function StickerAsset({
  sticker,
  className,
  imgClassName,
  emojiClassName,
}: {
  sticker: PickableSticker
  className?: string
  imgClassName?: string
  emojiClassName?: string
}) {
  if (isStickerImage(sticker.assetUrl)) {
    return (
      <img
        src={sticker.assetUrl}
        alt={sticker.name}
        draggable={false}
        className={cn('object-contain select-none pointer-events-none', imgClassName ?? className)}
      />
    )
  }
  return (
    <span role="img" aria-label={sticker.name} className={cn('leading-none select-none', emojiClassName ?? className)}>
      {sticker.assetUrl}
    </span>
  )
}

/** Bundle icons can be an emoji or an uploaded image (admin PRD §6 upload). */
export function BundleIcon({ icon, className, imgClassName }: { icon: string; className?: string; imgClassName?: string }) {
  if (isStickerImage(icon)) {
    return <img src={icon} alt="" draggable={false} className={cn('object-contain pointer-events-none', imgClassName ?? className)} />
  }
  return (
    <span aria-hidden className={cn('leading-none', className)}>
      {icon}
    </span>
  )
}

/** Human label for a bundle's unlock requirement (shop tab). */
function unlockLabel(b: StickerCatalogBundle): string {
  switch (b.unlockType) {
    case 'free':
      return 'Free'
    case 'realm':
      return `Realm ${b.realmLevel ?? '?'} winner`
    case 'season':
      return b.season ? `Season: ${b.season}` : 'Season pass'
    case 'event':
      return b.event ? `Event: ${b.event}` : 'Event unlock'
    case 'subscription':
      return 'Premium subscription'
    default:
      return 'Coins'
  }
}

export function StickerPicker({
  onPick,
  onCatalogChange,
  className,
  initialTab = 'owned',
  pickLabel = 'Tap a sticker to send',
}: {
  onPick?: (sticker: PickableSticker) => void
  /** Fired after a successful purchase/claim so parents can react. */
  onCatalogChange?: () => void
  className?: string
  initialTab?: 'owned' | 'shop'
  pickLabel?: string
}) {
  const [tab, setTab] = useState<'owned' | 'shop'>(initialTab)
  const [bundles, setBundles] = useState<StickerCatalogBundle[] | null>(null)
  const [coinBalance, setCoinBalance] = useState<number | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await api.gameChat.stickers()
      setBundles(res?.bundles ?? [])
      setCoinBalance(res?.coinBalance ?? 0)
    } catch {
      setBundles([])
    }
  }, [])

  useEffect(() => {
    if (bundles === null) void load()
  }, [bundles, load])

  const owned = (bundles ?? []).filter((b) => b.owned)
  const shop = (bundles ?? []).filter((b) => !b.owned)

  const buyOrClaim = async (b: StickerCatalogBundle) => {
    if (busyId) return
    // free / realm / season / event / subscription sets go through claim —
    // the server re-evaluates the requirement (§32). coins sets purchase.
    const action: 'purchase' | 'claim' =
      b.unlockType === 'coins' || b.unlockType === 'free' ? 'purchase' : 'claim'
    setBusyId(b.id)
    try {
      const res = await api.gameChat.stickerAction(action, b.id)
      if (res?.ok || res?.alreadyOwned) {
        toast.success(res?.alreadyOwned ? `${b.name} is already in your stickers` : `Unlocked ${b.name}!`, {
          description: 'Find it under My Stickers',
        })
        await load()
        setTab('owned')
        onCatalogChange?.()
      }
    } catch (e: any) {
      if (e?.body?.error === 'insufficient_coins') toast.error('Not enough coins — earn more by playing!')
      else if (e?.body?.error === 'realm_not_qualified') toast.error(`Win a realm ${b.realmLevel} cycle to unlock this set`)
      else if (e?.body?.error === 'season_inactive') toast.error('This season has ended')
      else if (e?.body?.error === 'event_inactive') toast.error('This event has ended')
      else if (e?.body?.error === 'subscription_required') toast.error('Premium subscription required')
      else toast.error(e?.message ?? 'Could not unlock this sticker set')
    } finally {
      setBusyId(null)
    }
  }

  if (bundles === null) {
    return (
      <div className={cn('flex items-center justify-center py-6', className)}>
        <p className="text-xs font-semibold text-white/40">Loading stickers…</p>
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col min-h-0', className)}>
      {/* Tabs */}
      <div className="shrink-0 flex items-center gap-1 p-1 rounded-2xl bg-[var(--qk-elev)] border border-white/10">
        {(
          [
            { key: 'owned', label: 'My Stickers', count: owned.reduce((n, b) => n + b.stickers.length, 0) },
            { key: 'shop', label: 'Sticker Shop', count: shop.length },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'flex-1 rounded-xl px-2 py-1.5 text-[11px] font-black tracking-wide transition-colors',
              tab === t.key
                ? 'bg-[var(--qk-accent)] text-[var(--qk-on-accent)]'
                : 'text-white/55 hover:text-white/85'
            )}
            aria-pressed={tab === t.key}
            data-testid={`sticker-tab-${t.key}`}
          >
            {t.label}
            {t.count > 0 && <span className="ml-1 opacity-60">{t.count}</span>}
          </button>
        ))}
      </div>

      {/* Tab body */}
      <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar mt-2 pr-0.5">
        {tab === 'owned' ? (
          <>
            {pickLabel && <p className="text-[10px] font-semibold text-white/35 mb-1.5 px-0.5">{pickLabel}</p>}
            {owned.length === 0 ? (
              <div className="flex flex-col items-center gap-1.5 py-6 px-4 text-center">
                <span className="w-11 h-11 rounded-2xl bg-[var(--qk-elev)] border border-white/10 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-[var(--qk-accent)]" size={20} />
                </span>
                <p className="text-xs font-bold text-white/70">No stickers yet</p>
                <p className="text-[11px] text-white/40">Open the Sticker Shop tab to get some with coins.</p>
                <button
                  onClick={() => setTab('shop')}
                  className="mt-1 text-[11px] font-black px-3 py-1.5 rounded-full bg-coral-gradient text-white"
                >
                  Browse the shop
                </button>
              </div>
            ) : (
              owned.map((b) => (
                <div key={b.id} className="mb-2.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <BundleIcon icon={b.icon} className="text-sm" imgClassName="w-4 h-4" />
                    <p className="text-[11px] font-bold text-white/75 truncate">
                      {b.name}
                      {b.season ? <span className="text-white/35 font-normal"> · {b.season}</span> : null}
                    </p>
                    <span className="ml-auto flex items-center gap-0.5 text-[9px] font-black text-emerald-300/90 shrink-0">
                      <Check className="w-3 h-3" size={11} aria-hidden /> OWNED
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {b.stickers.map((s) => (
                      <motion.button
                        key={s.id}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => onPick?.(s)}
                        className="w-[52px] h-[52px] rounded-2xl bg-[var(--qk-elev)] border border-white/10 flex items-center justify-center hover:border-[var(--qk-accent)]/40 hover:bg-[color-mix(in_srgb,var(--qk-accent)_10%,var(--qk-elev))] active:scale-95 transition-colors"
                        aria-label={`Send sticker ${s.name}`}
                        data-testid={`sticker-tile-${s.id}`}
                      >
                        <StickerAsset sticker={s} imgClassName="w-9 h-9" emojiClassName="text-3xl" />
                      </motion.button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </>
        ) : (
          <>
            <div className="flex items-center justify-between mb-2 px-0.5">
              <p className="text-[10px] font-semibold text-white/35">Sticker sets you can unlock</p>
              {coinBalance !== null && (
                <span className="flex items-center gap-1 text-[11px] font-black text-[var(--qk-gold)] shrink-0" data-testid="sticker-coin-balance">
                  <Coins className="w-3 h-3" size={12} aria-hidden /> {coinBalance.toLocaleString()}
                </span>
              )}
            </div>
            {shop.length === 0 ? (
              <div className="flex flex-col items-center gap-1 py-6 px-4 text-center">
                <span className="w-11 h-11 rounded-2xl bg-[var(--qk-elev)] border border-white/10 flex items-center justify-center">
                  <Check className="w-5 h-5 text-emerald-300/90" size={20} aria-hidden />
                </span>
                <p className="text-xs font-bold text-white/70">You own every sticker set</p>
                <p className="text-[11px] text-white/40">New sets drop regularly — check back soon.</p>
              </div>
            ) : (
              shop.map((b) => {
                const buyable = b.unlockType === 'coins' && b.purchaseEnabled && b.priceCoins > 0
                const claimable = b.canClaimNow
                return (
                  <div
                    key={b.id}
                    className="mb-2 rounded-2xl bg-[var(--qk-elev)] border border-white/10 p-2.5 flex items-start gap-2.5"
                    data-testid={`sticker-shop-${b.id}`}
                  >
                    <span className="w-10 h-10 rounded-xl bg-[var(--qk-card)] border border-white/10 flex items-center justify-center shrink-0">
                      <BundleIcon icon={b.icon} className="text-xl" imgClassName="w-7 h-7" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-white/90 truncate">{b.name}</p>
                      {b.description && <p className="text-[10px] text-white/40 line-clamp-2 leading-snug">{b.description}</p>}
                      <p className="mt-0.5 flex items-center gap-1 text-[10px] font-semibold text-white/45">
                        <Lock className="w-2.5 h-2.5 shrink-0" size={10} aria-hidden />
                        {unlockLabel(b)}
                        <span className="text-white/25">· {b.stickers.length} stickers</span>
                      </p>
                      {/* preview strip */}
                      {b.stickers.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {b.stickers.slice(0, 6).map((s) => (
                            <span
                              key={s.id}
                              className="w-7 h-7 rounded-lg bg-[var(--qk-card)] border border-white/5 flex items-center justify-center overflow-hidden"
                              aria-hidden
                            >
                              <StickerAsset sticker={s} imgClassName="w-5 h-5 opacity-70" emojiClassName="text-lg opacity-70" />
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 self-center">
                      {buyable ? (
                        <motion.button
                          whileTap={{ scale: 0.93 }}
                          onClick={() => void buyOrClaim(b)}
                          disabled={busyId === b.id}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-coral-gradient text-[11px] font-black text-white disabled:opacity-50 whitespace-nowrap"
                          aria-label={`Buy ${b.name} for ${b.priceCoins} coins`}
                        >
                          <Coins className="w-3 h-3" size={12} aria-hidden />
                          {busyId === b.id ? '…' : b.priceCoins.toLocaleString()}
                        </motion.button>
                      ) : claimable ? (
                        <motion.button
                          whileTap={{ scale: 0.93 }}
                          onClick={() => void buyOrClaim(b)}
                          disabled={busyId === b.id}
                          className="px-2.5 py-1.5 rounded-full bg-[var(--qk-accent)] text-[var(--qk-on-accent)] text-[11px] font-black disabled:opacity-50"
                        >
                          {busyId === b.id ? '…' : 'CLAIM'}
                        </motion.button>
                      ) : (
                        <span className="px-2 py-1.5 rounded-full bg-white/5 border border-white/10 text-[10px] font-bold text-white/40 whitespace-nowrap">
                          Locked
                        </span>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </>
        )}
      </div>
    </div>
  )
}
