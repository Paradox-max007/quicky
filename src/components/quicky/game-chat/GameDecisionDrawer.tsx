'use client'

// Quicky — OFF-SCREEN GAME DECISION DRAWER (game-chat PRD §34-§53/§82-§86/§104-§106)
//
// The flagship of this phase: the user is chatting (or browsing a profile /
// the chat list) while the Spin the Bottle round selects them as TARGET.
// The server state is authoritative:
//
//   is in active game room  AND  currentSpin.targetId === me
//   AND  status === 'awaiting'  AND  NOT on the game table screen
//
// → a temporary drawer slides down OVER the current game-section screen
// showing the SPINNER's identity (§37), the server-derived countdown (§42/
// §85 — never a local 10s tick) and the SAME Kiss / No Thanks action the
// table uses (§38/§107/§110 — one respond API, one optimistic model).
//
// The drawer can be swiped away (§44) — the TIMER KEEPS RUNNING (§43) — and
// reopened from a compact "Your turn — Ns" pill (§46). It never reopens on
// unrelated state updates (§105), resets per round (§106), disappears at
// zero (§47), and NEVER appears outside the game section (§53).

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuickyStore } from '@/store/quicky'
import { useGameRoomStore } from '@/store/game-room'
import { useRoundTimer } from '@/hooks/useRoundTimer'
import { toast } from 'sonner'

export function GameDecisionDrawer() {
  const view = useQuickyStore((s) => s.view)
  const profileReturnView = useQuickyStore((s) => s.profileReturnView)
  const snapshot = useGameRoomStore((s) => s.snapshot)
  const closure = useGameRoomStore((s) => s.closure)
  const optimistic = useGameRoomStore((s) => s.optimistic)
  const getSkew = useGameRoomStore((s) => s.getSkew)

  const spin = snapshot?.currentSpin
  // §53/§54: game-section screens only — the table (spin-bottle-room) has
  // its own inline duel UI; Dating Chat / Settings / Community never see it.
  const onGameSectionView =
    view === 'spin-bottle' || view === 'game-chat' || (view === 'profile-view' && profileReturnView === 'spin-bottle-room')

  const decision = useMemo(() => {
    if (!onGameSectionView || !snapshot || !spin || closure) return null
    if (spin.status !== 'awaiting' || !snapshot.iAmTarget) return null
    if (optimistic && optimistic.spinId === spin.id) {
      // §39/§41: answered — show the selected state briefly, then rely on
      // the round completing (drawer disappears when status leaves awaiting)
      return { spin, selected: optimistic.choice as string }
    }
    return { spin, selected: null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onGameSectionView, snapshot, closure, optimistic, spin?.id, spin?.status, snapshot?.iAmTarget])

  const decisionSpinId = decision?.spin.id ?? null
  // §44/§45: manually dismissed for THIS spin — never auto-reopen (§105)
  const [dismissedSpinId, setDismissedSpinId] = useState<string | null>(null)
  // §104: open on the TARGET TRANSITION, not on every snapshot change
  const openedSpinRef = useRef<string | null>(null)

  useEffect(() => {
    if (!decisionSpinId) {
      // §106: round ended → state resets; the next selection opens anew
      openedSpinRef.current = null
    }
  }, [decisionSpinId])

  // Server-authoritative countdown (§42/§85): derived from responseDeadline
  // through the shared runtime's clock skew — identical source as the table.
  const deadlineMs =
    decision && decision.spin.responseDeadline
      ? new Date(decision.spin.responseDeadline).getTime()
      : null
  const { remaining } = useRoundTimer(deadlineMs, getSkew)
  const secsLeft = Math.max(0, Math.ceil(remaining / 1000))
  const expired = deadlineMs !== null && remaining <= 0

  const open = !!decision && !expired && dismissedSpinId !== decisionSpinId
  const showPill = !!decision && !expired && !open

  // Subtle result toast (§49): the chat stays put; the outcome surfaces as a
  // gentle notification when a round I participated in completes.
  const prevStatusRef = useRef<string | null>(null)
  useEffect(() => {
    const status = spin?.status ?? null
    const prev = prevStatusRef.current
    prevStatusRef.current = status
    if (
      onGameSectionView &&
      snapshot &&
      prev === 'awaiting' &&
      status === 'completed' &&
      spin?.result &&
      (snapshot.iAmTarget || snapshot.iAmSpinner)
    ) {
      const label =
        spin.result === 'mutual_kiss'
          ? '❤️ Mutual kiss!'
          : spin.result === 'partial_kiss'
            ? '💋 Partial kiss'
            : spin.result === 'full_rejection'
              ? '💔 Full rejection'
              : null
      if (label) toast(label)
    }
  }, [spin?.status, spin?.result, onGameSectionView, snapshot, spin])

  const respond = (choice: 'yes' | 'no') => {
    // §38/§107/§110: the EXACT same shared action the table uses.
    useGameRoomStore.getState().respond(choice)
  }

  const spinner = useMemo(
    () => snapshot?.players.find((p) => p.userId === spin?.spinnerId) ?? null,
    [snapshot, spin?.spinnerId]
  )

  if (!decision || expired) {
    return showPill ? null : null
  }

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            key={decision.spin.id}
            // §83: slide-down 250–350ms; §44/§84: drag down to dismiss with a
            // threshold — below it, snap back.
            initial={{ y: '-120%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '-120%', opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.55 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 90 || info.velocity.y > 600) setDismissedSpinId(decision.spin.id)
            }}
            className="fixed top-[max(env(safe-area-inset-top),0.5rem)] inset-x-0 z-[230] mx-auto w-[min(94vw,26rem)]"
            role="dialog"
            aria-label="Round decision"
            data-testid="game-decision-drawer"
          >
            <div className="bg-[var(--qk-card)]/95 backdrop-blur border border-white/15 rounded-3xl shadow-2xl p-4 flex items-center gap-3.5">
              {/* drag hint */}
              <div className="absolute top-1.5 left-1/2 -translate-x-1/2 h-1 w-10 rounded-full bg-white/20" aria-hidden />

              {/* §36/§37: the SPINNER's image + name — never my own profile */}
              <div className="relative shrink-0">
                {spinner?.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={spinner.avatar} alt="" className="w-16 h-16 rounded-2xl object-cover" />
                ) : (
                  <span className="w-16 h-16 rounded-2xl bg-white/10 flex items-center justify-center text-2xl" aria-hidden>
                    🍾
                  </span>
                )}
                {/* §42: server-derived countdown — hard stop at 0 (§47) */}
                <span className="absolute -bottom-1.5 -right-1.5 min-w-7 h-7 px-1.5 rounded-full bg-black/85 border border-white/15 text-white text-sm font-black flex items-center justify-center tabular-nums" data-testid="decision-countdown">
                  {secsLeft}
                </span>
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-black tracking-[0.18em] text-[var(--qk-accent)] uppercase">Your turn</p>
                <p className="text-white font-black text-base leading-tight truncate">{spinner?.displayName ?? 'Someone'}</p>
                {decision.selected ? (
                  // §39: the choice is locked — disable both options (§41)
                  <p className="text-emerald-300 text-xs font-bold mt-1" data-testid="decision-locked">
                    {decision.selected === 'yes' ? '❤️ Kiss selected' : '💔 No Thanks selected'}
                  </p>
                ) : (
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={() => respond('yes')}
                      disabled={!!decision.selected}
                      className="bg-coral-gradient glow-coral rounded-xl px-4 py-2 text-xs font-black tracking-wide active:scale-95 transition disabled:opacity-50"
                      aria-label="Kiss"
                      data-testid="decision-kiss"
                    >
                      ❤️ Kiss
                    </button>
                    <button
                      onClick={() => respond('no')}
                      disabled={!!decision.selected}
                      className="bg-white/10 border border-white/15 rounded-xl px-4 py-2 text-xs font-black tracking-wide active:scale-95 transition disabled:opacity-50"
                      aria-label="No Thanks"
                      data-testid="decision-no"
                    >
                      💔 No Thanks
                    </button>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* §46: compact decision pill while the drawer is dismissed — tapping
          reopens; prevents losing the decision by swiping away */}
      <AnimatePresence>
        {showPill && (
          <motion.button
            key={`pill-${decision.spin.id}`}
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            onClick={() => setDismissedSpinId(null)}
            className="fixed top-[max(env(safe-area-inset-top),0.5rem)] inset-x-0 z-[229] mx-auto w-fit px-4 py-2 rounded-full bg-[var(--qk-card)]/95 border border-white/15 shadow-xl text-xs font-black text-white flex items-center gap-2"
            aria-label={`Your turn — ${secsLeft} seconds left — reopen decision`}
            data-testid="decision-pill"
          >
            <span className="animate-pulse" aria-hidden>❤️</span>
            Your turn — {secsLeft}s
          </motion.button>
        )}
      </AnimatePresence>
    </>
  )
}
