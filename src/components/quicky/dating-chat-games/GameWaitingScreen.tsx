'use client'

// Dating Chat Games — Game Waiting Screen (PRD §15, §16, §21, §22)
//
// Generic sender-side waiting state for any dating-chat game that uses the
// persisted-invitation flow (currently Ludo + Truth or Dare). While the
// recipient decides, the sender sees:
//
//   {emoji} {Game Name}
//   Waiting for {partner}…
//   ◌ ◌ ◌
//   Invitation sent successfully
//   Waiting for response...
//
// The screen listens via watchGameInvites and reacts instantly to the
// recipient's PLAY_NOW / NOT_NOW (PRD §16 — no manual refresh).
//
//   • PLAY_NOW  → both sides transition into the game (caller's onAccepted)
//   • NOT_NOW   → caller shows the decline message + Back-to-Chat button
//                 (PRD §22). Caller's onDeclined().
//   • Cancel    → the sender taps "Cancel" → POST /games/invitations/[id]/cancel
//                 → return to chat (PRD §45 — pending invitation remains
//                 server-side; the recipient's popup closes silently).
//   • Timeout   → server sweeps the PENDING to EXPIRED; the next poll
//                 picks it up and shows the "expired" state.

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Dices, Sparkles, X, ArrowLeft } from 'lucide-react'
import { watchGameInvites } from '@/lib/quicky/game-invites'
import { api } from '@/lib/quicky/api-client'
import { getDatingGame } from '@/lib/quicky/dating-games/registry'

export function GameWaitingScreen({
  open,
  partnerName,
  invitationId,
  matchId,
  gameType,
  onCancel,
  onAccepted,
  onDeclined,
}: {
  open: boolean
  partnerName: string | null
  invitationId: string | null
  matchId: string | null
  /** Which game is being waited on — drives the icon + title. */
  gameType: 'ludo' | 'truth_or_dare' | 'never_have_i_ever'
  onCancel: () => void
  onAccepted: () => void
  onDeclined: () => void
}) {
  const [declined, setDeclined] = useState(false)
  const [busy, setBusy] = useState(false)
  // Poll for the invitation status — PRD §16 wants realtime, but a 3s poll
  // is the safety net for missed broadcasts (Supabase realtime drops /
  // backgrounded app / re-login). Cheap call.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Look up the game's display name + emoji from the registry so the
  // waiting screen adapts to whatever game is being proposed.
  const game = getDatingGame(gameType)
  const gameName = game?.name ?? gameType
  const gameEmoji = game?.emoji ?? '🎮'

  // Reset transient state when the screen (re-)opens.
  useEffect(() => {
    if (!open) {
      setDeclined(false)
      setBusy(false)
    }
  }, [open])

  // Realtime listener — instant transition on the recipient's response.
  useEffect(() => {
    if (!open || !matchId) return
    return watchGameInvites(matchId, {
      // The waiting screen only cares about responses to its own invitation.
      onResponse: (res: any) => {
        if (!res || (res.matchId !== matchId && res.invitationId !== invitationId)) return
        if (res.accepted) {
          onAccepted()
        } else {
          setDeclined(true)
          // The decline message shows for a moment; the user dismisses it.
        }
      },
    })
  }, [open, matchId, invitationId, onAccepted])

  // Poll safety net — every 3s, fetch the active invitation for this match
  // and this specific gameType. If it has transitioned out of PENDING,
  // react accordingly.
  useEffect(() => {
    if (!open || !matchId) return
    const check = async () => {
      try {
        const res: any = await api.gameInvitations.activeForMatch(matchId, gameType)
        if (!res?.invitation) {
          // No active invitation — could mean: declined, expired, cancelled,
          // or accepted+completed. If we're not already in a terminal UI
          // state, assume declined/expired (the accept path is handled by
          // the realtime listener, which fires first).
          if (!declined) {
            setDeclined(true)
          }
          return
        }
        if (res.invitation.status === 'ACCEPTED' && !declined) {
          onAccepted()
        }
      } catch {}
    }
    pollRef.current = setInterval(check, 3000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [open, matchId, declined, onAccepted, gameType])

  const cancelInvitation = async () => {
    if (busy || !invitationId) return
    setBusy(true)
    try {
      await api.gameInvitations.cancel(invitationId).catch(() => {})
    } finally {
      setBusy(false)
      onCancel()
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', stiffness: 320, damping: 32 }}
          className="absolute inset-0 z-[150] bg-[var(--qk-bg)] text-[var(--qk-text)] flex flex-col"
        >
          {/* Header — close + cancel */}
          <header className="shrink-0 px-4 pt-3 pb-2 flex items-center justify-between border-b border-white/8">
            <button
              onClick={cancelInvitation}
              disabled={busy}
              className="p-2 rounded-full hover:bg-white/5 text-[var(--qk-text)]/60 disabled:opacity-50"
              aria-label="Cancel invitation"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h2 className="font-bold text-base">{gameName}</h2>
            <div className="w-9 h-9" />
          </header>

          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
            {!declined ? (
              <>
                {/* Game icon — uses the registry emoji for the active game.
                    For Ludo we keep the Dices lucide icon (matches the
                    LudoGame overlay); for ToD and others we use the emoji
                    glyph + the Sparkles accent. */}
                <div className="w-20 h-20 rounded-3xl bg-[var(--qk-accent)]/15 border border-[var(--qk-accent)]/30 flex items-center justify-center">
                  {gameType === 'ludo' ? (
                    <Dices className="w-10 h-10 text-[var(--qk-accent)]" />
                  ) : (
                    <Sparkles className="w-10 h-10 text-[var(--qk-accent)]" />
                  )}
                </div>

                {/* "Waiting for {partner}…" */}
                <h3 className="text-xl font-bold mt-2">
                  Waiting for {partnerName ?? 'them'}…
                </h3>

                {/* Loading dots */}
                <div className="flex gap-2">
                  {[0, 1, 2].map((i) => (
                    <motion.span
                      key={i}
                      className="w-2 h-2 rounded-full bg-[var(--qk-accent)]"
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.2 }}
                    />
                  ))}
                </div>

                {/* Status text */}
                <div className="mt-4 flex flex-col items-center gap-1">
                  <p className="text-sm text-[var(--qk-text)]/60 font-medium">
                    Invitation sent successfully
                  </p>
                  <p className="text-xs text-[var(--qk-text)]/40">
                    Waiting for response…
                  </p>
                </div>

                {/* Game-emoji hint — small visual reminder of which game
                    is being proposed (helps when the user has multiple
                    pending invites in their head). */}
                <p className="text-[11px] text-[var(--qk-text)]/35 mt-1">
                  {gameEmoji} {gameName}
                </p>

                {/* Cancel button — PRD §45: pending invitation remains
                    server-side even after cancel; the recipient's popup
                    closes silently. */}
                <button
                  onClick={cancelInvitation}
                  disabled={busy}
                  className="mt-6 px-5 py-2.5 rounded-2xl bg-white/8 hover:bg-white/12
                            border border-white/10 text-[var(--qk-text)]/70 font-medium text-sm
                            active:scale-95 transition-all disabled:opacity-50"
                >
                  {busy ? 'Cancelling…' : 'Cancel invitation'}
                </button>
              </>
            ) : (
              <>
                {/* Decline state (PRD §22) */}
                <div className="w-20 h-20 rounded-3xl bg-[var(--qk-purple)]/15 border border-[var(--qk-purple)]/30 flex items-center justify-center">
                  <X className="w-10 h-10 text-[var(--qk-purple)]" />
                </div>

                <h3 className="text-xl font-bold mt-2 max-w-xs">
                  {partnerName ?? 'They'} isn't in the mood for a game right now.
                </h3>
                <p className="text-sm text-[var(--qk-text)]/60">Invite them later.</p>

                <button
                  onClick={onDeclined}
                  className="mt-6 px-6 py-3 rounded-2xl
                            bg-gradient-to-r from-[var(--qk-accent)] to-[var(--qk-accent-light)]
                            text-[var(--qk-on-accent)] font-bold text-sm
                            shadow-[0_6px_20px_-6px_var(--qk-accent)]
                            active:scale-95 transition-all"
                >
                  Back to Chat
                </button>
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
