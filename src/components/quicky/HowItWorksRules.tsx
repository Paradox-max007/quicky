'use client'

// Quicky — "How It Works" rotating rule display (lifecycle PRD §38-§53)
//
// Play Now screen contract:
//   · ONE rule at a time — never a list of all rules (§38/§39);
//   · rules come from the DATABASE (admin-managed, §44), ordered by the
//     admin's sort_order (§49); no frontend deploy needed to change them;
//   · slow, readable rotation: ~4.2s visible + ~0.45s fade/slide (§41);
//   · progress dots (§43) and a STABLE container height so the screen never
//     jumps when rules of different lengths rotate (§52/§53);
//   · zero rules → built-in fallback copy (§51); one rule → static, no
//     pointless animation (§51).

import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '@/lib/quicky/api-client'

export type HowItWorksRule = {
  id: string
  title: string
  description: string
  icon: string
}

// §51 fallback — shown only when the DB has no active rules (or fetch fails).
const FALLBACK_RULES: HowItWorksRule[] = [
  { id: 'fb-1', title: 'Take Your Seat', description: 'Join a room and meet other players around the table.', icon: '🎲' },
  { id: 'fb-2', title: 'Let It Spin', description: 'The system spins the bottle — when it points at you, the round begins.', icon: '🍾' },
  { id: 'fb-3', title: 'Kiss or No Thanks', description: 'Both players choose ❤️ Kiss or 💔 No Thanks — mutual kisses earn points.', icon: '💋' },
  { id: 'fb-4', title: 'Gift & Shine', description: 'Send gifts, earn Game Points and climb the leaderboard.', icon: '🎁' },
]

const RULE_VISIBLE_MS = 4200 // §41: 3.5–5s readable pause
const RULE_TRANSITION_S = 0.45 // §41: 300–500ms transition

export function HowItWorksRules() {
  const [rules, setRules] = useState<HowItWorksRule[] | null>(null) // null = still loading
  const [index, setIndex] = useState(0)

  // §50: fetch active rules sorted by sort_order, then start the rotation.
  useEffect(() => {
    let cancelled = false
    api.spinBottle
      .rules()
      .then((res) => {
        if (cancelled) return
        const list = (res?.rules ?? []).filter((r) => r && r.title && r.description)
        setRules(list.length > 0 ? list : FALLBACK_RULES)
      })
      .catch(() => {
        if (!cancelled) setRules(FALLBACK_RULES)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const list = rules ?? []
  const count = list.length

  // §40/§42: one active rule (currentRuleIndex), advanced on a timer — but
  // NEVER for a single rule (no repeated identical transitions, §51).
  const rotating = count > 1
  useEffect(() => {
    if (!rotating) return
    const t = setInterval(() => setIndex((i) => (i + 1) % count), RULE_VISIBLE_MS)
    return () => clearInterval(t)
  }, [rotating, count])

  const current = useMemo(() => list[Math.min(index, Math.max(0, count - 1))] ?? null, [list, index, count])

  return (
    <div
      className="w-full max-w-sm bg-white/5 border border-white/10 rounded-2xl p-4"
      data-testid="how-it-works"
    >
      <div className="flex items-center justify-between mb-2.5">
        <p className="text-white font-semibold text-sm">How it works</p>
        {/* §43: subtle progress dots */}
        {rotating && (
          <div className="flex items-center gap-1.5" aria-label={`Rule ${index + 1} of ${count}`}>
            {list.map((r, i) => (
              <span
                key={r.id}
                className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${
                  i === index ? 'bg-[var(--qk-accent)]' : 'bg-white/20'
                }`}
              />
            ))}
          </div>
        )}
      </div>

      {/* §52/§53: fixed-height stage — different rule lengths never push the
          rest of the screen up and down. Icon + title + one-line description
          are clamped to the reserved area. */}
      <div className="h-[72px] relative">
        <AnimatePresence mode="wait">
          {current && (
            <motion.div
              key={current.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: RULE_TRANSITION_S, ease: 'easeInOut' }}
              className="absolute inset-0 flex items-start gap-3"
            >
              <span className="text-2xl leading-none mt-0.5" aria-hidden>
                {current.icon || '🎲'}
              </span>
              <div className="min-w-0">
                <p className="text-white text-sm font-bold leading-snug">{current.title}</p>
                <p className="text-white/60 text-xs leading-relaxed line-clamp-2 mt-0.5">
                  {current.description}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
