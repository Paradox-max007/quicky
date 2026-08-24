'use client'

import { useEffect, useState } from 'react'
import { useQuickyStore } from '@/store/quicky'
import { motion } from 'framer-motion'
import { Heart, MessageCircle, Camera, X } from 'lucide-react'
import { toast } from 'sonner'

export function MatchCelebration() {
  const m = useQuickyStore((s) => s.pendingMatchPartner)
  const clear = useQuickyStore((s) => s.clearMatchCelebration)
  const openChat = useQuickyStore((s) => s.openChat)
  const user = useQuickyStore((s) => s.user)
  const myPhoto = user?.photos?.[0]?.url ?? null

  if (!m) return null

  return (
    <div className="absolute inset-0 z-[100] flex flex-col items-center justify-center bg-[var(--qk-bg)]/95 backdrop-blur-sm px-6 overflow-hidden">
      {/* Confetti */}
      {Array.from({ length: 24 }).map((_, i) => {
        const colors = ['#FF2D55', '#B8A4FF', '#F5C570', '#FFFFFF']
        const color = colors[i % colors.length]
        const left = (i * 37) % 100
        const delay = (i % 6) * 0.1
        return (
          <div
            key={i}
            className="absolute top-0 animate-confetti"
            style={{
              left: `${left}%`,
              width: 8,
              height: 12,
              backgroundColor: color,
              borderRadius: 2,
              animationDelay: `${delay}s`,
            }}
          />
        )
      })}

      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 18 }}
        className="flex flex-col items-center gap-6 z-10"
      >
        <h1 className="text-4xl font-extrabold tracking-tight text-center">
          <span className="text-gradient-coral">It’s a match!</span>
        </h1>
        <p className="text-white/70 text-sm text-center max-w-xs">
          {m.partnerName ?? 'Someone'} likes you back. Send a Quicky to break the ice.
        </p>

        {/* Two avatars */}
        <div className="relative flex items-center justify-center">
          <div className="relative w-28 h-28 rounded-full overflow-hidden border-4 border-[var(--qk-accent)] glow-coral-strong">
            {myPhoto ? (
              <img src={myPhoto} alt="You" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-[var(--qk-accent)]/30 flex items-center justify-center text-2xl font-bold">
                {user?.name?.[0] ?? '?'}
              </div>
            )}
          </div>
          <div className="relative w-28 h-28 rounded-full overflow-hidden border-4 border-[var(--qk-accent)] glow-coral-strong -ml-6">
            {m.partnerPhoto ? (
              <img src={m.partnerPhoto} alt={m.partnerName ?? 'Partner'} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-[var(--qk-accent)]/30 flex items-center justify-center text-2xl font-bold">
                {m.partnerName?.[0] ?? '?'}
              </div>
            )}
          </div>
          {/* Floating heart */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: 'spring', stiffness: 260, damping: 14 }}
            className="absolute -top-2 left-1/2 -translate-x-1/2 bg-[var(--qk-accent)] w-12 h-12 rounded-full flex items-center justify-center glow-coral-strong z-20"
          >
            <Heart className="w-6 h-6 text-white" fill="white" />
          </motion.div>
        </div>

        <div className="flex flex-col gap-2 w-full max-w-xs">
          <button
            onClick={() => {
              openChat(m.matchId)
              clear()
            }}
            className="w-full bg-coral-gradient glow-coral rounded-2xl py-3.5 font-semibold text-base flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
          >
            <Camera className="w-5 h-5" />
            Send a Quicky
          </button>
          <button
            onClick={() => {
              openChat(m.matchId)
              clear()
            }}
            className="w-full bg-white/10 border border-white/10 rounded-2xl py-3.5 font-semibold text-base flex items-center justify-center gap-2 hover:bg-white/15 active:scale-[0.98] transition-all"
          >
            <MessageCircle className="w-5 h-5" />
            Say hi
          </button>
          <button
            onClick={clear}
            className="text-white/50 text-sm hover:text-white/80 mt-2"
          >
            Keep swiping
          </button>
        </div>
      </motion.div>

      <button
        onClick={clear}
        className="absolute top-12 right-4 text-white/40 hover:text-white"
        aria-label="Close"
      >
        <X className="w-6 h-6" />
      </button>
    </div>
  )
}
