'use client'

// Quicky — Spin the Bottle room view
// Fullscreen overlay with a Three.js table, turn indicator, chat drawer, and
// kiss-response modal. Polls /room every 2s while the room is active (V1
// realtime path is wired but the server doesn't yet push — server-driven
// state is always read from the DB on each tick).
import { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft,
  MessageCircle,
  X,
  Heart,
  Send,
  DoorOpen,
  Trophy,
  Sparkles,
  AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/quicky/api-client'
import { useQuickyStore } from '@/store/quicky'
import { cn } from '@/lib/utils'
import type { CanvasPlayer } from './SpinBottleCanvas'

// Three.js is large — load it only when the user enters the room
const SpinBottleCanvas = dynamic(
  () => import('./SpinBottleCanvas').then((m) => m.SpinBottleCanvas),
  { ssr: false, loading: () => <div className="absolute inset-0 flex items-center justify-center text-white/40 text-sm">Loading table…</div> }
)

type Snapshot = {
  roomId: string
  status: string
  maxPlayers: number
  minPlayers: number
  currentTurnIdx: number
  players: {
    userId: string
    seatIndex: number
    turnIndex: number
    connection: string
    isActive: boolean
    displayName: string
    avatar: string | null
    gender: string | null
  }[]
  currentSpin: {
    id: string
    spinnerId: string
    targetId: string | null
    startRotation: number
    endRotation: number
    duration: number
    status: string
    response: string | null
  } | null
  myTurnIndex: number
  myTurnIs: boolean
  iAmTarget: boolean
  recentMessages: { id: string; userId: string; text: string; kind: string; createdAt: string }[]
}

const RESPONSE_TIMEOUT = 10

export function SpinBottleRoom({
  roomId: initialRoomId,
  onClose,
}: {
  roomId: string
  onClose: () => void
}) {
  const meId = useQuickyStore((s) => s.user?.id) ?? ''
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [chat, setChat] = useState<Snapshot['recentMessages']>([])
  const [chatText, setChatText] = useState('')
  const [sendingChat, setSendingChat] = useState(false)
  const [showExit, setShowExit] = useState(false)
  const [responseCountdown, setResponseCountdown] = useState(RESPONSE_TIMEOUT)
  const [kissFlash, setKissFlash] = useState<{ kind: 'yes' | 'no' | 'timeout' | null; name: string }>({ kind: null, name: '' })
  const [displayedRotation, setDisplayedRotation] = useState({ start: 0, end: 0 })
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const spinStartTimeRef = useRef<number>(0)
  const chatScrollRef = useRef<HTMLDivElement | null>(null)

  // Keep room chat scrolled to the newest message (desktop panel + mobile drawer;
  // also fires when the drawer opens since its list remounts)
  useEffect(() => {
    const el = chatScrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat, chatOpen])

  // Polling — V1 sync path
  useEffect(() => {
    if (!initialRoomId) return
    let cancelled = false
    const refresh = async () => {
      try {
        const res = await api.spinBottle.room(initialRoomId)
        if (cancelled || !res?.snapshot) return
        applySnapshot(res.snapshot)
      } catch (e: any) {
        // Silent: keep polling
      }
    }
    refresh()
    pollRef.current = setInterval(refresh, 1500)
    return () => {
      cancelled = true
      if (pollRef.current) clearInterval(pollRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRoomId])

  // Apply snapshot, handling side effects for spin transitions
  const applySnapshot = useCallback(
    (s: Snapshot) => {
      setSnapshot((prev) => {
        // Detect new completed spin → show result flash
        if (
          prev?.currentSpin &&
          s.currentSpin &&
          prev.currentSpin.id !== s.currentSpin.id
        ) {
          // New spin started — nothing to do
        }
        if (
          s.currentSpin?.status === 'completed' &&
          prev?.currentSpin?.status !== 'completed' &&
          prev?.currentSpin?.id === s.currentSpin.id
        ) {
          const kind = (s.currentSpin.response as 'yes' | 'no' | 'timeout' | null) ?? 'timeout'
          const target = s.players.find((p) => p.userId === s.currentSpin?.targetId)
          setKissFlash({ kind, name: target?.displayName ?? 'They' })
          setTimeout(() => setKissFlash({ kind: null, name: '' }), 2200)
        }
        // Track spin start for the canvas
        if (s.currentSpin && (!prev?.currentSpin || prev.currentSpin.id !== s.currentSpin.id)) {
          spinStartTimeRef.current = Date.now()
          setDisplayedRotation({ start: s.currentSpin.startRotation, end: s.currentSpin.endRotation })
        } else if (!s.currentSpin && prev?.currentSpin) {
          setDisplayedRotation({ start: 0, end: 0 })
        }
        return s
      })
      // Update chat list (only newer ones)
      setChat((prev) => {
        const seen = new Set(prev.map((m) => m.id))
        const newOnes = s.recentMessages.filter((m) => !seen.has(m.id))
        if (newOnes.length === 0 && prev.length === s.recentMessages.length) return prev
        return s.recentMessages
      })
    },
    []
  )

  // Response countdown (10s) when iAmTarget and status='awaiting'
  useEffect(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current)
      countdownRef.current = null
    }
    if (snapshot?.currentSpin?.status === 'awaiting' && snapshot.iAmTarget) {
      setResponseCountdown(RESPONSE_TIMEOUT)
      countdownRef.current = setInterval(() => {
        setResponseCountdown((c) => {
          if (c <= 1) {
            if (countdownRef.current) clearInterval(countdownRef.current)
            return 0
          }
          return c - 1
        })
      }, 1000)
    }
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [snapshot?.currentSpin?.id, snapshot?.currentSpin?.status, snapshot?.iAmTarget])

  const respond = async (choice: 'yes' | 'no') => {
    if (!snapshot?.currentSpin || !initialRoomId) return
    try {
      await api.spinBottle.respond(initialRoomId, choice)
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to respond')
    }
  }

  const sendChat = async () => {
    const t = chatText.trim()
    if (!t || sendingChat || !initialRoomId) return
    setSendingChat(true)
    setChatText('')
    // Optimistic insert
    const tmpId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    setChat((prev) => [
      ...prev,
      {
        id: tmpId,
        userId: meId,
        text: t,
        kind: 'user',
        createdAt: new Date().toISOString(),
      },
    ])
    try {
      const res = await api.spinBottle.sendChat(initialRoomId, t)
      if (res?.message) {
        setChat((prev) => {
          const without = prev.filter((m) => m.id !== tmpId)
          if (without.some((m) => m.id === res.message.id)) return without
          return [...without, res.message]
        })
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to send')
      setChat((prev) => prev.filter((m) => m.id !== tmpId))
    } finally {
      setSendingChat(false)
    }
  }

  const leave = async () => {
    if (!initialRoomId) return
    try {
      await api.spinBottle.leave(initialRoomId)
    } catch {}
    onClose()
  }

  const players: CanvasPlayer[] = (snapshot?.players ?? []).map((p) => ({
    userId: p.userId,
    seatIndex: p.seatIndex,
    displayName: p.displayName,
    avatar: p.avatar,
    isTarget: p.userId === snapshot?.currentSpin?.targetId && snapshot?.currentSpin?.status === 'awaiting',
  }))

  const currentSpin = snapshot?.currentSpin
  const spinnerName = snapshot?.players.find((p) => p.userId === currentSpin?.spinnerId)?.displayName ?? '—'
  const status = currentSpin?.status ?? 'idle'

  // ─── Shared JSX: room chat messages (mobile drawer + desktop side panel) ──
  const chatMessages = (
    <div ref={chatScrollRef} className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-4 py-2 flex flex-col gap-2">
      {chat.length === 0 ? (
        <p className="text-center text-xs text-white/40 py-6">No messages yet. Say hi 👋</p>
      ) : (
        chat.map((m) => {
          const isSystem = m.kind === 'system'
          if (isSystem) {
            return (
              <p key={m.id} className="text-center text-[11px] text-white/40 py-1">
                {m.text}
              </p>
            )
          }
          const isMe = m.userId === meId
          const name = snapshot?.players.find((p) => p.userId === m.userId)?.displayName ?? '—'
          return (
            <div key={m.id} className={cn('flex', isMe ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[80%] rounded-2xl px-3 py-1.5 text-sm',
                  isMe ? 'bg-[var(--qk-accent)] text-white' : 'bg-white/8 text-white'
                )}
              >
                {!isMe && <p className="text-[10px] font-semibold opacity-70">{name}</p>}
                <p className="break-words">{m.text}</p>
              </div>
            </div>
          )
        })
      )}
    </div>
  )

  // ─── Shared JSX: chat input row (border/safe-area added by each wrapper) ──
  const chatInput = (
    <div className="p-3 flex items-center gap-2">
      <input
        value={chatText}
        onChange={(e) => setChatText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && sendChat()}
        maxLength={280}
        placeholder="Say something…"
        className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-full px-4 py-2.5 text-sm placeholder:text-white/30 focus:outline-none focus:border-[var(--qk-accent)]/50"
      />
      <button
        onClick={sendChat}
        disabled={!chatText.trim() || sendingChat}
        className="shrink-0 w-10 h-10 rounded-full bg-coral-gradient text-white disabled:opacity-30 flex items-center justify-center active:scale-95 transition-transform"
        aria-label="Send"
      >
        <Send className="w-[18px] h-[18px]" />
      </button>
    </div>
  )

  // ─── Shared JSX: bottom controls (respond when targeted, else watch) ──────
  const controls = snapshot?.iAmTarget && currentSpin?.status === 'awaiting' ? (
    <div className="flex flex-col items-center gap-2">
      <p className="text-xs text-white/50">The bottle points at you!</p>
      <div className="flex items-center gap-3 w-full">
        <button
          onClick={() => respond('no')}
          className="flex-1 bg-white/10 border border-white/15 rounded-2xl py-3.5 font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
        >
          <X className="w-4 h-4" /> No Thanks
        </button>
        <button
          onClick={() => respond('yes')}
          className="flex-1 bg-coral-gradient glow-coral rounded-2xl py-3.5 font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
        >
          <Heart className="w-4 h-4" fill="currentColor" /> Kiss
        </button>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-white/50">
        <span className="tabular-nums font-bold text-[var(--qk-gold)] text-base">{responseCountdown}</span>
        <span>seconds to respond</span>
      </div>
    </div>
  ) : (
    <div className="flex items-center justify-center gap-4 text-xs text-white/50">
      <button
        onClick={() => setChatOpen((v) => !v)}
        className="flex items-center gap-1.5 bg-white/8 rounded-full px-3.5 py-2 active:scale-95 transition-transform"
      >
        <MessageCircle className="w-4 h-4" /> Chat
      </button>
      <button
        onClick={() => setShowExit(true)}
        className="flex items-center gap-1.5 bg-white/8 rounded-full px-3.5 py-2 active:scale-95 transition-transform"
      >
        <DoorOpen className="w-4 h-4" /> Leave
      </button>
    </div>
  )

  return (
    <div className="absolute inset-0 z-[150] bg-[var(--qk-bg)] text-white flex flex-col overflow-hidden">
      <header className="shrink-0 px-3 pt-2.5 pb-2 flex items-center justify-between border-b border-white/8">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowExit(true)}
            className="p-2 rounded-full hover:bg-white/5"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="font-bold text-base leading-tight">Spin the Bottle</h2>
            <p className="text-[11px] text-white/50">
              Room #{initialRoomId.slice(-5).toUpperCase()} · {snapshot?.players.length ?? 0}/{snapshot?.maxPlayers ?? 12}
            </p>
          </div>
        </div>
        <button
          onClick={() => setChatOpen((v) => !v)}
          className="p-2 rounded-full hover:bg-white/5 md:hidden"
          aria-label="Chat"
        >
          <MessageCircle className="w-5 h-5" />
        </button>
      </header>

      {/* Game (left) + room chat (right on desktop) — stacked on mobile */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row">
        {/* LEFT — table + turn indicator */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 relative">
            <SpinBottleCanvas
              players={players}
              startRotation={displayedRotation.start}
              endRotation={displayedRotation.end}
              duration={currentSpin?.duration ?? 3500}
              spinning={status === 'spinning'}
              pointing={status === 'awaiting'}
            />

        {/* Turn status pill */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur border border-white/10 text-[12px] font-semibold">
          {status === 'spinning' && (
            <span>
              <span className="text-[var(--qk-accent)]">🍾</span> {spinnerName}'s turn — spinning…
            </span>
          )}
          {status === 'awaiting' && (
            <span>
              <span className="text-[var(--qk-gold)]">🎯</span> Bottle points at{' '}
              {snapshot?.players.find((p) => p.userId === currentSpin?.targetId)?.displayName ?? '?'}
            </span>
          )}
          {status === 'completed' && (
            <span>
              <span className="text-[var(--qk-purple)]">✨</span> Round complete
            </span>
          )}
          {status === 'idle' && <span>Waiting for the room to start…</span>}
        </div>

        {/* Result flash */}
        <AnimatePresence>
          {kissFlash.kind && (
            <motion.div
              key={kissFlash.kind}
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ type: 'spring', stiffness: 320, damping: 26 }}
              className={cn(
                'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 px-6 py-3 rounded-3xl font-black text-lg border-2 backdrop-blur-md flex items-center gap-2',
                kissFlash.kind === 'yes' && 'bg-coral-gradient glow-coral text-white border-transparent',
                kissFlash.kind === 'no' && 'bg-white/10 text-white border-white/20',
                kissFlash.kind === 'timeout' && 'bg-white/5 text-white/70 border-white/15'
              )}
            >
              {kissFlash.kind === 'yes' && <Heart className="w-5 h-5" fill="currentColor" />}
              {kissFlash.kind === 'no' && <X className="w-5 h-5" />}
              {kissFlash.kind === 'timeout' && <AlertTriangle className="w-5 h-5" />}
              {kissFlash.kind === 'yes' && `${kissFlash.name} said YES!`}
              {kissFlash.kind === 'no' && `${kissFlash.name} said no thanks`}
              {kissFlash.kind === 'timeout' && `${kissFlash.name} didn't answer`}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Chat drawer overlay (mobile only — desktop has the side panel) */}
        <AnimatePresence>
          {chatOpen && (
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 30 }}
              className="absolute inset-x-0 bottom-0 z-10 h-[60%] bg-[var(--qk-card)] border-t border-white/10 rounded-t-3xl flex flex-col md:hidden"
            >
              <div className="pt-2 pb-1 flex justify-center">
                <div className="w-10 h-1 rounded-full bg-white/20" />
              </div>
              <div className="px-4 pb-2 flex items-center justify-between">
                <h3 className="font-bold text-sm">Room Chat</h3>
                <button
                  onClick={() => setChatOpen(false)}
                  className="p-1.5 rounded-full bg-white/5 hover:bg-white/10"
                  aria-label="Close chat"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {chatMessages}
              <div className="shrink-0 border-t border-white/10 safe-area-bottom">{chatInput}</div>
            </motion.div>
          )}
        </AnimatePresence>
          </div>

          {/* Desktop: controls under the table */}
          <div className="hidden md:block shrink-0 border-t border-white/8 px-4 py-3">
            <div className="max-w-md mx-auto">{controls}</div>
          </div>
        </div>

        {/* RIGHT — room chat panel (desktop only) */}
        <aside className="hidden md:flex w-[360px] xl:w-[420px] shrink-0 flex-col border-l border-white/10 bg-[var(--qk-card)]/40">
          <div className="shrink-0 px-4 py-3 border-b border-white/10 flex items-center justify-between">
            <h3 className="font-bold text-sm">Room Chat</h3>
            <span className="text-[11px] text-white/40">{snapshot?.players.length ?? 0} in room</span>
          </div>
          {chatMessages}
          <div className="shrink-0 border-t border-white/10">{chatInput}</div>
        </aside>
      </div>

      {/* Mobile bottom controls: respond (if I'm the target) or watch */}
      <div className="shrink-0 border-t border-white/8 px-4 py-3 safe-area-bottom md:hidden">{controls}</div>

      {/* Exit confirmation */}
      <AnimatePresence>
        {showExit && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[200] bg-black/60"
              onClick={() => setShowExit(false)}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 30 }}
              className="fixed bottom-0 inset-x-0 z-[201] bg-[var(--qk-card)] border-t border-white/10 rounded-t-3xl p-4 pb-6 flex flex-col gap-3"
            >
              <div className="w-10 h-1 rounded-full bg-white/15 mx-auto" />
              <h3 className="text-base font-bold">Leave the room?</h3>
              <p className="text-sm text-white/60">You'll need to rejoin or find a new room to play again.</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowExit(false)}
                  className="flex-1 rounded-xl py-2.5 bg-white/5 border border-white/10 text-sm"
                >
                  Stay
                </button>
                <button
                  onClick={leave}
                  className="flex-1 rounded-xl py-2.5 bg-[#FF3B30] text-white text-sm font-semibold"
                >
                  Leave
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
