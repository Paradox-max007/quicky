'use client'

// Dating Chat Games — Mandatory Game Invitation Popup (PRD §11, §12, §13, §55)
//
// Replaces the legacy GameInvitePopup for the new dating-chat games flow.
// The legacy popup was dismissible (drag / tap-outside / 30s auto-dismiss);
// the PRD requires the new popup to be MANDATORY and NON-DISMISSIBLE — the
// recipient MUST explicitly choose PLAY NOW or NOT NOW before it closes
// (PRD §12). The invitation persists across navigation, screen switches,
// incoming messages, and timeouts (PRD §13).
//
// Implementation:
//   • Full-screen backdrop (no click-through; tapping the backdrop does
//     nothing — only the two buttons close the popup).
//   • No drag-to-dismiss, no Escape key, no auto-timeout.
//   • On app mount, fetches GET /api/quicky/games/invitations (no matchId
//     → returns ALL PENDING invitations where I am the recipient) so the
//     popup re-arms if the user closed the app mid-invite (PRD §13).
//   • Subscribes to the realtime broadcast (notifyGameInvite) so the popup
//     appears instantly when a new invitation arrives (PRD §10).
//   • When the recipient chooses:
//       - PLAY NOW → POST /games/invitations/[id]/accept → open the chat +
//         set the sessionStorage pending-game handshake so ChatView auto-
//         opens Ludo.
//       - NOT NOW → POST /games/invitations/[id]/decline → close the popup.
//   • When the sender cancels (cancelled: true), the popup closes silently.
//
// NOTE: only Ludo invitations are sent today (the registry hides ToD and
// marks NHIE as COMING_SOON — neither sends an invitation). The popup
// still handles any gameType the server sends, defensively.

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuickyStore } from '@/store/quicky'
import { api } from '@/lib/quicky/api-client'
import { watchGameInvites, GameInvitePayload } from '@/lib/quicky/game-invites'
import { datingGameLabel } from '@/lib/quicky/dating-games/registry'

type ActiveInvite = {
  invitationId: string
  matchId: string
  gameType: string
  fromId: string
  fromName: string
}

export function DatingGameInvitePopup() {
  const user = useQuickyStore((s) => s.user)
  const [invite, setInvite] = useState<ActiveInvite | null>(null)
  const [busy, setBusy] = useState(false)
  const hydratedRef = useRef(false)

  // ── On mount / login: fetch any PENDING invitations addressed to me.
  // PRD §13 — the invitation persists across app sessions. If I closed the
  // app mid-invite, the popup re-arms the moment I open it again.
  useEffect(() => {
    if (!user?.id) {
      setInvite(null)
      hydratedRef.current = false
      return
    }
    if (hydratedRef.current) return
    hydratedRef.current = true
    api.gameInvitations
      .listActive()
      .then((res: any) => {
        if (res?.invitations?.length > 0) {
          const inv = res.invitations[0]
          // Re-arm the popup from the persisted row. The sender name may have
          // been lost if the realtime broadcast was missed — fetch the
          // partner's name from the match. For now we use a generic label
          // if we cannot resolve it; the partner's name is also carried by
          // the realtime payload and will overwrite this on the next invite.
          setInvite({
            invitationId: inv.id,
            matchId: inv.matchId,
            gameType: inv.gameType,
            fromId: inv.senderId,
            fromName: 'Someone',
          })
        }
      })
      .catch(() => {})
  }, [user?.id])

  // ── Realtime: a new invitation arrives the moment the sender taps Play.
  useEffect(() => {
    if (!user?.id) return
    return watchGameInvites(user.id, {
      onInvite: (inv: GameInvitePayload) => {
        if (!inv?.matchId || !inv?.gameType) return
        if (inv.fromId === user.id) return
        if (!inv.invitationId) {
          // Legacy invite without a persisted row (ToD/NHIE — both removed
          // from the menu today, but a stale client could still fire one).
          // Skip — those games no longer have an invitation flow.
          return
        }
        setInvite({
          invitationId: inv.invitationId,
          matchId: inv.matchId,
          gameType: inv.gameType,
          fromId: inv.fromId,
          fromName: inv.fromName ?? 'Someone',
        })
        // Haptic feedback (no-op on web) — Capacitor native only.
        import('@capacitor/haptics')
          .then(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Medium }))
          .catch(() => {})
      },
      onResponse: (res: any) => {
        // PRD §14 — sender-cancelled invitations close the popup silently
        // (no PLAY_NOW / NOT_NOW choice to make anymore).
        if (res?.cancelled && invite?.invitationId === res.invitationId) {
          setInvite(null)
        }
      },
    })
  }, [user?.id, invite?.invitationId])

  // ── Escape key — explicitly NOT bound (PRD §12: cannot be dismissed
  // except via PLAY NOW / NOT NOW).
  useEffect(() => {
    if (!invite) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Swallow — popup is mandatory.
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [invite])

  const respond = async (accepted: boolean) => {
    if (!invite || busy) return
    setBusy(true)
    const inv = invite
    try {
      if (accepted) {
        await api.gameInvitations.accept(inv.invitationId)
        // Set the pending-game handshake so ChatView auto-opens Ludo.
        try {
          sessionStorage.setItem(`qk_pending_game_${inv.matchId}`, inv.gameType)
        } catch {}
        // Jump into the chat; the game opens from there via the
        // sessionStorage handshake (same pattern as the legacy popup).
        useQuickyStore.getState().openChat(inv.matchId)
      } else {
        await api.gameInvitations.decline(inv.invitationId)
      }
      setInvite(null)
    } catch (e: any) {
      // The invitation may have expired / been cancelled concurrently.
      // Close the popup either way — the user has made their choice.
      setInvite(null)
    } finally {
      setBusy(false)
    }
  }

  const gameLabel = datingGameLabel(invite?.gameType ?? '')

  return (
    <AnimatePresence>
      {invite && (
        <>
          {/* Full-screen backdrop — tap does nothing (PRD §12). */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[220] bg-black/70 backdrop-blur-sm"
            // Intentionally NO onClick — the popup is mandatory.
          />

          {/* Centered invitation card — no drag, no swipe, no auto-dismiss. */}
          <motion.div
            initial={{ y: 24, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 24, opacity: 0, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="fixed inset-0 z-[230] flex items-center justify-center p-4 pointer-events-none"
          >
            <div className="pointer-events-auto w-[min(94vw,32rem)] rounded-3xl overflow-hidden
                            bg-gradient-to-br from-[var(--qk-card)] to-[var(--qk-elev)]
                            border border-[var(--qk-accent)]/30
                            shadow-2xl">
              {/* Top accent bar */}
              <div className="h-1.5 w-full bg-gradient-to-r from-[var(--qk-accent)] via-[var(--qk-purple)] to-[var(--qk-accent-light)]" />

              <div className="px-6 pt-6 pb-5 flex flex-col items-center text-center">
                {/* Game icon */}
                <div className="w-16 h-16 rounded-3xl bg-[var(--qk-accent)]/15 border border-[var(--qk-accent)]/30 flex items-center justify-center mb-3">
                  <span className="text-3xl">{invite.gameType === 'ludo' ? '🎲' : '🎮'}</span>
                </div>

                {/* Title */}
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--qk-accent-light)] mb-1">
                  Game Invitation
                </p>

                {/* Body */}
                <p className="text-base font-semibold text-[var(--qk-text)] mt-1">
                  <span className="text-[var(--qk-accent)]">{invite.fromName}</span> sent you a{' '}
                  {gameLabel} invitation.
                </p>

                {/* Mandatory-choice hint (PRD §12) */}
                <p className="text-[11px] text-[var(--qk-text)]/45 mt-2">
                  Choose an option to continue.
                </p>

                {/* Buttons — PLAY NOW / NOT NOW. The ONLY way to close. */}
                <div className="grid grid-cols-2 gap-3 w-full mt-5">
                  <button
                    onClick={() => respond(false)}
                    disabled={busy}
                    className="py-3 rounded-2xl bg-white/8 hover:bg-white/12
                              border border-white/10
                              text-[var(--qk-text)]/80 font-semibold text-sm
                              active:scale-95 transition-all
                              disabled:opacity-50"
                  >
                    Not Now
                  </button>
                  <button
                    onClick={() => respond(true)}
                    disabled={busy}
                    className="py-3 rounded-2xl
                              bg-gradient-to-r from-[var(--qk-accent)] to-[var(--qk-accent-light)]
                              text-[var(--qk-on-accent)] font-bold text-sm
                              shadow-[0_6px_20px_-6px_var(--qk-accent)]
                              active:scale-95 transition-all
                              disabled:opacity-50"
                  >
                    {busy ? '…' : 'Play Now'}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
