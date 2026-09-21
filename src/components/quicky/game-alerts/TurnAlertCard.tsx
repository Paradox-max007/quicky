'use client'

// Quicky — TURN ALERT CARD (in-game notification layer, mobile/Capacitor)
//
// The generic "your game needs you" card rendered by GameAlertCenter for any
// game registered in turn-alert-sources.ts. Mirrors the Spin the Bottle
// GameDecisionDrawer choreography (slide-down 300ms, swipe-down dismiss,
// compact pill afterwards, per-turn re-arm) — but per the Ludo revision it
// carries TWO explicit buttons:
//
//   · Go to Game — navigates straight back to the live game at the EXACT
//     round (the room runtime never detached; the board re-renders the
//     authoritative turn/dice/tokens).
//   · Dismiss — hides the card for THIS turn (a new turn re-arms it); a slim
//     pill stays available so the player can always jump back.

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useRoundTimer } from '@/hooks/useRoundTimer'
import { hapticNotification } from '@/lib/capacitor'
import type { TurnAlertState } from './turn-alert-sources'

export function TurnAlertCard({
  emoji,
  label,
  state,
}: {
  emoji: string
  label: string
  state: TurnAlertState
}) {
  // §44-analog: dismissed for THIS turnKey — a NEW turn re-shows the card.
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)

  // Stabilize the skew sampler so useRoundTimer's interval is not rebuilt on
  // every snapshot-driven state refresh (the sampler itself always reads the
  // live runtime through the ref).
  const skewFnRef = useRef(state.getSkewMs)
  useEffect(() => {
    skewFnRef.current = state.getSkewMs
  }, [state.getSkewMs])
  const getSkewMs = useCallback(() => skewFnRef.current(), [])

  // Server-authoritative countdown (skew-corrected) — same contract as the
  // round bar / decision drawer timers.
  const { remaining, expired } = useRoundTimer(state.deadlineMs, getSkewMs)
  const secsLeft = Math.max(0, remaining)
  const urgent = secsLeft <= 10

  // One light haptic the FIRST time the card arms for a turn.
  const buzzedKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (buzzedKeyRef.current === state.turnKey) return
    buzzedKeyRef.current = state.turnKey
    void hapticNotification('warning')
  }, [state.turnKey])

  // The turn expired while off-screen (skipped) → no card, no pill; the next
  // turn re-arms everything.
  const dead = expired
  const open = !dead && dismissedKey !== state.turnKey
  const showPill = !dead && !open

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            key={state.turnKey}
            initial={{ y: '-120%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '-120%', opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.55 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 90 || info.velocity.y > 600) setDismissedKey(state.turnKey)
            }}
            className="fixed top-[max(env(safe-area-inset-top),0.5rem)] inset-x-0 z-[226] mx-auto w-[min(94vw,26rem)]"
            role="dialog"
            aria-label={`${label} turn notification`}
            data-testid="game-turn-alert"
            data-game={label}
          >
            <div className="bg-[var(--qk-card)]/95 backdrop-blur border border-white/15 rounded-3xl shadow-2xl p-4 flex items-center gap-3.5">
              <div className="absolute top-1.5 left-1/2 -translate-x-1/2 h-1 w-10 rounded-full bg-white/20" aria-hidden />

              <div className="relative shrink-0">
                <span className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center text-2xl" aria-hidden>
                  {emoji}
                </span>
                {state.deadlineMs != null && (
                  <span
                    className={`absolute -bottom-1.5 -right-1.5 min-w-7 h-7 px-1.5 rounded-full bg-black/85 border ${
                      urgent ? 'border-rose-400/70 text-rose-200' : 'border-white/15'
                    } text-white text-sm font-black flex items-center justify-center tabular-nums`}
                    data-testid="game-turn-countdown"
                  >
                    {secsLeft}
                  </span>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-black tracking-[0.18em] text-[var(--qk-accent)] uppercase">
                  {label} · {state.roundLabel}
                </p>
                <p className="text-white font-black text-base leading-tight">{state.title}</p>
                <p className="text-white/70 text-xs font-semibold mt-0.5 truncate">{state.detail}</p>
              </div>

              <div className="flex flex-col gap-1.5 shrink-0">
                <button
                  onClick={state.goToGame}
                  className="bg-coral-gradient glow-coral rounded-xl px-3.5 py-2 text-xs font-black tracking-wide active:scale-95 transition disabled:opacity-50"
                  aria-label="Go to game"
                  data-testid="game-turn-go"
                >
                  Go to Game
                </button>
                <button
                  onClick={() => setDismissedKey(state.turnKey)}
                  className="bg-white/10 border border-white/15 rounded-xl px-3.5 py-1.5 text-[11px] font-bold text-white/80 active:scale-95 transition"
                  aria-label="Dismiss turn notification"
                  data-testid="game-turn-dismiss"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Compact pill after dismissal — the way back stays one tap away
          while the game keeps running (Spin Bottle decision-pill pattern). */}
      <AnimatePresence>
        {showPill && (
          <motion.button
            key={`pill-${state.turnKey}`}
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            onClick={state.goToGame}
            className="fixed top-[max(env(safe-area-inset-top),0.5rem)] inset-x-0 z-[225] mx-auto w-fit max-w-[94vw] px-4 py-2 rounded-full bg-[var(--qk-card)]/95 border border-white/15 shadow-xl text-xs font-black text-white flex items-center gap-2"
            aria-label={`${label} — your turn${state.deadlineMs != null ? `, ${secsLeft} seconds left` : ''} — go to game`}
            data-testid="game-turn-pill"
          >
            <span className="animate-pulse" aria-hidden>{emoji}</span>
            <span className="truncate">
              {label} — your turn{state.deadlineMs != null ? ` · ${secsLeft}s` : ''}
            </span>
          </motion.button>
        )}
      </AnimatePresence>
    </>
  )
}
