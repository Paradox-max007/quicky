'use client'

// Quicky — GIFTS HUB MODAL (main game screen, Total Gifts chip)
//
// The 💝 Total Gifts tile on every game's primary screen opens THIS modal:
//
//   ┌──────────────────────────────────────────────────────────┐
//   │ Gifts & Style                                    ✕ 🪙 1.2K │
//   │ [ 🎁 Gifts ] [ 🖼️ Frames ] [ 🎩 Hats ] [ 👑 Name Icons ]  │
//   │ ──────────────────────────────────────────────────────── │
//   │ GIFTS tab   → the DB gift catalog (admin-owned). Tap a   │
//   │               gift → pick a FRIEND + quantity → Send.    │
//   │               Same economy as the room flow (50% back).  │
//   │ FRAMES/HATS/NAME ICONS tabs → the ACTIVE cosmetics       │
//   │               catalog with live previews, rarity + owned │
//   │               levels; earned through realm wins.         │
//   │               Chat bubbles are EVENT-ONLY → no tab here. │
//   └──────────────────────────────────────────────────────────┘
//
// All tabs are SCROLLABLE. Bottom sheet on mobile, centered modal on
// desktop (same layout split as GiftSheet). Portal to document.body.

import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, ChevronLeft, Coins, Crown, Frame as FrameIcon, Gift, HardHat, Loader2, Sparkles, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { api, type GiftsHubCosmeticEntry, type GiftsHubGift } from '@/lib/quicky/api-client'
import { GiftIcon } from '@/components/quicky/GiftIcon'
import { CosmeticAsset } from '@/components/quicky/cosmetics/Cosmetics'
import type { LevelAsset, CosmeticAnimation } from '@/store/rewards'
import { cn } from '@/lib/utils'

type Friend = { id: string; name: string | null; photos?: { url: string }[] }

type TabKey = 'gifts' | 'PROFILE_FRAME' | 'HAT' | 'NAME_DECORATOR'

const TABS: { key: TabKey; label: string; icon: typeof Gift }[] = [
  { key: 'gifts', label: 'Gifts', icon: Gift },
  { key: 'PROFILE_FRAME', label: 'Frames', icon: FrameIcon },
  { key: 'HAT', label: 'Hats', icon: HardHat },
  { key: 'NAME_DECORATOR', label: 'Name Icons', icon: Crown },
]

const QUANTITY_CHIPS = [1, 10, 50, 100] as const

const RARITY_STYLE: Record<string, { color: string; bg: string }> = {
  COMMON: { color: '#a3e635', bg: 'rgba(163, 230, 53, 0.14)' },
  RARE: { color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.14)' },
  EPIC: { color: '#c084fc', bg: 'rgba(192, 132, 252, 0.16)' },
  LEGENDARY: { color: 'var(--qk-gold)', bg: 'rgba(245, 197, 66, 0.16)' },
}

export function GiftsHubModal({
  open,
  onClose,
  coinBalance,
  onGiftSent,
  onBuyCoins,
}: {
  open: boolean
  onClose: () => void
  /** Live balance hint (the authoritative balance comes back from the API). */
  coinBalance?: number | null
  /** Sent — bump the Total Gifts tile + propagate the new balance. */
  onGiftSent?: (info: { newBalance: number; quantity: number }) => void
  /** Opens the existing coin store on 402 insufficient_coins. */
  onBuyCoins?: () => void
}) {
  const [tab, setTab] = useState<TabKey>('gifts')
  const [gifts, setGifts] = useState<GiftsHubGift[]>([])
  const [balance, setBalance] = useState<number | null>(coinBalance ?? null)
  const [friends, setFriends] = useState<Friend[]>([])
  const [cosmetics, setCosmetics] = useState<GiftsHubCosmeticEntry[]>([])
  const [loading, setLoading] = useState(false)

  // Gifts send sub-flow state
  const [selected, setSelected] = useState<GiftsHubGift | null>(null)
  const [recipientId, setRecipientId] = useState<string | null>(null)
  const [qty, setQty] = useState(1)
  const [sending, setSending] = useState(false)

  // Load everything the modal needs the moment it opens (catalog + friends
  // + cosmetic catalog — one round-trip batch, cached in local state).
  // NOTE: coinBalance is only the INITIAL hint (captured at mount); the API
  // response carries the authoritative balance and overwrites it.
  useEffect(() => {
    if (!open) return
    setSelected(null)
    setRecipientId(null)
    setQty(1)
    setLoading(true)
    void Promise.all([api.giftsHub.catalog(), api.friends.list(), api.cosmetics.catalog()])
      .then(([giftsRes, friendsRes, cosmeticsRes]) => {
        setGifts(giftsRes?.catalog ?? [])
        setBalance(giftsRes?.coinBalance ?? null)
        setFriends(friendsRes?.friends ?? [])
        setCosmetics(cosmeticsRes?.catalog ?? [])
      })
      .catch(() => {
        toast.error('Could not load the gift catalog — try again.')
      })
      .finally(() => setLoading(false))
  }, [open])

  const cosmeticRows = useMemo(
    () => cosmetics.filter((c) => c.rewardType === tab).sort((a, b) => (a.rarity === b.rarity ? a.name.localeCompare(b.name) : rarityRank(b.rarity) - rarityRank(a.rarity))),
    [cosmetics, tab],
  )

  const selectedFriend = friends.find((f) => f.id === recipientId) ?? null
  const totalCost = (selected?.priceCoins ?? 0) * qty

  const onSend = async () => {
    if (!selected || !recipientId || sending) return
    setSending(true)
    try {
      const res = await api.giftsHub.send(recipientId, selected.id, qty)
      setBalance(res.coinBalance)
      toast.success(`Sent ${qty > 1 ? `${qty}× ` : ''}${selected.name} to ${res.recipientName}!`, {
        description: `${res.totalCost.toLocaleString()} coins · they get 50% back`,
      })
      onGiftSent?.({ newBalance: res.coinBalance, quantity: qty })
      setSelected(null)
      setRecipientId(null)
      setQty(1)
    } catch (err) {
      const status = (err as { status?: number })?.status
      const code = (err as { body?: { error?: string } })?.body?.error
      if (status === 402 || code === 'insufficient_coins') {
        toast.error('Not enough coins', { description: 'Grab more coins from the coin store.' })
        onBuyCoins?.()
      } else {
        toast.error('Could not send the gift — try again.')
      }
    } finally {
      setSending(false)
    }
  }

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[218] flex items-end md:items-center justify-center">
          <motion.div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-label="Gifts and cosmetics"
            initial={{ y: 90, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 70, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 340, damping: 30 }}
            className="relative w-in(94vw,26.5rem)] max-h-[86vh] rounded-3xl border border-white/12 bg-[var(--qk-card)] flex flex-col overflow-hidden shadow-[0_24px_70px_rgba(0,0,0,0.6)]"
          >
            {/* ── Header ─────────────────────────────────────────────── */}
            <div className="shrink-0 flex items-center gap-2 px-4 pt-3.5 pb-2.5 border-b border-white/8">
              <Sparkles className="w-4 h-4 text-[var(--qk-accent)]" aria-hidden />
              <h3 className="text-sm font-black tracking-tight">Gifts &amp; Style</h3>
              <span className="ml-auto flex items-center gap-1 rounded-full border border-[var(--qk-gold)]/35 px-2.5 py-0.5 text-[11px] font-black tabular-nums" style={{ color: 'var(--qk-gold)' }}>
                <Coins className="w-3 h-3" aria-hidden />
                {balance != null ? balance.toLocaleString() : '—'}
              </span>
              <button onClick={onClose} className="p-1.5 rounded-full bg-white/5 hover:bg-white/15 text-white/50 transition" aria-label="Close">
                <X className="w-4 h-4" aria-hidden />
              </button>
            </div>

            {/* ── Tabs (chat bubbles are event-only → NOT here) ──────── */}
            <div className="shrink-0 flex items-center gap-1 px-2.5 pt-2 pb-1 overflow-x-auto no-scrollbar" role="tablist">
              {TABS.map((t) => {
                const active = tab === t.key
                const Icon = t.icon
                return (
                  <button
                    key={t.key}
                    role="tab"
                    aria-selected={active}
                    onClick={() => { setTab(t.key); setSelected(null) }}
                    className={cn(
                      'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-black transition-colors',
                      active ? 'text-black' : 'text-white/55 hover:text-white/85 hover:bg-white/8',
                    )}
                    style={active ? { background: 'var(--qk-accent)' } : undefined}
                  >
                    <Icon className="w-3.5 h-3.5" aria-hidden />
                    {t.label}
                  </button>
                )
              })}
            </div>

            {/* ── Scrollable body ───────────────────────────────────── */}
            <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-3.5 py-3" data-testid={`gifts-hub-${tab}`}>
              {loading ? (
                <div className="py-10 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-white/40" aria-hidden />
                </div>
              ) : tab === 'gifts' ? (
                selected ? (
                  <GiftSendFlow
                    gift={selected}
                    friends={friends}
                    recipientId={recipientId}
                    qty={qty}
                    totalCost={totalCost}
                    sending={sending}
                    onPick={setRecipientId}
                    onQty={setQty}
                    onSend={() => void onSend()}
                    onBack={() => { setSelected(null); setRecipientId(null); setQty(1) }}
                  />
                ) : (
                  <GiftsGrid gifts={gifts} onPick={(g) => setSelected(g)} />
                )
              ) : (
                <CosmeticsCatalog rows={cosmeticRows} kind={tab} />
              )}
            </div>

            {/* ── Footer hint ───────────────────────────────────────── */}
            <div className="shrink-0 px-4 py-2 border-t border-white/8">
              <p className="text-[9.5px] font-semibold text-white/35 text-center">
                {tab === 'gifts'
                  ? 'Send gifts to friends — recipients get 50% of the value back in coins.'
                  : 'Cosmetics are earned through realm wins · chat bubbles come from events only.'}
              </p>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  )
}

// ─── GIFTS tab — catalog grid ───────────────────────────────────────────────

function GiftsGrid({ gifts, onPick }: { gifts: GiftsHubGift[]; onPick: (g: GiftsHubGift) => void }) {
  if (gifts.length === 0) {
    return (
      <div className="py-10 text-center flex flex-col items-center gap-2">
        <span className="text-3xl" aria-hidden>🎁</span>
        <p className="text-sm text-white/50">No gifts in the catalog yet — the admin hasn&apos;t published any.</p>
      </div>
    )
  }
  return (
    <div className="grid grid-cols-3 gap-2.5">
      {gifts.map((g) => (
        <button
          key={g.id}
          onClick={() => onPick(g)}
          className="rounded-2xl border border-white/10 bg-white/[0.04] hover:bg-white/10 active:scale-[0.96] transition-all p-2 flex flex-col items-center text-center gap-1"
          aria-label={`Send ${g.name} — ${g.priceCoins} coins`}
          data-testid="gifts-hub-gift"
        >
          <GiftIcon icon={g.icon} iconType={g.iconType} className="w-11 h-11 text-[30px]" alt={g.name} />
          <p className="text-[10.5px] font-bold text-white/85 leading-tight truncate w-full">{g.name}</p>
          <p className="flex items-center gap-0.5 text-[10.5px] font-black tabular-nums" style={{ color: 'var(--qk-gold)' }}>
            <Coins className="w-3 h-3" aria-hidden />
            {g.priceCoins.toLocaleString()}
          </p>
        </button>
      ))}
    </div>
  )
}

// ─── GIFTS tab — send flow (recipient + quantity + total) ───────────────────

function GiftSendFlow({
  gift,
  friends,
  recipientId,
  qty,
  totalCost,
  sending,
  onPick,
  onQty,
  onSend,
  onBack,
}: {
  gift: GiftsHubGift
  friends: Friend[]
  recipientId: string | null
  qty: number
  totalCost: number
  sending: boolean
  onPick: (id: string) => void
  onQty: (n: number) => void
  onSend: () => void
  onBack: () => void
}) {
  return (
    <div className="flex flex-col gap-3">
      {/* the picked gift */}
      <div className="flex items-center gap-3 rounded-2xl border border-[var(--qk-accent)]/40 bg-[var(--qk-accent)]/10 p-2.5">
        <GiftIcon icon={gift.icon} iconType={gift.iconType} className="w-12 h-12 text-[32px]" alt={gift.name} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black truncate">{gift.name}</p>
          <p className="text-[11px] font-bold tabular-nums" style={{ color: 'var(--qk-gold)' }}>
            {gift.priceCoins.toLocaleString()} coins each
          </p>
        </div>
        <button onClick={onBack} className="p-2 rounded-full bg-white/8 hover:bg-white/15 transition" aria-label="Back to the gift grid">
          <ChevronLeft className="w-4 h-4" aria-hidden />
        </button>
      </div>

      {/* recipient picker — scrollable */}
      <div>
        <p className="text-[10px] font-black uppercase tracking-wider text-white/40 mb-1.5">Send to</p>
        {friends.length === 0 ? (
          <p className="py-4 text-center text-xs text-white/45">No friends yet — add friends to send them gifts.</p>
        ) : (
          <div className="max-h-[176px] overflow-y-auto no-scrollbar flex flex-col gap-1 pr-0.5">
            {friends.map((f) => {
              const active = recipientId === f.id
              const photo = f.photos?.[0]?.url
              return (
                <button
                  key={f.id}
                  onClick={() => onPick(f.id)}
                  className={cn(
                    'flex items-center gap-2.5 rounded-xl border px-2.5 py-1.5 text-left transition-all',
                    active ? 'border-[var(--qk-accent)]/60 bg-[var(--qk-accent)]/12' : 'border-white/8 bg-white/[0.03] hover:bg-white/8',
                  )}
                  aria-pressed={active}
                  data-testid="gifts-hub-recipient"
                >
                  <span className="w-9 h-9 rounded-xl overflow-hidden bg-white/10 border border-white/15 flex items-center justify-center shrink-0">
                    {photo ? (
                      <img src={photo} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-sm font-black text-white/70">{(f.name ?? '?').slice(0, 1).toUpperCase()}</span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-white/85">{f.name ?? 'Someone'}</span>
                  {active && <Check className="w-4 h-4 text-[var(--qk-accent)]" strokeWidth={3} aria-hidden />}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* quantity chips */}
      <div>
        <p className="text-[10px] font-black uppercase tracking-wider text-white/40 mb-1.5">Quantity</p>
        <div className="flex items-center gap-1.5">
          {QUANTITY_CHIPS.map((n) => (
            <button
              key={n}
              onClick={() => onQty(n)}
              className={cn(
                'rounded-full px-3 py-1 text-[11px] font-black tabular-nums transition-colors',
                qty === n ? 'text-black' : 'bg-white/8 text-white/60 hover:bg-white/15',
              )}
              style={qty === n ? { background: 'var(--qk-accent)' } : undefined}
              aria-pressed={qty === n}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* total + send */}
      <button
        onClick={onSend}
        disabled={!recipientId || sending}
        className="w-full flex items-center justify-center gap-2 rounded-2xl py-3 text-[14px] font-black text-black disabled:opacity-50 active:scale-[0.98] transition-transform"
        style={{
          background: 'linear-gradient(180deg, color-mix(in srgb, var(--qk-accent) 85%, white), var(--qk-accent))',
          boxShadow: '0 8px 24px color-mix(in srgb, var(--qk-accent) 30%, transparent)',
        }}
        data-testid="gifts-hub-send"
      >
        {sending ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> Sending…
          </>
        ) : (
          <>
            <Gift className="w-4 h-4" aria-hidden />
            Send Gift · {totalCost.toLocaleString()} coins
          </>
        )}
      </button>
    </div>
  )
}

// ─── FRAMES / HATS / NAME ICONS tabs — cosmetics catalog ────────────────────

function rarityRank(r: string): number {
  return ['COMMON', 'RARE', 'EPIC', 'LEGENDARY'].indexOf(r)
}

function CosmeticsCatalog({ rows, kind }: { rows: GiftsHubCosmeticEntry[]; kind: TabKey }) {
  if (rows.length === 0) {
    return (
      <div className="py-10 text-center flex flex-col items-center gap-2">
        <span className="text-3xl" aria-hidden>{kind === 'HAT' ? '🎩' : kind === 'PROFILE_FRAME' ? '🖼️' : '👑'}</span>
        <p className="text-sm text-white/50">Nothing published in this catalog yet.</p>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      {rows.map((c) => {
        const rarity = RARITY_STYLE[c.rarity] ?? RARITY_STYLE.COMMON
        const ownedCount = c.ownedLevels.length
        // Preview: the highest OWNED level's asset (bragging rights), else
        // level 1's (what you're earning toward).
        const previewLevel = ownedCount > 0 ? Math.max(...c.ownedLevels) : 1
        const asset = (c.levels as Partial<Record<1 | 2 | 3, LevelAsset | CosmeticAnimation>> | null)?.[previewLevel as 1 | 2 | 3] ?? null
        return (
          <div
            key={c.id}
            className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.03] p-2.5"
            data-testid="gifts-hub-cosmetic"
          >
            {/* preview — square like every prize tile in the app */}
            <span className="relative shrink-0 w-[62px] h-[62px] rounded-2xl border border-white/10 bg-white/[0.04] flex items-center justify-center overflow-hidden">
              {kind === 'NAME_DECORATOR' && c.decorator ? (
                <span className="flex items-center gap-1 px-1">
                  <span className="text-[15px] leading-none">{c.decorator.left ?? ''}</span>
                  <span className="text-[11px] font-black text-white/70">{(c.name ?? 'You').slice(0, 6)}</span>
                  <span className="text-[15px] leading-none">{c.decorator.right ?? ''}</span>
                </span>
              ) : (
                <CosmeticAsset asset={asset} className="w-full h-full object-contain" fallback="✨" />
              )}
              {ownedCount > 0 && (
                <span className="absolute bottom-0.5 right-0.5 rounded-full px-1.5 py-px text-[8px] font-black text-black" style={{ background: '#30D158' }}>
                  {ownedCount}/3
                </span>
              )}
            </span>

            {/* name + rarity + levels */}
            <div className="min-w-0 flex-1 flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <p className="text-[13.5px] font-bold text-white/90 truncate">{c.name}</p>
                <span
                  className="ml-auto shrink-0 rounded-full px-2 py-px text-[8.5px] font-black uppercase tracking-wider"
                  style={{ background: rarity.bg, color: rarity.color }}
                >
                  {c.rarity}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {[1, 2, 3].map((lv) => (
                  <span
                    key={lv}
                    className={cn(
                      'rounded-full px-1.5 py-px text-[8.5px] font-black tabular-nums',
                      c.ownedLevels.includes(lv) ? 'text-black' : 'bg-white/8 text-white/40',
                    )}
                    style={c.ownedLevels.includes(lv) ? { background: '#30D158' } : undefined}
                    title={lv === 3 ? 'Level 3 — animated' : `Level ${lv}`}
                  >
                    L{lv}
                  </span>
                ))}
                <span className="ml-auto text-[9px] font-bold uppercase tracking-wide" style={{ color: ownedCount > 0 ? '#30D158' : 'rgba(255,255,255,0.35)' }}>
                  {ownedCount > 0 ? (c.anyEquipped ? 'Owned · equipped' : 'Owned') : 'Earn through realm wins'}
                </span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
