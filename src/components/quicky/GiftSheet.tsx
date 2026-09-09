'use client'

// Quicky — Gift Sheet
// Bottom-sheet gift selector for the Spin the Bottle room.
// Shows the full gift catalog, the sender's coin balance, and a recipient picker.

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Coins } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SPIN_BOTTLE_GIFTS } from '@/lib/quicky/constants'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'

type Player = { userId: string; displayName: string }

type Props = {
  open: boolean
  onClose: () => void
  roomId: string
  players: Player[]
  meId: string
  coinBalance: number
  currentTargetId?: string | null
  onGiftSent?: (newBalance: number) => void
}

export function GiftSheet({ open, onClose, roomId, players, meId, coinBalance, currentTargetId, onGiftSent }: Props) {
  const [selectedItem, setSelectedItem] = useState<string | null>(null)
  const [recipientId, setRecipientId] = useState<string>(currentTargetId ?? '')
  const [sending, setSending] = useState(false)

  const others = players.filter((p) => p.userId !== meId)
  const giftDef = SPIN_BOTTLE_GIFTS.find((g) => g.id === selectedItem)
  const recipient = others.find((p) => p.userId === recipientId)
  const canSend = !!selectedItem && !!recipientId && !sending && (giftDef?.coinPrice ?? 0) <= coinBalance

  const send = async () => {
    if (!canSend || !selectedItem) return
    setSending(true)
    try {
      const res = await api.spinBottle.gifts.send(roomId, recipientId, selectedItem)
      if (res?.ok) {
        toast.success(`${giftDef?.emoji} Sent to ${recipient?.displayName}!`)
        onGiftSent?.(res.coinBalance)
        setSelectedItem(null)
        onClose()
      }
    } catch (e: any) {
      const msg = e?.body?.error
      if (msg === 'insufficient_coins') toast.error('Not enough coins!')
      else toast.error(e.message ?? 'Failed to send gift')
    } finally {
      setSending(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[180] bg-black/60"
            onClick={onClose}
          />

          {/* Sheet */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            className="fixed bottom-0 inset-x-0 z-[181] bg-[var(--qk-card)] border-t border-white/10 rounded-t-3xl flex flex-col"
            style={{ maxHeight: '72vh' }}
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-white/20" />
            </div>

            {/* Header */}
            <div className="px-4 pb-3 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base">Send a Gift 🎁</h3>
                <div className="flex items-center gap-1 mt-0.5">
                  <span className="text-[var(--qk-gold)] text-sm">🪙</span>
                  <span className="text-sm font-semibold text-[var(--qk-gold)]">{coinBalance.toLocaleString()}</span>
                  <span className="text-xs text-white/50">coins</span>
                </div>
              </div>
              <button onClick={onClose} className="p-2 rounded-full bg-white/5">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Recipient picker */}
            <div className="px-4 pb-3">
              <p className="text-xs text-white/50 mb-2 font-semibold uppercase tracking-wider">Send to</p>
              <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                {others.map((p) => (
                  <button
                    key={p.userId}
                    onClick={() => setRecipientId(p.userId)}
                    className={cn(
                      'shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all',
                      recipientId === p.userId
                        ? 'bg-[var(--qk-accent)] border-transparent text-white'
                        : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'
                    )}
                  >
                    {p.displayName}
                  </button>
                ))}
              </div>
            </div>

            {/* Gift grid */}
            <div className="flex-1 overflow-y-auto no-scrollbar px-4 pb-4">
              <div className="grid grid-cols-4 gap-3">
                {SPIN_BOTTLE_GIFTS.map((gift) => {
                  const canAfford = coinBalance >= gift.coinPrice
                  const isSelected = selectedItem === gift.id
                  return (
                    <button
                      key={gift.id}
                      onClick={() => setSelectedItem(isSelected ? null : gift.id)}
                      disabled={!canAfford}
                      className={cn(
                        'flex flex-col items-center gap-1 rounded-2xl p-2.5 border transition-all active:scale-95',
                        isSelected
                          ? 'bg-[var(--qk-accent)]/15 border-[var(--qk-accent)]'
                          : canAfford
                          ? 'bg-white/5 border-white/10 hover:bg-white/10'
                          : 'bg-white/3 border-white/5 opacity-40'
                      )}
                    >
                      <span className="text-2xl leading-none">{gift.emoji}</span>
                      <span className="text-[9px] text-white/60 font-medium truncate w-full text-center">{gift.name}</span>
                      <div className="flex items-center gap-0.5">
                        <span className="text-[var(--qk-gold)] text-[9px]">🪙</span>
                        <span className={cn('text-[9px] font-bold', canAfford ? 'text-[var(--qk-gold)]' : 'text-white/30')}>
                          {gift.coinPrice}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Send button */}
            <div className="px-4 pb-6 pt-2 safe-area-bottom">
              <button
                onClick={send}
                disabled={!canSend}
                className="w-full rounded-2xl py-3.5 font-bold text-white bg-coral-gradient glow-coral disabled:opacity-30 disabled:glow-none transition-all active:scale-[0.98] flex items-center justify-center gap-2"
              >
                {sending ? (
                  <span className="text-sm">Sending…</span>
                ) : giftDef && recipient ? (
                  <>
                    <span>{giftDef.emoji}</span>
                    <span>Send {giftDef.name} to {recipient.displayName}</span>
                    <span className="opacity-70">· 🪙 {giftDef.coinPrice}</span>
                  </>
                ) : (
                  <span>Select a gift and recipient</span>
                )}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
