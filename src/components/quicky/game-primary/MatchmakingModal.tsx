'use client'

// Quicky — MATCHMAKING MODAL (Unified Game Primary Screen PRD §7/§8/§14/§16)
//
// THE ONE matchmaking modal for EVERY game. Spin the Bottle used it first;
// Ludo now opens the very same modal while the server checks table
// availability (v3 PRD §7/§8 → Unified §revised: the same join flow for all
// games — only the status copy differs per game).
//
// Real profile photo, live DB stat chips, slow rotating status text (one
// message every ~1.7s with a ~0.5s fade) and an animated progress bar that
// fills to 94% and holds. The join request runs underneath — on success the
// caller navigates into the game room; on cancel they stay here (and the
// caller is responsible for leaving any in-flight room).

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// v3 §10 — bigger pool, sequentially cycled.
const DEFAULT_MESSAGES = [
  'Getting the table ready…',
  'Finding your room…',
  'Looking for players…',
  'Checking the table…',
  'Setting the mood…',
  'Finding your game…',
  'Mixing the room…',
  'Preparing the seats…',
  'Almost ready…',
  'The table is waiting…',
]
// v3 §9 — one message every ~1.7s with a ~0.5s fade (AnimatePresence "wait").
const MSG_VISIBLE_MS = 1700

export function MatchmakingModal({
  open,
  userName,
  userAvatar,
  level,
  messages,
  onCancel,
}: {
  open: boolean
  userName?: string | null
  userAvatar?: string | null
  level?: number
  /** Game-flavored status copy — defaults fit every table game. */
  messages?: string[]
  onCancel: () => void
}) {
  const pool = messages && messages.length > 0 ? messages : DEFAULT_MESSAGES
  const [messageIdx, setMessageIdx] = useState(0)

  // Slow, deliberate rotation (§8-§11) — ONLY while the modal is open.
  useEffect(() => {
    if (!open) return
    // Deferred reset (react-hooks v6: no synchronous setState in effects).
    const r = setTimeout(() => setMessageIdx(0), 0)
    const t = setInterval(() => setMessageIdx((i) => (i + 1) % pool.length), MSG_VISIBLE_MS)
    return () => {
      clearTimeout(r)
      clearInterval(t)
    }
  }, [open, pool.length])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="matchmaking-modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
          data-testid="matchmaking-modal"
        >
          <motion.div
            initial={{ scale: 0.94, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.94, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="w-full max-w-sm bg-[var(--qk-card)] border border-white/10 rounded-3xl p-7 flex flex-col items-center text-center shadow-2xl"
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 220, damping: 18 }}
              className="w-20 h-20 rounded-3xl overflow-hidden border-2 border-[var(--qk-accent)]/60 bg-gradient-to-br from-[var(--qk-accent)] to-[var(--qk-purple)] flex items-center justify-center glow-coral"
            >
              {userAvatar ? (
                <img src={userAvatar} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-3xl font-black text-white">
                  {(userName ?? '?').slice(0, 1).toUpperCase()}
                </span>
              )}
            </motion.div>
            <h2 className="text-xl font-black mt-3">{userName ?? 'You'}</h2>
            <p className="text-xs text-white/50 mt-0.5">Level {level ?? 1}</p>

            {/* One message at a time (§11), ~1.7s visible + ~0.5s fade (§9) */}
            <div className="h-6 flex items-center justify-center mt-4">
              <AnimatePresence mode="wait">
                <motion.p
                  key={messageIdx}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.5, ease: 'easeInOut' }}
                  className="text-sm text-white/75 font-medium"
                >
                  {pool[messageIdx]}
                </motion.p>
              </AnimatePresence>
            </div>

            {/* Animated progress bar — fills to 94% and holds while joining */}
            <div className="w-48 h-1.5 rounded-full bg-white/10 overflow-hidden mt-2" data-testid="matchmaking-progress">
              <motion.div
                className="h-full bg-coral-gradient"
                initial={{ width: '0%' }}
                animate={{ width: ['0%', '94%'] }}
                transition={{ duration: 12, ease: 'easeInOut' }}
              />
            </div>

            <button
              onClick={onCancel}
              className="mt-4 text-sm font-semibold text-white/60 hover:text-white px-6 py-2.5 rounded-full border border-white/10 hover:border-white/25 transition-colors"
              data-testid="matchmaking-cancel"
            >
              Cancel
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
