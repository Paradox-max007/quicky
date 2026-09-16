'use client'

// Quicky — CHEMISTRY INDICATOR (Game Hub PRD §22/§73)
// Small premium visual: "💗 82% Chemistry" + a slim progress bar. The score
// comes from the server's central chemistry engine (§20) — never computed
// in the frontend.

import { motion } from 'framer-motion'

export function ChemistryIndicator({
  value,
  compact = false,
}: {
  value: number
  compact?: boolean
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <div className={compact ? 'flex items-center gap-2' : 'flex flex-col gap-1.5'}>
      <div className="flex items-center gap-1.5">
        <span aria-hidden>💗</span>
        <span className="font-black tabular-nums text-[var(--qk-accent-light)]">{pct}%</span>
        <span className="text-[11px] text-white/50">Chemistry</span>
      </div>
      <div className={compact ? 'hidden' : 'h-1.5 rounded-full bg-white/8 overflow-hidden'}>
        <motion.div
          className="h-full rounded-full bg-coral-gradient"
          initial={{ width: '0%' }}
          animate={{ width: `${Math.max(4, pct)}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
      </div>
    </div>
  )
}
