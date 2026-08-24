'use client'

import { motion } from 'framer-motion'
import { Gamepad2, Dices, Sparkles, Users, CircleDot as RouletteIcon } from 'lucide-react'

// Placeholder screen for the upcoming community games section
// (spin the bottle, roulette, ludo, ...). Real gameplay lands later.
export function GamesScreen() {
  const games = [
    { icon: Dices, name: 'Spin the Bottle', color: 'var(--qk-accent)' },
    { icon: RouletteIcon, name: 'Roulette', color: 'var(--qk-gold)' },
    { icon: Users, name: 'Ludo', color: 'var(--qk-purple)' },
  ]

  return (
    <div className="w-full h-full flex flex-col bg-[var(--qk-bg)] text-white relative overflow-hidden">
      {/* Animated glow blobs */}
      <motion.div
        className="absolute -top-20 -left-20 w-64 h-64 rounded-full bg-[var(--qk-accent)]/20 blur-3xl"
        animate={{ x: [0, 30, 0], y: [0, 20, 0] }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute -bottom-24 -right-20 w-72 h-72 rounded-full bg-[var(--qk-purple)]/20 blur-3xl"
        animate={{ x: [0, -30, 0], y: [0, -20, 0] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Floating sparkles */}
      {Array.from({ length: 10 }).map((_, i) => (
        <motion.div
          key={i}
          className="absolute pointer-events-none"
          style={{ left: `${8 + (i * 9) % 84}%`, top: `${12 + ((i * 37) % 70)}%` }}
          animate={{ y: [0, -14, 0], opacity: [0.15, 0.6, 0.15] }}
          transition={{ duration: 3 + (i % 4), repeat: Infinity, ease: 'easeInOut', delay: i * 0.3 }}
        >
          <Sparkles className="w-4 h-4 text-white" />
        </motion.div>
      ))}

      <header className="shrink-0 px-5 pt-3 pb-3">
        <h1 className="text-2xl font-bold tracking-tight">Games</h1>
      </header>

      <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-center px-8 relative">
        {/* Bouncing gamepad hero */}
        <motion.div
          initial={{ scale: 0, rotate: -20 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 14 }}
          className="relative mb-6"
        >
          <motion.div
            animate={{ y: [0, -10, 0], rotate: [-4, 4, -4] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            className="w-24 h-24 rounded-3xl bg-gradient-to-br from-[var(--qk-accent)] to-[var(--qk-purple)] flex items-center justify-center shadow-2xl"
          >
            <Gamepad2 className="w-12 h-12 text-white" strokeWidth={1.75} />
          </motion.div>
          {/* Pulsing ring */}
          <motion.div
            className="absolute inset-0 rounded-3xl border-2 border-[var(--qk-accent)]/50"
            animate={{ scale: [1, 1.35], opacity: [0.6, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
          />
        </motion.div>

        <motion.h2
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="text-2xl font-bold"
        >
          Community Games
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="text-white/60 text-sm mt-1.5 max-w-[260px]"
        >
          Play, match and connect with others in real time. Launching soon.
        </motion.p>

        {/* Upcoming games teaser */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="mt-8 flex gap-3"
        >
          {games.map((g, i) => (
            <motion.div
              key={g.name}
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut', delay: i * 0.4 }}
              className="flex flex-col items-center gap-1.5 bg-white/5 border border-white/10 rounded-2xl px-4 py-3 backdrop-blur-sm"
            >
              <g.icon className="w-6 h-6" style={{ color: g.color }} />
              <span className="text-[10px] font-medium text-white/70 whitespace-nowrap">{g.name}</span>
            </motion.div>
          ))}
        </motion.div>

        {/* Shimmering "coming soon" pill */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.55 }}
          className="mt-8 relative overflow-hidden rounded-full border border-[var(--qk-accent)]/40 bg-[var(--qk-accent)]/10 px-5 py-2"
        >
          <motion.div
            className="absolute inset-y-0 w-16 bg-gradient-to-r from-transparent via-white/25 to-transparent -skew-x-12"
            animate={{ x: ['-80px', '260px'] }}
            transition={{ duration: 1.8, repeat: Infinity, repeatDelay: 1, ease: 'easeInOut' }}
          />
          <span className="relative text-xs font-semibold tracking-wide text-[var(--qk-accent)] uppercase">
            Launching Soon
          </span>
        </motion.div>
      </div>
    </div>
  )
}
