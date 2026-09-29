'use client'

// Quicky — GAME STORE TAB BODIES (Game Economy PRD §6/§7/§34/§37/§50)
//
//   Coins      — balance, rewarded ad, admin-configured packages (§7/§8)
//   Crates     — real-money products with FULLY DISCLOSED contents (§38/§44)
//   Cosmetics  — coin-bought cosmetic cards, OWNED / REALM REWARD states (§54)
//   Featured   — boost banner + the admin-flagged heroes (§50)
//
// All purchases run through the game-store store (server-authoritative).

import { useState } from 'react'
import { toast } from 'sonner'
import { Play, Check, Crown, Flame, Sparkles } from 'lucide-react'
import { useGameStoreStore } from '@/store/game-store'
import { useQuickyStore } from '@/store/quicky'
import { cn } from '@/lib/utils'
import { purchaseStoreProduct } from '@/lib/quicky/payments/client'
import { RewardedAdModal } from '../RewardedAdModal'
import { GiftIcon } from '../GiftIcon'

// ─── Coins (PRD §7-§9) ─────────────────────────────────────────────────────

export function CoinsTab() {
  const payload = useGameStoreStore((s) => s.payload)
  const busy = useGameStoreStore((s) => s.busy)
  const setTab = useGameStoreStore((s) => s.setTab)
  const refresh = useGameStoreStore((s) => s.refresh)
  const isPremium = useQuickyStore((s) => s.user?.isPremium ?? false)
  const [adOpen, setAdOpen] = useState(false)

  const packs = payload?.coinPackages ?? []

  const buy = async (id: string) => {
    // Platform-routed purchase (Monetization PRD §5.4): Stripe on web,
    // Google Play in the Android shell, sandbox instant in dev.
    const res = await purchaseStoreProduct(id)
    if (!res.ok && res.error !== 'apple_pending') {
      toast.error(res.message || 'Purchase failed — nothing was charged.')
    }
    if (res.ok && res.mode === 'completed') await refresh()
  }

  return (
    <div className="p-4 flex flex-col gap-3" data-testid="game-store-coins">
      {payload?.sandbox && (
        <p className="text-[11px] font-semibold text-amber-300/90 bg-amber-400/10 border border-amber-300/20 rounded-xl px-3 py-2">
          🧪 Sandbox payments — no real money is charged.
        </p>
      )}

      {/* Rewarded ad — free coins OR realm points (server-rolled) */}
      <button
        onClick={() => setAdOpen(true)}
        className="w-full flex items-center gap-2.5 rounded-2xl border border-[var(--qk-accent)]/30 bg-[var(--qk-accent)]/10 px-3.5 py-3 text-left hover:bg-[var(--qk-accent)]/18 transition-colors active:scale-[0.99]"
        data-testid="game-store-watch-ad"
      >
        <span className="w-8 h-8 rounded-full bg-[var(--qk-accent)]/15 flex items-center justify-center shrink-0">
          <Play className="w-4 h-4 text-[var(--qk-accent)]" fill="currentColor" aria-hidden />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[13px] font-bold">Watch an ad — free coins or points</span>
          <span className="block text-[10.5px] text-white/50">Pick your reward type, watch to the end, collect 10–100</span>
        </span>
      </button>

      {/* Package grid (admin-configured, PRD §8) */}
      <div className="grid grid-cols-2 gap-2.5">
        {packs.map((p) => {
          const premiumHidden = p.premiumOnly && !isPremium
          return (
            <button
              key={p.id}
              onClick={() => (premiumHidden ? setTab('coins') : void buy(p.id))}
              disabled={!!busy || premiumHidden}
              className={cn(
                'relative flex flex-col items-center gap-1 rounded-2xl border p-3.5 transition-all active:scale-[0.98] disabled:opacity-60',
                premiumHidden
                  ? 'border-[var(--qk-gold)]/25 bg-[var(--qk-gold)]/5'
                  : 'border-white/10 bg-white/5 hover:bg-white/10'
              )}
              data-testid={`game-store-pack-${p.id}`}
            >
              {p.badge && (
                <span
                  className={cn(
                    'absolute -top-2 left-1/2 -translate-x-1/2 text-black text-[9px] font-black uppercase tracking-wide rounded-full px-2 py-0.5 whitespace-nowrap',
                    p.premiumOnly ? 'bg-[var(--qk-gold)]' : 'bg-amber-400'
                  )}
                >
                  {p.badge}
                </span>
              )}
              <span className="text-xl" aria-hidden>🪙</span>
              <span className="font-black tabular-nums text-sm">{p.coins.toLocaleString('en-US')}</span>
              {p.bonusCoins > 0 && (
                <span className="text-[9px] font-bold text-[var(--qk-accent-light)] bg-[var(--qk-accent)]/15 rounded-full px-1.5 py-0.5">
                  +{p.bonusCoins.toLocaleString('en-US')} bonus
                </span>
              )}
              <span className="text-xs mt-0.5 font-bold text-[var(--qk-gold)] tabular-nums">
                ${p.price.toFixed(2)}
              </span>
              <span className="text-[9px] text-white/40 font-semibold uppercase tracking-wide">
                {busy === p.id ? 'Processing…' : premiumHidden ? 'Premium only' : 'Buy now'}
              </span>
            </button>
          )
        })}
        {packs.length === 0 && (
          <p className="col-span-2 text-center text-xs text-white/40 py-6">Coin packages are being configured — check back soon.</p>
        )}
      </div>

      {/* Premium cross-sell (the dating Premium system stays separate, §71 —
          this is a store perk hint, not a paywall link). */}
      {!isPremium && (
        <p className="text-[11px] text-white/40 text-center">
          Premium members earn +20% bonus coins on every standard pack.
        </p>
      )}
      {isPremium && (
        <p className="text-[11px] text-[var(--qk-gold)]/80 text-center flex items-center justify-center gap-1">
          <Crown className="w-3 h-3" aria-hidden /> Premium bonus: +20% coins on standard packs is active.
        </p>
      )}

      <RewardedAdModal
        open={adOpen}
        onClose={() => setAdOpen(false)}
        onRewarded={(r) => {
          if (r.kind === 'COINS') void refresh()
        }}
      />
    </div>
  )
}

// ─── Crates (PRD §37-§44) ──────────────────────────────────────────────────

/** Hearts row — the realm-point visual identity (PRD §20/§40). */
function Hearts({ points }: { points: number }) {
  if (points <= 0) return null
  const hearts = Math.min(5, Math.max(1, Math.round(points / 250)))
  return (
    <span className="text-[11px]" aria-hidden title={`${points} Realm Points`}>
      {'❤️'.repeat(hearts)}
    </span>
  )
}

export function CratesTab() {
  const payload = useGameStoreStore((s) => s.payload)
  const busy = useGameStoreStore((s) => s.busy)
  const buyCrate = useGameStoreStore((s) => s.buyCrate)
  const openCrate = useGameStoreStore((s) => s.openCrate)
  const crates = payload?.crates ?? []
  const pending = payload?.pendingCrates ?? []

  const buy = async (id: string) => {
    const ok = await buyCrate(id)
    if (!ok) toast.error('Crate purchase failed — nothing was charged.')
  }

  return (
    <div className="p-4 flex flex-col gap-3" data-testid="game-store-crates">
      {payload?.sandbox && (
        <p className="text-[11px] font-semibold text-amber-300/90 bg-amber-400/10 border border-amber-300/20 rounded-xl px-3 py-2">
          🧪 Sandbox payments — crates are real-money products; no real money is charged in this build.
        </p>
      )}

      {/* Paid-but-unopened crates (PRD §46/§70 — recovery-first surface) */}
      {pending.length > 0 && (
        <div className="rounded-2xl border border-[var(--qk-accent)]/30 bg-[var(--qk-accent)]/10 p-3">
          <p className="text-[11px] font-black uppercase tracking-wider mb-2 text-[var(--qk-accent)]">
            Your paid crates — open them!
          </p>
          <div className="flex flex-col gap-2">
            {pending.map((c) => (
              <button
                key={c.id}
                onClick={() => void openCrate(c.id, { name: c.name, emoji: c.emoji })}
                disabled={!!busy}
                className="flex items-center gap-2.5 rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-left hover:bg-white/10 transition-colors active:scale-[0.99] disabled:opacity-60"
                data-testid={`game-store-open-owned-${c.id}`}
              >
                <span className="text-xl" aria-hidden>{c.emoji}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-bold truncate">{c.name}</span>
                  <span className="block text-[10.5px] text-white/50">Paid · ready to open</span>
                </span>
                <span className="text-[11px] font-black text-[var(--qk-accent)] uppercase tracking-wide">
                  {busy === c.id ? 'Opening…' : 'Open'}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Crate products (PRD §44 layout) */}
      {crates.map((c) => (
        <div
          key={c.id}
          className="rounded-2xl border border-white/10 bg-white/5 p-3.5 flex flex-col gap-2.5"
          data-testid={`game-store-crate-${c.id}`}
        >
          <div className="flex items-start gap-3">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shrink-0 border"
              style={{
                background: 'color-mix(in srgb, var(--qk-gold) 12%, transparent)',
                borderColor: 'color-mix(in srgb, var(--qk-gold) 30%, transparent)',
              }}
              aria-hidden
            >
              {c.emoji}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-black text-[15px] leading-tight flex items-center gap-1.5 flex-wrap">
                {c.name}
                {c.featured && (
                  <span className="text-[8.5px] font-black uppercase tracking-wide bg-[var(--qk-accent)] text-white rounded-full px-1.5 py-0.5">
                    Featured
                  </span>
                )}
              </p>
              <p className="text-[10px] font-bold uppercase tracking-wider text-white/40 mt-0.5">{c.crateType} crate</p>
              {c.description && <p className="text-[11px] text-white/55 mt-1 leading-snug">{c.description}</p>}
            </div>
          </div>

          {/* Contents — clearly disclosed (PRD §38) */}
          <div className="flex flex-wrap gap-1.5">
            {c.realmPoints > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-[var(--qk-accent)]/12 border border-[var(--qk-accent)]/25 px-2 py-1 text-[10.5px] font-bold">
                <Hearts points={c.realmPoints} /> {c.realmPoints.toLocaleString('en-US')} Realm Points
              </span>
            )}
            {c.coins > 0 && (
              <span className="rounded-full bg-[var(--qk-gold)]/12 border border-[var(--qk-gold)]/25 px-2 py-1 text-[10.5px] font-bold tabular-nums">
                🪙 {c.coins.toLocaleString('en-US')} Coins
              </span>
            )}
            {c.gift && (
              <span className="flex items-center gap-1 rounded-full bg-white/6 border border-white/12 px-2 py-1 text-[10.5px] font-bold">
                <GiftIcon icon={c.gift.emoji} iconType="emoji" className="h-3 w-3 text-[10px]" imgClassName="h-3 w-3" />
                {c.gift.quantity > 1 ? `${c.gift.quantity}× ` : ''}
                {c.gift.name}
              </span>
            )}
            {c.cosmetic && (
              <span className="rounded-full bg-[var(--qk-purple)]/15 border border-[var(--qk-purple)]/30 px-2 py-1 text-[10.5px] font-bold">
                ✨ {c.cosmetic.name}
              </span>
            )}
            {c.bonusLabel && (
              <span className="rounded-full bg-white/5 border border-white/10 px-2 py-1 text-[10.5px] font-semibold text-white/60">
                {c.bonusLabel}
              </span>
            )}
          </div>

          <button
            onClick={() => void buy(c.id)}
            disabled={!!busy}
            className="w-full rounded-2xl py-3 font-black text-[13px] text-white bg-coral-gradient glow-coral disabled:opacity-40 disabled:glow-none transition-all active:scale-[0.98] flex items-center justify-center gap-2"
            data-testid={`game-store-buy-crate-${c.id}`}
          >
            {busy === c.id ? (
              'Processing…'
            ) : (
              <>
                <span>Buy now</span>
                <span className="tabular-nums opacity-90">${c.price.toFixed(2)}</span>
              </>
            )}
          </button>
        </div>
      ))}

      {crates.length === 0 && (
        <p className="text-center text-xs text-white/40 py-6">Crates are being configured — check back soon.</p>
      )}
    </div>
  )
}

// ─── Cosmetics (PRD §34/§54) ───────────────────────────────────────────────

const RARITY_STYLE: Record<string, string> = {
  COMMON: 'text-white/60 border-white/15 bg-white/5',
  RARE: 'text-sky-300 border-sky-400/30 bg-sky-400/10',
  EPIC: 'text-[var(--qk-purple)] border-[var(--qk-purple)]/40 bg-[var(--qk-purple)]/12',
  LEGENDARY: 'text-[var(--qk-gold)] border-[var(--qk-gold)]/40 bg-[var(--qk-gold)]/12',
}

export function CosmeticsTab() {
  const payload = useGameStoreStore((s) => s.payload)
  const busy = useGameStoreStore((s) => s.busy)
  const buyCosmetic = useGameStoreStore((s) => s.buyCosmetic)
  const setTab = useGameStoreStore((s) => s.setTab)
  const cosmetics = payload?.cosmetics ?? []
  const balance = payload?.coinBalance ?? 0

  const buy = async (id: string, name: string, price: number) => {
    if (price > balance) {
      // PRD §47 — "You need N more coins [Buy Coins]": contextual, honest.
      const need = price - balance
      toast(`You need ${need.toLocaleString('en-US')} more coins for ${name}.`, {
        action: { label: 'Buy Coins', onClick: () => setTab('coins') },
      })
      return
    }
    const res = await buyCosmetic(id)
    if (res === 'ok') toast.success(`${name} unlocked — find it in your wardrobe.`)
    else if (res === 'insufficient_coins') toast.error('Not enough coins.')
    else if (res === 'already_owned') toast.error('Already owned.')
    else toast.error('Purchase failed — nothing was charged.')
  }

  return (
    <div className="p-4" data-testid="game-store-cosmetics">
      <p className="text-[11px] text-white/45 mb-3">
        Cosmetics are bought with Game Coins — never real money. Realm-exclusive items are earned by competing.
      </p>
      <div className="grid grid-cols-2 gap-2.5">
        {cosmetics.map((c) => {
          const purchasable = c.priceCoins != null && c.priceCoins > 0 && !c.realmExclusive
          return (
            <div
              key={c.id}
              className={cn(
                'relative flex flex-col items-center gap-1 rounded-2xl border p-3 text-center',
                c.realmExclusive ? 'border-[var(--qk-accent)]/30 bg-[var(--qk-accent)]/8' : 'border-white/10 bg-white/5'
              )}
              data-testid={`game-store-cosmetic-${c.id}`}
            >
              <span className="text-2xl" aria-hidden>{c.icon}</span>
              <span className="text-[11.5px] font-bold leading-tight">{c.name}</span>
              <span
                className={cn(
                  'text-[8.5px] font-black uppercase tracking-wide rounded-full border px-1.5 py-0.5',
                  RARITY_STYLE[c.rarity] ?? RARITY_STYLE.COMMON
                )}
              >
                {c.realmExclusive ? 'Realm Exclusive' : c.rarity}
              </span>
              {c.owned ? (
                <span className="flex items-center gap-1 text-[10px] font-black text-[#30D158] mt-1">
                  <Check className="w-3 h-3" aria-hidden /> OWNED
                </span>
              ) : c.realmExclusive ? (
                <span className="text-[10px] font-bold text-[var(--qk-accent)] mt-1" title="Earn this through realm rewards">
                  🏆 Realm reward
                </span>
              ) : purchasable ? (
                <button
                  onClick={() => void buy(c.id, c.name, c.priceCoins ?? 0)}
                  disabled={!!busy}
                  className="mt-1 w-full rounded-xl py-1.5 text-[11px] font-black bg-[var(--qk-gold)]/15 border border-[var(--qk-gold)]/30 text-[var(--qk-gold)] hover:bg-[var(--qk-gold)]/25 transition-colors active:scale-[0.97] disabled:opacity-50 tabular-nums"
                >
                  {busy === c.id ? '…' : `🪙 ${(c.priceCoins ?? 0).toLocaleString('en-US')}`}
                </button>
              ) : (
                <span className="text-[10px] text-white/40 font-semibold mt-1">Not for sale</span>
              )}
            </div>
          )
        })}
        {cosmetics.length === 0 && (
          <p className="col-span-2 text-center text-xs text-white/40 py-6">Cosmetics are being configured — check back soon.</p>
        )}
      </div>
    </div>
  )
}

// ─── Featured (PRD §50) ────────────────────────────────────────────────────

export function FeaturedTab() {
  const payload = useGameStoreStore((s) => s.payload)
  const setTab = useGameStoreStore((s) => s.setTab)
  const busy = useGameStoreStore((s) => s.busy)
  const buyCrate = useGameStoreStore((s) => s.buyCrate)

  const buyFeatured = async (id: string) => {
    const res = await purchaseStoreProduct(id)
    if (!res.ok && res.error !== 'apple_pending') {
      toast.error(res.message || 'Purchase failed — nothing was charged.')
    }
  }

  const featuredPack = payload?.coinPackages.find((p) => p.featured) ?? payload?.coinPackages[payload.coinPackages.length - 1] ?? null
  const featuredCrate = payload?.crates.find((c) => c.featured) ?? payload?.crates[0] ?? null
  const featuredCosmetic = payload?.cosmetics.find((c) => c.rarity === 'LEGENDARY' && !c.owned) ?? null
  const boost = payload?.boost

  return (
    <div className="p-4 flex flex-col gap-3" data-testid="game-store-featured">
      {/* 🔥 Realm Boost hero (PRD §51) */}
      {boost?.active && (
        <div
          className="rounded-2xl border p-4 flex flex-col gap-2"
          style={{
            background: 'linear-gradient(135deg, color-mix(in srgb, var(--qk-accent) 22%, transparent), transparent)',
            borderColor: 'color-mix(in srgb, var(--qk-accent) 45%, transparent)',
          }}
          data-testid="game-store-featured-boost"
        >
          <p className="font-black text-sm flex items-center gap-1.5" style={{ color: 'var(--qk-accent)' }}>
            <Flame className="w-4 h-4" aria-hidden /> {boost.multiplier}× REALM BOOST ACTIVE
          </p>
          <p className="text-[11.5px] text-white/70 leading-snug">
            Your realm is in its final hours — every gift now earns <b>{boost.multiplier}× ❤️ realm points</b>.
            Send gifts and climb before the cycle closes.
          </p>
        </div>
      )}

      {/* 🪙 Featured coin pack */}
      {featuredPack && (
        <button
          onClick={() => void buyFeatured(featuredPack.id)}
          disabled={!!busy}
          className="rounded-2xl border border-[var(--qk-gold)]/30 bg-[var(--qk-gold)]/10 p-4 flex items-center gap-3 text-left hover:bg-[var(--qk-gold)]/16 transition-colors active:scale-[0.99] disabled:opacity-60"
          data-testid="game-store-featured-pack"
        >
          <span className="text-2xl" aria-hidden>🪙</span>
          <span className="flex-1 min-w-0">
            <span className="block font-black text-[13.5px]">{featuredPack.name}</span>
            <span className="block text-[11px] text-white/60 tabular-nums">
              {(featuredPack.coins + featuredPack.bonusCoins).toLocaleString('en-US')} coins
              {featuredPack.bonusCoins > 0 && ` (incl. +${featuredPack.bonusCoins.toLocaleString('en-US')} bonus)`}
            </span>
          </span>
          <span className="text-[13px] font-black text-[var(--qk-gold)] tabular-nums">${featuredPack.price.toFixed(2)}</span>
        </button>
      )}

      {/* 💎 Featured crate */}
      {featuredCrate && (
        <button
          onClick={() => void buyCrate(featuredCrate.id)}
          disabled={!!busy}
          className="rounded-2xl border border-white/12 bg-white/5 p-4 flex items-center gap-3 text-left hover:bg-white/10 transition-colors active:scale-[0.99] disabled:opacity-60"
          data-testid="game-store-featured-crate"
        >
          <span className="text-2xl" aria-hidden>{featuredCrate.emoji}</span>
          <span className="flex-1 min-w-0">
            <span className="block font-black text-[13.5px]">{featuredCrate.name}</span>
            <span className="block text-[11px] text-white/60">
              {featuredCrate.realmPoints > 0 && <span className="tabular-nums">{featuredCrate.realmPoints.toLocaleString('en-US')} ❤️ guaranteed</span>}
              {featuredCrate.coins > 0 && <span className="tabular-nums"> · 🪙 {featuredCrate.coins.toLocaleString('en-US')}</span>}
            </span>
          </span>
          <span className="text-[13px] font-black text-[var(--qk-gold)] tabular-nums">${featuredCrate.price.toFixed(2)}</span>
        </button>
      )}

      {/* ✨ Featured cosmetic */}
      {featuredCosmetic && (
        <button
          onClick={() => setTab('cosmetics')}
          className="rounded-2xl border border-[var(--qk-purple)]/30 bg-[var(--qk-purple)]/10 p-4 flex items-center gap-3 text-left hover:bg-[var(--qk-purple)]/16 transition-colors active:scale-[0.99]"
          data-testid="game-store-featured-cosmetic"
        >
          <span className="text-2xl" aria-hidden>{featuredCosmetic.icon}</span>
          <span className="flex-1 min-w-0">
            <span className="block font-black text-[13.5px] flex items-center gap-1.5">
              {featuredCosmetic.name}
              <Sparkles className="w-3 h-3 text-[var(--qk-purple)]" aria-hidden />
            </span>
            <span className="block text-[11px] text-white/60">
              {featuredCosmetic.priceCoins != null ? `🪙 ${featuredCosmetic.priceCoins.toLocaleString('en-US')} · ` : ''}
              {featuredCosmetic.rarity}
            </span>
          </span>
        </button>
      )}
    </div>
  )
}
