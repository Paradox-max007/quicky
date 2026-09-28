'use client'

// Quicky — GAME STORE BANNER (Game Economy PRD §74)
//
// The Games hub / game primary screens entry into the GAME STORE — the
// Games section's own economy (coins, real-money crates, coin cosmetics).
// Deliberately branded "GAME STORE" (PRD §72), never "Premium": the dating
// subscription is a separate system.
//
// During the final-hours realm boost the banner escalates (PRD §51) — the
// boost chip + Buy Coins CTA is the strongest monetization touchpoint.

import { ChevronRight, Coins } from 'lucide-react'
import { useGameStoreStore, openGameStore } from '@/store/game-store'
import { useRealmStore } from '@/store/realm'
import { formatCompact } from '@/lib/quicky/format'

export function GameStoreBanner({ compact = false }: { compact?: boolean }) {
  const boost = useRealmStore((s) => s.boost)
  const payload = useGameStoreStore((s) => s.payload)
  const balance = payload?.coinBalance ?? 0

  return (
    <button
      onClick={() => openGameStore('coins')}
      className="relative w-full overflow-hidden rounded-2xl border active:scale-[0.98] transition-transform text-left group"
      style={{
        borderColor: 'color-mix(in srgb, var(--qk-accent) 40%, transparent)',
        background:
          'linear-gradient(100deg, color-mix(in srgb, var(--qk-accent) 22%, transparent), color-mix(in srgb, var(--qk-accent) 8%, transparent) 55%, transparent)',
      }}
      aria-label="Open the Game Store — coins, crates and cosmetics"
      data-testid="game-store-banner"
    >
      {/* shine sweep */}
      <span
        className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 skew-x-[-18deg] bg-white/12 opacity-0 group-hover:opacity-100 group-hover:animate-[qk-shine_1.1s_ease-out] transition-opacity"
        aria-hidden
      />
      <div className={`flex items-center gap-3 ${compact ? 'px-3 py-2' : 'px-3.5 py-2.5'}`}>
        <span
          className="shrink-0 flex items-center justify-center rounded-xl border"
          style={{
            width: compact ? 34 : 38,
            height: compact ? 34 : 38,
            background: 'color-mix(in srgb, var(--qk-accent) 18%, transparent)',
            borderColor: 'color-mix(in srgb, var(--qk-accent) 35%, transparent)',
          }}
          aria-hidden
        >
          <span className="text-[18px] leading-none">🛍️</span>
        </span>
        <div className="min-w-0 flex-1">
          <p
            className={`font-black tracking-wide truncate ${compact ? 'text-[11.5px]' : 'text-[12.5px]'}`}
            style={{ color: 'var(--qk-accent)' }}
          >
            GAME STORE
            {boost.active && ` · 🔥 ${boost.multiplier}× BOOST`}
          </p>
          <p className="text-[10.5px] font-semibold text-white/60 truncate flex items-center gap-1">
            <Coins className="w-3 h-3 text-[var(--qk-gold)]" aria-hidden />
            {formatCompact(balance)} game coins · crates · cosmetics
          </p>
        </div>
        <ChevronRight className="w-4 h-4 shrink-0" style={{ color: 'var(--qk-accent)' }} aria-hidden />
      </div>
    </button>
  )
}
