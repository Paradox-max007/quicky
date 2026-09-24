'use client'

// Quicky — REALM CYCLE RESULT (realm PRD §58/§59/§78)
// Shown once per settled cycle: rank, threshold verdict, PROMOTED (with the
// next realm) or "remain", and the granted rewards (already in the
// inventory — the screen only confirms + dismisses). Mounted globally in
// AppRoot whenever an UNSEEN result exists.

import { motion, AnimatePresence } from 'framer-motion'
import { useRealmStore } from '@/store/realm'

export function RealmResult() {
  const pending = useRealmStore((s) => s.snapshot?.pendingResult ?? null)
  const dismiss = useRealmStore((s) => s.dismissResult)

  return (
    <AnimatePresence>
      {pending && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[244] bg-black/70"
          />
          <motion.div
            initial={{ scale: 0.92, opacity: 0, y: 12 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 24 }}
            className="fixed inset-x-0 top-1/2 z-[245] mx-auto w-[min(92vw,25rem)] -translate-y-1/2 rounded-3xl border border-white/10 bg-[var(--qk-card)] text-[var(--qk-text)] p-6 text-center flex flex-col items-center gap-3"
            role="dialog"
            aria-label="Realm cycle result"
            data-testid="realm-result"
          >
            <p className="text-[10px] font-black uppercase tracking-[0.25em] opacity-50">Realm complete</p>
            <p className="text-xl font-black tracking-wide uppercase">{pending.realmName}</p>

            <p className="text-4xl" aria-hidden>
              {pending.rank === 1 ? '🥇' : pending.rank === 2 ? '🥈' : pending.rank === 3 ? '🥉' : '🏁'}
            </p>
            <p className="text-sm font-bold">
              #{pending.rank} in your cohort · {pending.points.toLocaleString()} points
            </p>

            {pending.promoted ? (
              <div className="w-full rounded-2xl px-4 py-3 flex flex-col gap-1" style={{ background: 'color-mix(in srgb, var(--qk-accent) 16%, transparent)' }}>
                <p className="text-[13px] font-black uppercase tracking-wide" style={{ color: 'var(--qk-accent)' }}>
                  🎉 Promoted
                </p>
                <p className="text-[11.5px] font-semibold opacity-80">You finished Top 3 above the {pending.threshold.toLocaleString()}-point threshold.</p>
              </div>
            ) : pending.rank >= 4 ? (
              // Places 4-8 — the "try hard next time" card. Consolation coins
              // (admin-configured per place) are credited at settlement and
              // listed in the rewards block below.
              <div className="w-full rounded-2xl bg-white/5 border border-white/10 px-4 py-3 flex flex-col gap-1">
                <p className="text-[12.5px] font-black uppercase tracking-wide" style={{ color: 'var(--qk-gold)' }}>
                  🏁 Try hard next time
                </p>
                <p className="text-[11.5px] font-semibold opacity-80">
                  You finished #{pending.rank} — the Top 3 took the promotion spots this cycle.
                </p>
                <p className="text-[11px] font-semibold opacity-60">A new cycle in {pending.realmName} starts now — climb back into the Top 3!</p>
              </div>
            ) : (
              <div className="w-full rounded-2xl bg-white/5 border border-white/10 px-4 py-3 flex flex-col gap-1">
                <p className="text-[12.5px] font-bold opacity-85">
                  {pending.points >= pending.threshold
                    ? `You reached the threshold, but finished #${pending.rank}.`
                    : `${(pending.threshold - pending.points).toLocaleString()} points short of the threshold.`}
                </p>
                <p className="text-[11px] font-semibold opacity-60">You remain in {pending.realmName} — the next cycle starts now.</p>
              </div>
            )}

            {pending.rewards.length > 0 && (
              <div className="w-full rounded-2xl bg-white/5 border border-white/10 px-4 py-3 flex flex-col gap-2">
                <p className="text-[10px] font-black uppercase tracking-wider opacity-60">
                  {pending.rank >= 4 ? 'Consolation gift added' : 'Rewards added to your inventory'}
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  {pending.rewards.map((r) => (
                    <span key={r.itemId} className="flex items-center gap-1.5 rounded-full bg-white/5 border border-white/10 px-2.5 py-1 text-[11px] font-bold">
                      <span aria-hidden>{r.emoji}</span>
                      {r.name}
                      <span style={{ color: 'var(--qk-gold)' }}>×{r.quantity}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={() => void dismiss(pending.cycleId)}
              className="mt-1 w-full rounded-2xl py-3 font-black tracking-wide active:scale-[0.98] transition-transform text-[var(--qk-on-accent)]"
              style={{ background: 'var(--qk-accent)' }}
            >
              CONTINUE
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
