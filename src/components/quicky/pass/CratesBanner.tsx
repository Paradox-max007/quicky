'use client'

// Quicky — CRATES BANNER (crate-tracks PRD)
//
// A small banner button that jumps straight into the CRATES screen (the
// battle-pass room): the featured crate's details on mobile web/Capacitor
// (full sliding screen), the crates MODAL on desktop web. Mounted on the
// Games hub and every game's primary screen ("main game screen") so the
// pass is always one tap away.
//
// Shows the live season name + the viewer's level on the featured crate
// (shared pass store — one fetch per surface, same data as the 👑 chip).

import { useEffect } from 'react'
import { ChevronRight } from 'lucide-react'
import { usePassStore } from '@/store/pass'
import { formatCompact } from '@/lib/quicky/format'

export function CratesBanner({ compact = false }: { compact?: boolean }) {
  const openCrates = usePassStore((s) => s.openCrates)
  const season = usePassStore((s) => s.season)
  const crates = usePassStore((s) => s.crates)

  // One light fetch per surface (shared store; the 👑 chip reuses it).
  useEffect(() => {
    if (!usePassStore.getState().cratesLoaded) void usePassStore.getState().refreshCrates()
    if (!usePassStore.getState().seasonLoaded) void usePassStore.getState().refreshSeason()
  }, [])

  const target = crates.find((c) => c.isPointsTarget) ?? crates[0] ?? null
  const seasonName = season?.season?.name ?? null

  return (
    <button
      onClick={() => void openCrates()}
      className="relative w-full overflow-hidden rounded-2xl border active:scale-[0.98] transition-transform text-left group"
      style={{
        borderColor: 'color-mix(in srgb, var(--qk-gold) 40%, transparent)',
        background:
          'linear-gradient(100deg, color-mix(in srgb, var(--qk-gold) 24%, transparent), color-mix(in srgb, var(--qk-gold) 8%, transparent) 55%, transparent)',
      }}
      aria-label={target ? `Open crates — ${target.name}, level ${target.currentLevel} of ${target.levelCount}` : 'Open crates'}
      data-testid="crates-banner"
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
            background: 'color-mix(in srgb, var(--qk-gold) 18%, transparent)',
            borderColor: 'color-mix(in srgb, var(--qk-gold) 35%, transparent)',
          }}
          aria-hidden
        >
          <span className="text-[18px] leading-none">🎁</span>
        </span>
        <div className="min-w-0 flex-1">
          <p className={`font-black tracking-wide truncate ${compact ? 'text-[11.5px]' : 'text-[12.5px]'}`} style={{ color: 'var(--qk-gold)' }}>
            CRATES{seasonName ? ` · ${seasonName}` : ''}
          </p>
          <p className="text-[10.5px] font-semibold text-white/60 truncate">
            {target
              ? `Level ${formatCompact(target.currentLevel)}/${formatCompact(target.levelCount)} · claim free prizes every level`
              : 'Win realms · claim free prizes every level'}
          </p>
        </div>
        <ChevronRight className="w-4 h-4 shrink-0" style={{ color: 'var(--qk-gold)' }} aria-hidden />
      </div>
    </button>
  )
}
