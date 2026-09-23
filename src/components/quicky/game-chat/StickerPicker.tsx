'use client'

// Quicky — SHARED sticker picker: two tabs over the user-facing sticker
// catalog (`/api/quicky/game-chat/stickers`):
//
//   · My Stickers — RECENTLY USED first (device-local memory of what the
//     user actually sends), then every sticker inside bundles the user
//     owns, GROUPED BY SET. Tapping one fires onPick (the parent decides
//     how it's sent: game chat message, room-chat message, dating-chat
//     message…).
//   · Sticker Shop — compact CARD grid (icon, name, sticker count, buy
//     button). 2 cards per row on phones, 3 from 640px, 4 from 1024px and
//     5 from 1280px — no more full-width rows. Tapping a card POPS it OUT
//     of the grid: it flies to the center of the screen and expands to the
//     four corners, revealing every sticker in the set (preview only —
//     nothing is tappable to send before it's owned). Purchase + claim
//     run through the SAME server-validated route — the client never
//     grants itself anything (§64/§76/§32).
//
// Used by three surfaces: the game-chat composer tray, the room-chat
// bottom drawer (spin bottle + ludo) and the dating personal-chat sheet —
// web AND Capacitor (same React tree). All colors follow the user's app
// theme through --qk-* tokens. The preview modal renders through a
// document.body PORTAL so no tray/sheet overflow or transform can ever
// clip or offset it.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { Clock, Coins, Lock, Sparkles, Check, X } from 'lucide-react'
import { api } from '@/lib/quicky/api-client'
import { getRecentStickers, pushRecentSticker, type RecentSticker } from '@/lib/quicky/recent-stickers'
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

/** FLIP geometry for the shop preview modal — viewport-pixel rects. */
type PreviewRect = { top: number; left: number; width: number; height: number }

type ShopPreview = {
  bundle: StickerCatalogBundle
  /** the tapped card's rect — the flight starts exactly on top of it */
  from: PreviewRect
  /** the centered preview box — the card expands to the four corners */
  to: PreviewRect
  /** true while animating back into the card (then unmount) */
  closing: boolean
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
  const [recent, setRecent] = useState<RecentSticker[]>([])
  const [preview, setPreview] = useState<ShopPreview | null>(null)

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

  // Device-local recency memory — refreshed every time the picker mounts
  // (each tray/sheet open is a fresh mount) and re-ordered after every pick.
  useEffect(() => {
    setRecent(getRecentStickers())
  }, [])

  const owned = (bundles ?? []).filter((b) => b.owned)
  const shop = (bundles ?? []).filter((b) => !b.owned)

  // Recents only surface stickers the user still owns — ownership (not
  // history) decides what can actually be sent.
  const ownedIds = useMemo(() => new Set(owned.flatMap((b) => b.stickers.map((s) => s.id))), [owned])
  const recentOwned = useMemo(
    () => recent.filter((s) => ownedIds.has(s.id)).slice(0, 10),
    [recent, ownedIds]
  )

  /** Sends from ANY surface pass through here — one place to record recency. */
  const pick = (s: PickableSticker) => {
    setRecent(pushRecentSticker({ id: s.id, name: s.name, assetUrl: s.assetUrl }))
    onPick?.(s)
  }

  // ── Shop preview modal (FLIP: card → center → four corners) ───────────
  // The card's live rect is captured on tap; the modal then springs from
  // that exact rect to a centered box. Closing reverses the flight back
  // into the card. Rendered through a body portal so no ancestor
  // overflow/transform can clip it.
  const openShopPreview = (b: StickerCatalogBundle, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    // Mobile friendly: ≤92% of the viewport, capped on larger screens.
    const width = Math.min(vw * 0.92, 416)
    const height = Math.min(vh * 0.74, 560)
    setPreview({
      bundle: b,
      from: { top: r.top, left: r.left, width: r.width, height: r.height },
      to: { top: Math.max(14, (vh - height) / 2), left: (vw - width) / 2, width, height },
      closing: false,
    })
  }

  const closeShopPreview = useCallback(() => {
    setPreview((p) => (p && !p.closing ? { ...p, closing: true } : p))
  }, [])

  // Escape closes the preview; the spring's onAnimationComplete unmounts.
  useEffect(() => {
    if (!preview) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeShopPreview()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [preview, closeShopPreview])

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
        closeShopPreview()
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

  const pBuyable = preview && preview.bundle.unlockType === 'coins' && preview.bundle.purchaseEnabled && preview.bundle.priceCoins > 0
  const pClaimable = preview && preview.bundle.canClaimNow

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
            {/* ── Recently used (device-local) — jumps straight to what the
                user actually sends, without scrolling owned bundles. */}
            {recentOwned.length > 0 && (
              <div className="mb-2.5" data-testid="sticker-recent">
                <div className="flex items-center gap-1.5 mb-1">
                  <Clock className="w-3 h-3 text-white/45" size={12} aria-hidden />
                  <p className="text-[11px] font-bold text-white/60">Recently used</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {recentOwned.map((s) => (
                    <motion.button
                      key={`recent-${s.id}`}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => pick({ id: s.id, name: s.name, assetUrl: s.assetUrl })}
                      className="w-[52px] h-[52px] rounded-2xl bg-[color-mix(in_srgb,var(--qk-accent)_12%,var(--qk-elev))] border border-[var(--qk-accent)]/25 flex items-center justify-center hover:border-[var(--qk-accent)]/50 active:scale-95 transition-colors"
                      aria-label={`Send recent sticker ${s.name}`}
                      data-testid={`sticker-recent-${s.id}`}
                    >
                      <StickerAsset sticker={s} imgClassName="w-9 h-9" emojiClassName="text-3xl" />
                    </motion.button>
                  ))}
                </div>
              </div>
            )}
            {owned.length === 0 ? (
              <div className="flex flex-col items-center gap-1.5 py-6 px-4 text-center">
                <span className="w-11 h-11 rounded-2xl bg-[var(--qk-elev)] border border-white/10 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-[var(--qk-accent)]" size={20} aria-hidden />
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
                        onClick={() => pick(s)}
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
              <p className="text-[10px] font-semibold text-white/35">Tap a set to preview every sticker</p>
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
              /* ── Compact CARD grid — 2 per row on phones, growing with the
                  viewport. The buy button stops propagation: tapping the card
                  body opens the pop-out preview instead. */
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2" data-testid="sticker-shop-grid">
                {shop.map((b) => {
                  const buyable = b.unlockType === 'coins' && b.purchaseEnabled && b.priceCoins > 0
                  const claimable = b.canClaimNow
                  const busy = busyId === b.id
                  return (
                    <motion.div
                      key={b.id}
                      whileTap={{ scale: 0.95 }}
                      onClick={(e) => openShopPreview(b, e.currentTarget as HTMLElement)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          openShopPreview(b, e.currentTarget as HTMLElement)
                        }
                      }}
                      className="rounded-2xl bg-[var(--qk-elev)] border border-white/10 p-2 flex flex-col items-center gap-1 cursor-pointer hover:border-[var(--qk-accent)]/45 transition-colors"
                      role="button"
                      tabIndex={0}
                      aria-label={`Preview ${b.name} sticker set`}
                      data-testid={`sticker-shop-${b.id}`}
                    >
                      <span className="w-12 h-12 rounded-2xl bg-[var(--qk-card)] border border-white/10 flex items-center justify-center overflow-hidden shrink-0">
                        <BundleIcon icon={b.icon} className="text-2xl" imgClassName="w-9 h-9" />
                      </span>
                      <p className="w-full text-center text-[11px] font-bold text-white/90 truncate px-0.5">{b.name}</p>
                      <p className="w-full flex items-center justify-center gap-0.5 text-[9px] font-semibold text-white/40">
                        <Lock className="w-2.5 h-2.5 shrink-0" size={9} aria-hidden />
                        <span className="truncate">{unlockLabel(b)}</span>
                      </p>
                      <p className="text-[9px] font-black text-white/55 tabular-nums">{b.stickers.length} stickers</p>
                      <div className="w-full mt-0.5">
                        {buyable ? (
                          <motion.button
                            whileTap={{ scale: 0.93 }}
                            onClick={(e) => {
                              e.stopPropagation()
                              void buyOrClaim(b)
                            }}
                            disabled={busy}
                            className="w-full flex items-center justify-center gap-1 px-1.5 py-1.5 rounded-xl bg-coral-gradient text-[11px] font-black text-white disabled:opacity-50"
                            aria-label={`Buy ${b.name} for ${b.priceCoins} coins`}
                          >
                            <Coins className="w-3 h-3" size={11} aria-hidden />
                            {busy ? '…' : b.priceCoins.toLocaleString()}
                          </motion.button>
                        ) : claimable ? (
                          <motion.button
                            whileTap={{ scale: 0.93 }}
                            onClick={(e) => {
                              e.stopPropagation()
                              void buyOrClaim(b)
                            }}
                            disabled={busy}
                            className="w-full px-1.5 py-1.5 rounded-xl bg-[var(--qk-accent)] text-[var(--qk-on-accent)] text-[11px] font-black disabled:opacity-50"
                          >
                            {busy ? '…' : 'CLAIM'}
                          </motion.button>
                        ) : (
                          <span className="block w-full text-center px-1.5 py-1.5 rounded-xl bg-white/5 border border-white/10 text-[10px] font-bold text-white/40">
                            Locked
                          </span>
                        )}
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Shop preview modal — the card POPS OUT of the grid, flies to the
          center of the screen and expands to the four corners, revealing all
          stickers in the set (preview only — nothing sends from here).
          Portaled to document.body so trays/sheets can never clip it. */}
      {preview &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[190]"
            role="dialog"
            aria-modal="true"
            aria-label={`${preview.bundle.name} sticker preview`}
            data-testid="sticker-shop-preview"
          >
            {/* backdrop */}
            <motion.div
              className="absolute inset-0 bg-black/70"
              initial={{ opacity: 0 }}
              animate={{ opacity: preview.closing ? 0 : 1 }}
              transition={{ duration: 0.22 }}
              onClick={closeShopPreview}
            />
            {/* the flying card — starts exactly on the tapped card's rect,
                springs outward to the centered preview box; closing reverses
                the flight back into the card. */}
            <motion.div
              className="absolute flex flex-col overflow-hidden bg-[var(--qk-elev)] border border-white/15"
              style={{ borderRadius: 22, boxShadow: '0 24px 70px rgba(0,0,0,0.6)' }}
              initial={{
                top: preview.from.top,
                left: preview.from.left,
                width: preview.from.width,
                height: preview.from.height,
              }}
              animate={
                preview.closing
                  ? {
                      top: preview.from.top,
                      left: preview.from.left,
                      width: preview.from.width,
                      height: preview.from.height,
                      opacity: 0.9,
                    }
                  : {
                      top: preview.to.top,
                      left: preview.to.left,
                      width: preview.to.width,
                      height: preview.to.height,
                      opacity: 1,
                    }
              }
              transition={{ type: 'spring', damping: 30, stiffness: 300, opacity: { duration: 0.2 } }}
              onAnimationComplete={() => {
                if (preview.closing) setPreview(null)
              }}
            >
              {/* header — the only content visible during the flight */}
              <div className="absolute top-0 inset-x-0 z-10 flex items-center gap-2 px-4 py-2.5 bg-gradient-to-b from-[var(--qk-elev)] via-[var(--qk-elev)]/85 to-transparent">
                <span className="w-7 h-7 rounded-xl bg-[var(--qk-card)] border border-white/10 flex items-center justify-center shrink-0">
                  <BundleIcon icon={preview.bundle.icon} className="text-base" imgClassName="w-5 h-5" />
                </span>
                <p className="min-w-0 text-sm font-black text-white truncate">{preview.bundle.name}</p>
                <button
                  onClick={closeShopPreview}
                  className="ml-auto shrink-0 w-9 h-9 -mr-1 rounded-full bg-white/10 border border-white/15 flex items-center justify-center text-white/80 active:scale-90 transition-transform"
                  aria-label="Close preview"
                  data-testid="sticker-preview-close"
                >
                  <X className="w-4 h-4" size={17} />
                </button>
              </div>

              {/* every sticker in the set — staggers in as the box expands.
                  PREVIEW ONLY: tiles are not tappable before the set is owned. */}
              <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-3 pt-14 pb-2">
                <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                  {preview.bundle.stickers.map((s, i) => (
                    <motion.div
                      key={s.id}
                      initial={{ opacity: 0, scale: 0.55, y: 12 }}
                      animate={
                        preview.closing
                          ? { opacity: 0, scale: 0.55, y: 12 }
                          : { opacity: 1, scale: 1, y: 0 }
                      }
                      transition={{
                        delay: preview.closing ? 0 : 0.18 + Math.min(i, 14) * 0.035,
                        type: 'spring',
                        damping: 24,
                        stiffness: 320,
                      }}
                      className="aspect-square rounded-2xl bg-[var(--qk-card)] border border-white/10 flex items-center justify-center overflow-hidden"
                      title={s.name}
                    >
                      <StickerAsset sticker={s} imgClassName="w-10 h-10 sm:w-12 sm:h-12" emojiClassName="text-4xl" />
                    </motion.div>
                  ))}
                </div>
                {preview.bundle.stickers.length === 0 && (
                  <p className="text-center text-[11px] font-semibold text-white/40 py-8">This set has no stickers yet.</p>
                )}
              </div>

              {/* footer — the requirement + buy/claim CTA */}
              <div className="shrink-0 flex items-center gap-2.5 px-4 py-2.5 pb-[max(10px,env(safe-area-inset-bottom,0px))] border-t border-white/10 bg-[var(--qk-card)]">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold text-white/70 truncate">
                    <Lock className="w-2.5 h-2.5 inline mr-1 -mt-0.5" size={10} aria-hidden />
                    {unlockLabel(preview.bundle)} · {preview.bundle.stickers.length} stickers
                  </p>
                  {preview.bundle.description && (
                    <p className="text-[10px] text-white/40 truncate">{preview.bundle.description}</p>
                  )}
                </div>
                {pBuyable ? (
                  <motion.button
                    whileTap={{ scale: 0.93 }}
                    onClick={() => void buyOrClaim(preview.bundle)}
                    disabled={busyId === preview.bundle.id}
                    className="shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-coral-gradient text-xs font-black text-white disabled:opacity-50"
                    data-testid="sticker-preview-buy"
                  >
                    <Coins className="w-3.5 h-3.5" size={13} aria-hidden />
                    {busyId === preview.bundle.id ? '…' : preview.bundle.priceCoins.toLocaleString()}
                  </motion.button>
                ) : pClaimable ? (
                  <motion.button
                    whileTap={{ scale: 0.93 }}
                    onClick={() => void buyOrClaim(preview.bundle)}
                    disabled={busyId === preview.bundle.id}
                    className="shrink-0 px-4 py-2.5 rounded-full bg-[var(--qk-accent)] text-[var(--qk-on-accent)] text-xs font-black disabled:opacity-50"
                    data-testid="sticker-preview-claim"
                  >
                    {busyId === preview.bundle.id ? '…' : 'CLAIM'}
                  </motion.button>
                ) : (
                  <span className="shrink-0 px-3 py-2 rounded-full bg-white/5 border border-white/10 text-[10px] font-bold text-white/40">
                    Locked
                  </span>
                )}
              </div>
            </motion.div>
          </div>,
          document.body
        )}
    </div>
  )
}
