'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuickyStore } from '@/store/quicky'
import { watchGameInvites, GameInvitePayload, gameLabel } from '@/lib/quicky/game-invites'
import { watchOnline } from '@/lib/quicky/realtime'
import { motion, AnimatePresence } from 'framer-motion'
import { Gamepad2, X, Check } from 'lucide-react'

// Global in-app game invitation popup (mounted once in AppRoot).
// The receiver sees it anywhere in the app — not just on the chat screen —
// and can Join (opens the chat + the game) or Cancel (notifies the sender).

export type PendingInvite = GameInvitePayload

let push: ((inv: PendingInvite) => void) | null = null

/** Fire this from anywhere (e.g. the sender's chat screen) to show the popup. */
export function showGameInvite(inv: PendingInvite) {
  push?.(inv)
}

export function GameInvitePopup() {
  const user = useQuickyStore((s) => s.user)
  const [invite, setInvite] = useState<PendingInvite | null>(null)
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set())
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inviteRef = useRef<PendingInvite | null>(null)
  inviteRef.current = invite

  // Register the imperative entry point for same-device invites/tests
  useEffect(() => {
    push = (inv) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      setInvite(inv)
      // Auto-dismiss after 30 s — a stale invite is worse than none
      timerRef.current = setTimeout(() => setInvite(null), 30000)
    }
    return () => {
      push = null
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  // Track who's online so the popup can hint whether the partner is live
  useEffect(() => {
    if (!user?.id) return
    return watchOnline(setOnlineIds)
  }, [user?.id])

  // Realtime invite stream for MY user id
  useEffect(() => {
    if (!user?.id) return
    return watchGameInvites(user.id, {
      onInvite: (inv) => {
        if (!inv?.matchId || !inv?.gameType) return
        // Ignore invites from myself or for chats other than a live match
        if (inv.fromId === user.id) return
        if (timerRef.current) clearTimeout(timerRef.current)
        setInvite(inv)
        import('@capacitor/haptics')
          .then(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Light }))
          .catch(() => {})
        timerRef.current = setTimeout(() => setInvite(null), 30000)
      },
    })
  }, [user?.id])

  const respond = (accepted: boolean) => {
    const inv = inviteRef.current
    setInvite(null)
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!inv) return
    import('@/lib/quicky/game-invites').then(({ respondToGameInvite }) =>
      respondToGameInvite(inv.fromId, {
        accepted,
        matchId: inv.matchId,
        gameType: inv.gameType,
        fromId: user?.id ?? '',
        fromName: user?.name ?? 'Someone',
      })
    )
    if (accepted) {
      // Join = jump straight into the chat; the game opens from there via
      // the auto-open pending game handshake (see ChatView).
      try { sessionStorage.setItem(`qk_pending_game_${inv.matchId}`, inv.gameType) } catch {}
      useQuickyStore.getState().openChat(inv.matchId)
    }
  }

  const partnerOnline = invite ? onlineIds.has(invite.fromId) : false

  return (
    <AnimatePresence>
      {invite && (
        <motion.div
          initial={{ y: -80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -80, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 28 }}
          className="absolute top-3 left-3 right-3 z-[200] pointer-events-auto"
        >
          <div className="rounded-3xl border border-[var(--qk-accent)]/40 bg-[var(--qk-card)]/95 backdrop-blur-xl shadow-2xl p-4 flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-[var(--qk-accent)]/15 border border-[var(--qk-accent)]/30 flex items-center justify-center shrink-0">
              <Gamepad2 className="w-5 h-5 text-[var(--qk-accent)]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">
                {invite.fromName} invites you to {gameLabel(invite.gameType)}
              </p>
              <p className="text-[11px] text-white/50 flex items-center gap-1 mt-0.5">
                <span className={`w-1.5 h-1.5 rounded-full ${partnerOnline ? 'bg-[#30D158]' : 'bg-white/30'}`} />
                {partnerOnline ? 'Online now' : 'Offline — you can still join'}
              </p>
            </div>
            <button
              onClick={() => respond(true)}
              className="w-9 h-9 rounded-full bg-coral-gradient flex items-center justify-center shrink-0 active:scale-95 transition-transform"
              aria-label="Join game"
            >
              <Check className="w-4 h-4" strokeWidth={3} />
            </button>
            <button
              onClick={() => respond(false)}
              className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center shrink-0 active:scale-95 transition-transform"
              aria-label="Decline invitation"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
