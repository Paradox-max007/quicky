'use client'

// Quicky — OFF-SCREEN GAME DECISION + RESULT DRAWERS (bug-fix PRD §21-§28,
// §39-§41, §95-§98, §115 — notification-policy revision)
//
// PLATFORM RULE (revised): the decision/result overlays are MOBILE-SURFACE
// overlays — the Capacitor app AND the mobile web view (<1024px). The
// ≥1024px desktop shell never mounts them (the table stays visible beside
// the chat panels, so an overlay has no job there).
//
// MOBILE (Capacitor or mobile web): whenever
//   user is in an active room AND is a round participant (TARGET or
//   SPINNER — both answer in the two-party round)
//   AND round status = awaiting AND user is NOT on the game table screen
// → the decision drawer slides down over WHATEVER screen the user is on
//   (game chat, contacts, profile, community — anywhere: the room runtime
//   never detached) with the OTHER person's identity (the target if I spun,
//   the spinner if I was selected — never my own profile), the
//   server-derived countdown (§42/§85 — never a local 10s tick) and the
//   SAME Kiss / No Thanks action the table uses (§38/§107/§110). It re-arms
//   EVERY round (§23) and every selection (§106), can be swiped away
//   (§27 — timer keeps running) and reopened from the "Your turn • Ns" pill
//   (§28). When the round resolves, the RESULT replaces the decision inside
//   the same popup system (§39/§96) for its own RESULT_VIEW_MS duration
//   (§98 — NOT the decision timer) and NEVER navigates the user (§40).
//
// NOTIFICATION POLICY: this is GAMEPLAY — it is not gated by the
// "In-game Notifications" toggle (that switch affects personal-message
// modals only). The drawer opens EVERY time the user is selected.

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuickyStore } from '@/store/quicky'
import { useGameRoomStore } from '@/store/game-room'
import { useRoundTimer } from '@/hooks/useRoundTimer'
import { useIsDesktopShell } from '@/hooks/useIsDesktopShell'
import { toast } from 'sonner'

// Result reveal duration (§98): same pacing as the table's duel result —
// reuse ONE constant instead of inventing a second timer.
const RESULT_VIEW_MS = 2600

export function GameDecisionDrawer() {
  const view = useQuickyStore((s) => s.view)
  const snapshot = useGameRoomStore((s) => s.snapshot)
  const closure = useGameRoomStore((s) => s.closure)
  const optimistic = useGameRoomStore((s) => s.optimistic)
  const getSkew = useGameRoomStore((s) => s.getSkew)
  const isDeskShell = useIsDesktopShell()

  const spin = snapshot?.currentSpin
  // Mobile surface: Capacitor app or mobile web view. Desktop shell never
  // mounts the overlay logic — the table is always visible there.
  const mobileSurface = isDeskShell !== true
  // The table screen has its own inline duel UI — the drawer covers every
  // OTHER screen ("all the time the user is selected").
  const offTable = view !== 'spin-bottle-room'

  // ── Off-table participation snapshot (shared by decision + result) ──────
  const iAmParticipant = !!(snapshot?.iAmTarget || snapshot?.iAmSpinner)

  // §23/§106: arm on the PARTICIPANT/STATUS TRANSITION, not on every
  // snapshot change — a new round re-opens the drawer automatically.
  // BOTH parties answer in the two-party round (§3/§27/§28): the drawer
  // arms for the target AND for the spinner.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const decision = useMemo(() => {
    if (!offTable || !snapshot || !spin || closure) return null
    if (spin.status !== 'awaiting' || !iAmParticipant) return null
    if (optimistic && optimistic.spinId === spin.id) {
      // §39/§41: answered — show the selected state briefly, then rely on
      // the round completing (drawer disappears when status leaves awaiting)
      return { spin, selected: optimistic.choice as string }
    }
    return { spin, selected: null }

  }, [offTable, snapshot, closure, optimistic, spin?.id, spin?.status, iAmParticipant])

  const decisionSpinId = decision?.spin.id ?? null
  // §44/§45: manually dismissed for THIS spin — never auto-reopen (§105)
  const [dismissedSpinId, setDismissedSpinId] = useState<string | null>(null)
  // §104: open on the PARTICIPANT TRANSITION, not on every snapshot change
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
  // useRoundTimer returns SECONDS — divide-by-1000 here used to collapse the
  // badge to a permanent "1". Same interpretation as SpinBottleRoom's timer.
  const secsLeft = Math.max(0, remaining)
  const expired = deadlineMs !== null && remaining <= 0

  // §115: stale-decision guard — every field must still match the live
  // snapshot before the drawer renders (roundId/target/status/deadline are
  // all derived from THIS snapshot, so a stale push can never draw).
  const open = !!decision && !expired && mobileSurface && dismissedSpinId !== decisionSpinId
  const showPill = !!decision && !expired && mobileSurface && !open

  // ── Result drawer state (§39/§96): awaiting → completed while off-table ─
  const [resultSpin, setResultSpin] = useState<{
    id: string
    result: string | null
    spinnerId: string
    targetId: string | null
    spinnerResponse: string | null
    targetResponse: string | null
  } | null>(null)
  const prevRoundRef = useRef<{ id: string; status: string } | null>(null)
  useEffect(() => {
    const cur = spin ? { id: spin.id, status: spin.status } : null
    const prev = prevRoundRef.current
    prevRoundRef.current = cur
    if (!cur || !prev) return
    // Round I took part in just resolved while I'm OFF the table →
    // surface the result drawer immediately (§37/§96/§97).
    if (
      mobileSurface &&
      offTable &&
      prev.id === cur.id &&
      prev.status === 'awaiting' &&
      cur.status === 'completed' &&
      iAmParticipant
    ) {
      const s = spin!
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResultSpin({
        id: s.id,
        result: s.result,
        spinnerId: s.spinnerId,
        targetId: s.targetId,
        spinnerResponse: s.spinnerResponse,
        targetResponse: s.targetResponse,
      })
    }

  }, [spin?.id, spin?.status, mobileSurface, offTable, iAmParticipant])

  // §98: the result has its OWN duration — never the decision countdown.
  useEffect(() => {
    if (!resultSpin) return
    const t = setTimeout(() => setResultSpin(null), RESULT_VIEW_MS)
    return () => clearTimeout(t)
  }, [resultSpin])

  // Subtle result toast (§49): desktop's off-table surface (§41) — and
  // mobile users see it too when the result drawer was already dismissed.
  const prevStatusRef = useRef<string | null>(null)
  useEffect(() => {
    const status = spin?.status ?? null
    const prev = prevStatusRef.current
    prevStatusRef.current = status
    if (
      offTable &&
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
  }, [spin?.status, spin?.result, offTable, snapshot, spin])

  const respond = (choice: 'yes' | 'no') => {
    // §38/§107/§110: the EXACT same shared action the table uses — it
    // accepts the spinner's answer and the target's answer alike.
    useGameRoomStore.getState().respond(choice)
  }

  // ── The OTHER person (§36/§37 revised): the target if I spun, the
  // spinner if I was selected — never my own profile.
  const iAmTarget = !!snapshot?.iAmTarget
  const otherPlayer = useMemo(
    () =>
      snapshot?.players.find((p) => p.userId === (iAmTarget ? spin?.spinnerId : spin?.targetId)) ?? null,
    [snapshot, iAmTarget, spin?.spinnerId, spin?.targetId]
  )
  // Role line: who did what to whom — one compact sentence.
  const roleLine = iAmTarget
    ? `${otherPlayer?.displayName ?? 'Someone'} spun for you`
    : `You spun — ${otherPlayer?.displayName ?? 'someone'} was selected`

  // ── DESKTOP (§24): no overlay logic mounts at all — the completion toast
  // above is the only off-table surface. This keeps the desktop DOM clean.
  if (!mobileSurface) return null

  // ── MOBILE (Capacitor + mobile web): decision drawer + pill + result ──
  const resultVisual = (() => {
    if (resultSpin?.result === 'mutual_kiss') return { emoji: '❤️', title: 'MUTUAL KISS', cls: 'mutual' }
    if (resultSpin?.result === 'partial_kiss') return { emoji: '💋', title: 'PARTIAL KISS', cls: 'partial' }
    if (resultSpin?.result === 'full_rejection') return { emoji: '💔', title: 'FULL REJECTION', cls: 'reject' }
    return { emoji: '⏳', title: "Time's up", cls: 'reject' }
  })()

  return (
    <>
      <AnimatePresence>
        {open && decision && (
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

              {/* §36/§37 revised: the OTHER person's image + name — the
                  target if I spun, the spinner if I was selected. */}
              <div className="relative shrink-0">
                {otherPlayer?.avatar ? (
                  <img src={otherPlayer.avatar} alt="" className="w-16 h-16 rounded-2xl object-cover" />
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
                <p className="text-white font-black text-base leading-tight truncate">{otherPlayer?.displayName ?? 'Someone'}</p>
                <p className="text-white/60 text-xs font-semibold mt-0.5 truncate">{roleLine}</p>
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
        {showPill && decision && (
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

      {/* §39/§96: GAME RESULT drawer — same popup system as the decision,
          shown IMMEDIATELY when the round resolves (both answered or timeout,
          §97/§139/§140). The user stays exactly where they are (§40). */}
      <AnimatePresence>
        {resultSpin && (
          <motion.div
            key={`result-${resultSpin.id}`}
            initial={{ y: '-120%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '-120%', opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="fixed top-[max(env(safe-area-inset-top),0.5rem)] inset-x-0 z-[231] mx-auto w-[min(94vw,26rem)]"
            role="dialog"
            aria-label="Round result"
            data-testid="game-result-drawer"
          >
            <div className="bg-[var(--qk-card)]/95 backdrop-blur border border-white/15 rounded-3xl shadow-2xl p-5 flex flex-col items-center text-center gap-2">
              <div className="absolute top-1.5 left-1/2 -translate-x-1/2 h-1 w-10 rounded-full bg-white/20" aria-hidden />
              <p className="text-[10px] font-black tracking-[0.18em] text-[var(--qk-accent)] uppercase">Game result</p>
              <motion.span
                className={`text-5xl ${resultVisual.cls === 'reject' ? '' : ''}`}
                initial={{ scale: 0, rotate: -30 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 380, damping: 16 }}
                aria-hidden
              >
                {resultVisual.emoji}
              </motion.span>
              <p className="text-white font-black text-lg tracking-wide">{resultVisual.title}</p>
              {resultSpin.result === 'mutual_kiss' && (
                <p className="text-white/70 text-xs font-bold">+1 Game Point each</p>
              )}
              {resultSpin.result === 'partial_kiss' && (
                <p className="text-white/70 text-xs font-bold">
                  +1 Game Point →{' '}
                  {resultSpin.spinnerResponse === 'yes'
                    ? snapshot?.players.find((p) => p.userId === resultSpin.targetId)?.displayName ?? 'them'
                    : snapshot?.players.find((p) => p.userId === resultSpin.spinnerId)?.displayName ?? 'them'}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
