'use client'

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import { toast } from 'sonner'

/**
 * QuickyViewer — full-screen immersive Quicky viewer.
 * Per PRD §6.2/6.3: countdown starts only when the media is fully loaded and
 * visible; no pause, no scrubbing; closing early (or timer = 0) forfeits the
 * remaining time and triggers `onConsumed` — the caller must permanently
 * delete the media server-side. Screenshot detection is best-effort.
 */
export function QuickyViewer({
  mediaUrl,
  duration,
  onClose,
  onConsumed,
  onScreenshot,
}: {
  mediaUrl: string
  duration: number
  onClose: () => void
  onConsumed?: () => void
  onScreenshot?: () => void
}) {
  const [loaded, setLoaded] = useState(false)
  const [remaining, setRemaining] = useState(duration)
  const [closed, setClosed] = useState(false)
  const [dragY, setDragY] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const consumedRef = useRef(false)
  const startY = useRef<number | null>(null)

  const consumeAndClose = () => {
    if (consumedRef.current) return
    consumedRef.current = true
    // Permanently delete the media (server wipes the file + URL)
    try {
      onConsumed?.()
    } catch {}
    setClosed(true)
    setTimeout(onClose, 180)
  }

  // Detect screenshot attempts (best-effort)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'PrintScreen' || (e.metaKey && e.shiftKey && ['3', '4', '5'].includes(e.key))) {
        toast.error('Screenshot detected. Sender has been notified.')
        onScreenshot?.()
      }
    }
    const onVisibility = () => {
      if (document.hidden) {
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
     
  }, [])

  // Countdown starts only when the media is loaded and visible
  useEffect(() => {
    if (!loaded || closed) return
    intervalRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current)
          consumeAndClose()
          return 0
        }
        return r - 1
      })
    }, 1000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
     
  }, [loaded, closed])

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
      animate={{ opacity: closed ? 0 : 1, y: dragY, scale: closed ? 0.95 : 1 }}
      transition={{ duration: 0.18 }}
      className="absolute inset-0 z-[200] bg-black flex flex-col items-center justify-center overflow-hidden touch-none"
      onPointerDown={(e) => {
        startY.current = e.clientY
      }}
      onPointerMove={(e) => {
        if (startY.current === null) return
        const dy = e.clientY - startY.current
        if (dy > 0) setDragY(dy)
      }}
      onPointerUp={(e) => {
        if (startY.current === null) return
        const dy = e.clientY - startY.current
        startY.current = null
        if (dy > 90) {
          // Swipe down = close early; remaining time is forfeited
          consumeAndClose()
        } else {
          setDragY(0)
        }
      }}
      onPointerCancel={() => {
        startY.current = null
        setDragY(0)
      }}
    >
      {/* Media — timer starts once it is actually visible */}
      {mediaUrl.endsWith('.mp4') || mediaUrl.endsWith('.webm') || mediaUrl.endsWith('.mov') ? (
        <video
          src={mediaUrl}
          className="w-full h-full object-contain select-none pointer-events-none"
          autoPlay
          playsInline
          muted
          onLoadedData={() => setLoaded(true)}
          draggable={false}
        />
      ) : (
        <img
          src={mediaUrl}
          alt="Quicky"
          className="w-full h-full object-contain select-none pointer-events-none"
          draggable={false}
          onLoad={() => setLoaded(true)}
        />
      )}

      {/* Timer — small badge in the bottom-left corner */}
      <div className="absolute bottom-8 left-4 flex items-center gap-2 bg-black/50 backdrop-blur rounded-full pl-1.5 pr-3 py-1.5">
        <svg width="26" height="26" className="transform -rotate-90">
          <circle cx="13" cy="13" r="10" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2.5" />
          <circle
            cx="13"
            cy="13"
            r="10"
            fill="none"
            stroke="var(--qk-accent)"
            strokeWidth="2.5"
            strokeDasharray={`${2 * Math.PI * 10 * progress} ${2 * Math.PI * 10}`}
            strokeLinecap="round"
          />
        </svg>
        <span className="text-sm font-bold text-white tabular-nums">{loaded ? remaining : '·'}</span>
      </div>

      {/* Quicky label */}
      <div className="absolute top-4 left-4 flex items-center gap-1.5 bg-black/40 backdrop-blur rounded-full px-3 py-1.5">
        <span className="w-2 h-2 rounded-full bg-[var(--qk-accent)] animate-quicky-pulse" />
        <span className="text-xs font-semibold text-white">Quicky</span>
      </div>

      {/* Close */}
      <button
        onClick={consumeAndClose}
        className="absolute top-4 right-4 p-2 rounded-full bg-black/40 backdrop-blur hover:bg-black/60 z-10"
        aria-label="Close Quicky"
      >
        <X className="w-5 h-5 text-white" />
      </button>

      {/* Bottom hint */}
      <div className="absolute bottom-8 left-0 right-0 text-center text-white/60 text-xs px-6">
        {loaded ? 'Swipe down or tap ✕ to close · disappears forever' : 'Loading…'}
      </div>
    </motion.div>
  )
}
