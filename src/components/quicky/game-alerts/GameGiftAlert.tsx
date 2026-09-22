'use client'

// Quicky — GAME GIFT ALERT (gifting-revision: gift-received top drawer)
//
// The "You received N × 🎁 from {sender}" TOP DRAWER — EXACTLY the same
// popup choreography as the gameplay notifications and the private-message
// drawer: slides down from the top over whatever screen the user is on
// (300ms easeInOut), drag-down-to-dismiss with the shared threshold, no
// backdrop (whatever is underneath stays visible + tappable), auto-dismiss
// after ~9s, theme-accent paint so it reads as a social/economy event at a
// glance.
//
// WHERE IT SHOWS (split by surface — the user sees exactly ONE notifier):
//   · MOBILE / CAPACITOR / MOBILE WEB: whenever the player is NOT on the
//     game screen. On the game screen the room-chat gift card + the fly
//     animation are the notification (never an overlay on top of play).
//   · DESKTOP SHELL: whenever the player is NOT in a room view. In-room on
//     desktop, the RoomChatPanel's own panel-top drawer (contacts/personal
//     open) or the special room-chat gift card (Room Chat open) covers it.
//
// SEND GIFT (the action): opens the global GiftBackSheet with the sender's
// profile — gift directly from whatever screen the user is on, without
// leaving it (the room runtime never detached).

import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Gift } from 'lucide-react'
import { useQuickyStore } from '@/store/quicky'
import { useGiftAlertStore } from '@/store/gift-alerts'
import { useGiftBackStore } from '@/store/gift-back'
import { GiftIcon } from '@/components/quicky/GiftIcon'

export function GameGiftAlert() {
  const events = useGiftAlertStore((s) => s.events)
  const dismiss = useGiftAlertStore((s) => s.dismiss)
  const view = useQuickyStore((s) => s.view)
  const openGiftBack = useGiftBackStore((s) => s.openGiftBack)

  // Only the OFF-ROOM-SCREEN notifier (see header). The store TTL (~12s)
  // removes unshown events so returning to the room never replays stale
  // drawers — the gift card stays in the chat timeline either way.
  const inRoomView = view === 'spin-bottle-room' || view === 'ludo-room'
  const event = !inRoomView && events.length > 0 ? events[0] : null

  useEffect(() => {
    if (!event) return
    const t = setTimeout(() => dismiss(event.id), 9_000)
    return () => clearTimeout(t)
  }, [event, dismiss])

  useEffect(() => {
    if (!event) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss(event.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [event, dismiss])

  const sendGiftBack = () => {
    if (!event) return
    openGiftBack(
      { id: event.senderId, name: event.senderName, avatar: event.senderAvatar ?? null },
      event.roomId
    )
    dismiss(event.id)
  }

  return (
    <AnimatePresence>
      {event && (
        <motion.div
          key={event.id}
          // IDENTICAL choreography to GameMessageAlert / the gameplay drawers:
          // slide-down 300ms, drag down to dismiss (offset > 90 or velocity >
          // 600), no backdrop — the screen underneath stays usable.
          initial={{ y: '-120%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '-120%', opacity: 0 }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.55 }}
          onDragEnd={(_, info) => {
            if (info.offset.y > 90 || info.velocity.y > 600) dismiss(event.id)
          }}
          className="fixed top-[max(env(safe-area-inset-top),0.5rem)] inset-x-0 z-[232] mx-auto w-[min(94vw,26rem)]"
          role="dialog"
          aria-label="Gift received"
          data-testid="game-gift-alert"
        >
          {/* THEME-COLORED drawer (accent paint) — same geometry as the
              message drawer; tap-to-dismiss outside the buttons. */}
          <div
            className="relative border border-white/25 rounded-3xl shadow-2xl p-4 flex items-center gap-3.5 cursor-pointer"
            style={{ background: 'var(--qk-accent)' }}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('button')) return
              dismiss(event.id)
            }}
          >
            <div
              className="absolute top-1.5 left-1/2 -translate-x-1/2 h-1 w-10 rounded-full"
              style={{ background: 'var(--qk-on-accent)', opacity: 0.25 }}
              aria-hidden
            />

            {/* sender profile image + gift badge */}
            <div className="relative shrink-0">
              {event.senderAvatar ? (
                <img
                  src={event.senderAvatar}
                  alt=""
                  className="w-16 h-16 rounded-2xl object-cover border border-white/40 shadow-md"
                />
              ) : (
                <span
                  className="w-16 h-16 rounded-2xl bg-black/15 flex items-center justify-center text-2xl"
                  aria-hidden
                >
                  🎁
                </span>
              )}
              <span className="absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-full bg-white border border-black/10 flex items-center justify-center">
                <Gift className="w-3.5 h-3.5" style={{ color: 'var(--qk-accent)' }} aria-hidden />
              </span>
            </div>

            <div className="min-w-0 flex-1">
              <p
                className="text-[10px] font-black tracking-[0.18em] uppercase"
                style={{ color: 'var(--qk-on-accent-soft)' }}
              >
                Gift received
              </p>
              <p className="font-black text-base leading-tight truncate" style={{ color: 'var(--qk-on-accent)' }}>
                {event.senderName || 'Someone'}
              </p>
              <p
                className="text-xs font-semibold mt-0.5 truncate flex items-center gap-1"
                style={{ color: 'var(--qk-on-accent-soft)' }}
                data-testid="game-gift-preview"
              >
                sent you {event.quantity > 1 ? `${event.quantity}× ` : ''}
                <GiftIcon
                  icon={event.itemIcon}
                  iconType={event.itemIconType}
                  className="h-4 w-4 text-base"
                  imgClassName="h-4 w-4"
                />
                <span className="truncate">
                  {event.itemName ?? 'a gift'}
                  {event.quantity > 1 ? 's' : ''}
                </span>
              </p>
            </div>

            <div className="flex flex-col gap-1.5 shrink-0">
              <button
                onClick={sendGiftBack}
                className="bg-white rounded-xl px-3.5 py-2 text-xs font-black tracking-wide active:scale-95 transition shadow-md flex items-center gap-1"
                style={{ color: 'var(--qk-accent)' }}
                aria-label={`Send a gift back to ${event.senderName || 'sender'}`}
                data-testid="game-gift-send-back"
              >
                <Gift className="w-3.5 h-3.5" aria-hidden /> Send Gift
              </button>
              <button
                onClick={() => dismiss(event.id)}
                className="bg-black/25 border border-white/25 rounded-xl px-3.5 py-1.5 text-[11px] font-bold active:scale-95 transition"
                style={{ color: 'var(--qk-on-accent)' }}
                aria-label="Dismiss gift notification"
                data-testid="game-gift-dismiss"
              >
                Dismiss
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
