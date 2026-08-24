'use client'

import { useEffect, useState, useRef } from 'react'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import { toast } from 'sonner'

/**
 * QuickyViewer — full-screen immersive Quicky viewer with timer countdown.
 * Per PRD §8.1: full-screen, timer countdown, no pause, no save by default.
 * Screenshot detection: best-effort via keydown / visibility change.
 */
export function QuickyViewer({
  mediaUrl,
  duration,
  onClose,
  onScreenshot,
}: {
  mediaUrl: string
  duration: number
  onClose: () => void
  onScreenshot?: () => void
}) {
  const [remaining, setRemaining] = useState(duration)
  const [closed, setClosed] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Detect screenshot attempts (best-effort)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Common screenshot keys: PrtSc, Cmd+Shift+3/4/5, Ctrl+Shift+S
      if (e.key === 'PrintScreen' || (e.metaKey && e.shiftKey && ['3', '4', '5'].includes(e.key))) {
        toast.error('Screenshot detected. Sender has been notified.')
        onScreenshot?.()
      }
    }
    const onVisibility = () => {
      if (document.hidden) {
        // Tab hidden — likely screenshotting on iOS
        toast.error('Window hidden during Quicky. Sender has been notified.')
        onScreenshot?.()
      }
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [onScreenshot])

  useEffect(() => {
    // Start countdown
    intervalRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current)
          setTimeout(() => {
            setClosed(true)
            setTimeout(onClose, 200)
          }, 200)
          return 0
        }
        return r - 1
      })
    }, 1000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [duration, onClose])

  // Lock body scroll
  useEffect(() => {
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = original
    }
  }, [])

  const progress = 1 - remaining / duration

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: closed ? 0 : 1, scale: closed ? 0.95 : 1 }}
      transition={{ duration: 0.2 }}
      className="absolute inset-0 z-[200] bg-black flex flex-col items-center justify-center overflow-hidden"
    >
      {/* Media */}
      <img src={mediaUrl} alt="Quicky" className="w-full h-full object-contain select-none pointer-events-none" draggable={false} />

      {/* Progress ring at top */}
      <div className="absolute top-12 left-1/2 -translate-x-1/2 flex items-center gap-3">
        <svg width="48" height="48" className="transform -rotate-90">
          <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="3" />
          <circle
            cx="24"
            cy="24"
            r="20"
            fill="none"
            stroke="var(--qk-accent)"
            strokeWidth="3"
            strokeDasharray={`${2 * Math.PI * 20 * progress} ${2 * Math.PI * 20}`}
            strokeLinecap="round"
          />
        </svg>
        <span className="text-2xl font-bold text-white">{remaining}</span>
      </div>

      {/* Quicky label */}
      <div className="absolute top-4 left-4 flex items-center gap-1.5 bg-black/40 backdrop-blur rounded-full px-3 py-1.5">
        <span className="w-2 h-2 rounded-full bg-[var(--qk-accent)] animate-quicky-pulse" />
        <span className="text-xs font-semibold text-white">Quicky</span>
      </div>

      {/* Close */}
      <button
        onClick={() => {
          setClosed(true)
          setTimeout(onClose, 200)
        }}
        className="absolute top-4 right-4 p-2 rounded-full bg-black/40 backdrop-blur hover:bg-black/60"
        aria-label="Close Quicky"
      >
        <X className="w-5 h-5 text-white" />
      </button>

      {/* Bottom hint */}
      <div className="absolute bottom-8 left-0 right-0 text-center text-white/60 text-xs">
        Tap anywhere to close · No saving allowed · Screenshots notify the sender
      </div>

      {/* Click-to-close overlay (anywhere outside media area) */}
      <button
        onClick={() => {
          setClosed(true)
          setTimeout(onClose, 200)
        }}
        className="absolute inset-0 -z-0"
        aria-label="Close"
      />
    </motion.div>
  )
}
