'use client'

// Quicky — Spin the Bottle room view
// Casual-game room on the APP theme background: HUD → quick actions → event
// banner → wooden stage (12 HTML/CSS seats hugging the table rim + centered
// bottle) → social-game chat feed. Polls /room every 1.5s (V1 realtime path
// — server-driven state is always read from the DB on each tick). Game logic
// lives here; presentation is split into Room* components +
// spin-bottle-room.css.
import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Heart, DoorOpen } from 'lucide-react'
import { toast } from 'sonner'
import { Capacitor } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'
import { api } from '@/lib/quicky/api-client'
import { useQuickyStore } from '@/store/quicky'
import { joinRoomChannel } from '@/lib/quicky/realtime'
import type { RoomChannel } from '@/lib/quicky/realtime'
import { RoomTopHud } from './RoomTopHud'
import { RoomQuickActions } from './RoomQuickActions'
import { RoomEventBanner, tonightEvent } from './RoomEventBanner'
import { RoomPlayerCard, type SeatPlayer } from './RoomPlayerCard'
import { RoomBottle } from './RoomBottle'
import { RoomChatPanel, type ChatPlayer, type RoomMessage } from './RoomChatPanel'
import './spin-bottle-room.css'

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

/* 12 fixed logical seat positions — percentages of the stage box.
   Each entry is the server's own seat vector (src/lib/quicky/spin-bottle.ts
   POSITIONS) scaled onto a 40%-radius (x) / 38%-radius (y) ellipse, so every
   card sits right at the SHARP EDGE of the wooden table while its center
   stays exactly on the ray the bottle points along (seat 0 = straight up).
   Seat k always renders at position k. */
const SEAT_POSITIONS: { x: number; y: number }[] = [
  { x: 50, y: 12 },    // 0 — top rim, center (server: straight up)
  { x: 16, y: 23.4 },  // 1 — upper-left rim
  { x: 12, y: 50 },    // 2 — left rim
  { x: 16, y: 76.6 },  // 3 — lower-left rim
  { x: 34, y: 88 },    // 4 — bottom rim, left of center
  { x: 66, y: 88 },    // 5 — bottom rim, right of center
  { x: 84, y: 76.6 },  // 6 — lower-right rim
  { x: 88, y: 50 },    // 7 — right rim
  { x: 84, y: 23.4 },  // 8 — upper-right rim
  { x: 66, y: 17.7 },  // 9 — top rim, right of center
  { x: 34, y: 17.7 },  // 10 — top rim, left of center
  { x: 50, y: 31 },    // 11 — inner seat on the same up-ray as 0 (server vector)
]

/* Deterministic backdrop particles (no SSR hydration mismatch). */
const PARTICLES = [
  { left: '6%', size: 14, delay: 0, dur: 11, char: '💗' },
  { left: '18%', size: 9, delay: 3.5, dur: 13, char: '✨' },
  { left: '31%', size: 12, delay: 6, dur: 12, char: '🤍' },
  { left: '45%', size: 8, delay: 1.6, dur: 14, char: '✨' },
  { left: '58%', size: 13, delay: 8.2, dur: 11.5, char: '💗' },
  { left: '70%', size: 9, delay: 4.4, dur: 13.5, char: '⭐' },
  { left: '83%', size: 12, delay: 2.4, dur: 12.5, char: '🤍' },
  { left: '93%', size: 10, delay: 7, dur: 12, char: '✨' },
]

export function SpinBottleRoom({
  roomId: initialRoomId,
  onClose,
}: {
  roomId: string
  onClose: () => void
}) {
  const me = useQuickyStore((s) => s.user)
  const meId = me?.id ?? ''
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [chat, setChat] = useState<RoomMessage[]>([])
  const [sendingChat, setSendingChat] = useState(false)
  const [showExit, setShowExit] = useState(false)
  const [responseCountdown, setResponseCountdown] = useState(RESPONSE_TIMEOUT)
  const [kissFlash, setKissFlash] = useState<{ kind: 'yes' | 'no' | 'timeout' | null; name: string }>({ kind: null, name: '' })
  const [displayedRotation, setDisplayedRotation] = useState({ start: 0, end: 0 })
  const [kbHeight, setKbHeight] = useState(0)
  const kbHeightRef = useRef(0)
  const stageRef = useRef<HTMLDivElement>(null)
  const [lockedStageHeight, setLockedStageHeight] = useState<number | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const spinStartTimeRef = useRef<number>(0)
  const roomChannelRef = useRef<RoomChannel | null>(null)

  // Keep a locked copy of the stage height so that, on engines that still
  // resize the layout when the keyboard shows (older WebViews / browsers
  // without `interactive-widget=resizes-visual` support), the table keeps its
  // full pre-keyboard size and the keyboard simply covers it. NEVER re-measure
  // while the keyboard is open — the stage would already be shrunk and we
  // would lock the wrong (shrunken) value.
  useEffect(() => {
    const measure = () => {
      const el = stageRef.current
      if (!el) return
      if (kbHeightRef.current > 0) return
      const h = el.offsetHeight
      if (h > 60) setLockedStageHeight(h)
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('orientationchange', measure)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('orientationchange', measure)
    }
  }, [])

  // Keyboard OVERLAY mode — the OS keyboard never resizes the page
  // (Capacitor config plugins.Keyboard.resize='none' on native; default
  // resizes-visual viewport on web), so the game table keeps its full size
  // and the keyboard simply covers the lower part of the screen. The chat
  // composer lifts itself above the keyboard through the --sbr-kb variable.
  useEffect(() => {
    const doc = document.documentElement
    const setKb = (px: number) => {
      kbHeightRef.current = px
      doc.style.setProperty('--sbr-kb', `${Math.round(px)}px`)
      setKbHeight(px)
    }

    // Web / safety net: derive keyboard height from the visual viewport.
    const vv = window.visualViewport ?? null
    const onVV = () => {
      if (!vv) return
      const kb = window.innerHeight - vv.height - vv.offsetTop
      setKb(Math.max(0, Math.min(kb, window.innerHeight * 0.6)))
    }
    vv?.addEventListener('resize', onVV)
    vv?.addEventListener('scroll', onVV)

    // Native (Capacitor): exact keyboard height from the Keyboard plugin.
    let handles: Awaited<ReturnType<typeof Keyboard.addListener>>[] = []
    if (Capacitor.isNativePlatform()) {
      Keyboard.addListener('keyboardWillShow', (i) => setKb(i.keyboardHeight ?? 0)).then((h) => {
        handles.push(h)
      })
      Keyboard.addListener('keyboardWillHide', () => setKb(0)).then((h) => {
        handles.push(h)
      })
    }

    return () => {
      vv?.removeEventListener('resize', onVV)
      vv?.removeEventListener('scroll', onVV)
      handles.forEach((h) => h.remove())
      setKb(0)
    }
  }, [])

  // Supabase Realtime — instant chat push for all room members
  useEffect(() => {
    if (!initialRoomId) return
    const ch = joinRoomChannel(initialRoomId, {
      onChat: (payload) => {
        const p = payload as any
        if (!p?.userId || (!p?.id && !p?.messageId)) return
        const msg: RoomMessage = {
          id: p.id || p.messageId || `rt_${Date.now()}`,
          userId: p.userId,
          text: p.text || '',
          kind: p.kind || 'user',
          createdAt: p.createdAt || new Date().toISOString(),
          replyTo: p.replyTo ?? null,
        }
        setChat((prev) => {
          // de-duplicate: replace optimistic tmp_ msg or skip if already present
          const withoutTmp = prev.filter(
            (m) => m.userId !== msg.userId || !m.id.startsWith('tmp_') || m.text !== msg.text
          )
          if (withoutTmp.some((m) => m.id === msg.id)) return withoutTmp
          return [...withoutTmp, msg]
        })
      },
    })
    roomChannelRef.current = ch
    return () => {
      ch?.unsubscribe()
      roomChannelRef.current = null
    }
  }, [initialRoomId])

  // Polling — V1 sync path (sequential: waits for the response before
  // scheduling the next tick so slow DB responses never stack up concurrent
  // requests, which was flooding the terminal in dev mode).
  useEffect(() => {
    if (!initialRoomId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const schedule = () => {
      if (!cancelled) timer = setTimeout(tick, 2500)
    }
    const tick = async () => {
      if (cancelled) return
      try {
        const res = await api.spinBottle.room(initialRoomId)
        if (!cancelled && res?.snapshot) applySnapshot(res.snapshot)
      } catch {
        // Silent: keep polling
      }
      schedule()
    }

    tick()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRoomId])


  // Apply snapshot, handling side effects for spin transitions
  const applySnapshot = useCallback((s: Snapshot) => {
    setSnapshot((prev) => {
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
      // Track spin start for the bottle
      if (s.currentSpin && (!prev?.currentSpin || prev.currentSpin.id !== s.currentSpin.id)) {
        spinStartTimeRef.current = Date.now()
        setDisplayedRotation({ start: s.currentSpin.startRotation, end: s.currentSpin.endRotation })
      } else if (!s.currentSpin && prev?.currentSpin) {
        setDisplayedRotation({ start: 0, end: 0 })
      }
      return s
    })
    // Update chat list — merge preserving optimistic/realtime items and replyTo
    setChat((prev) => {
      const prevMap = new Map(prev.map((m) => [m.id, m]))
      const merged = s.recentMessages.map((m) => {
        const existing = prevMap.get(m.id)
        return {
          ...m,
          replyTo: existing?.replyTo ?? null,
        }
      })
      const pendingOptimistic = prev.filter((m) => m.id.startsWith('tmp_'))
      return [...merged, ...pendingOptimistic]
    })
  }, [])

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

  const sendChat = async (t: string, replyTo?: RoomMessage['replyTo']) => {
    const text = t.trim()
    if (!text || sendingChat || !initialRoomId) return
    setSendingChat(true)
    // Optimistic insert
    const tmpId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const optimistic: RoomMessage = {
      id: tmpId,
      userId: meId,
      text,
      kind: 'user',
      createdAt: new Date().toISOString(),
      replyTo: replyTo ?? null,
    }
    setChat((prev) => [...prev, optimistic])
    try {
      const res = await api.spinBottle.sendChat(initialRoomId, text)
      if (res?.message) {
        const confirmed: RoomMessage = { ...res.message, replyTo: replyTo ?? null }
        // Broadcast to all other room members via Supabase Realtime
        roomChannelRef.current?.sendChat({
          id: confirmed.id,
          messageId: confirmed.id,
          userId: confirmed.userId,
          text: confirmed.text,
          kind: confirmed.kind,
          createdAt: confirmed.createdAt,
          replyTo: confirmed.replyTo,
        })
        setChat((prev) => {
          const without = prev.filter((m) => m.id !== tmpId)
          if (without.some((m) => m.id === confirmed.id)) return without
          return [...without, confirmed]
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

  // ─── Derived state ────────────────────────────────────────────────────────
  const currentSpin = snapshot?.currentSpin
  const status = currentSpin?.status ?? 'idle'
  const spinnerId = currentSpin?.spinnerId
  const targetId = currentSpin?.targetId
  const playerCount = snapshot?.players.length ?? 0

  const seatPlayers: SeatPlayer[] = (snapshot?.players ?? []).map((p) => ({
    userId: p.userId,
    seatIndex: p.seatIndex,
    displayName: p.displayName,
    avatar: p.avatar,
    isMe: p.userId === meId,
    isPremium: false,
    isCurrentTurn: status === 'spinning' && p.userId === spinnerId,
    isTarget: p.userId === targetId && status === 'awaiting',
  }))

  const chatPlayers: ChatPlayer[] = (snapshot?.players ?? []).map((p) => ({
    userId: p.userId,
    displayName: p.displayName,
    avatar: p.avatar,
  }))

  const targetName = snapshot?.players.find((p) => p.userId === targetId)?.displayName ?? '?'

  return (
    <div className="sbr-root absolute inset-0">
      {/* floating backdrop hearts/sparkles */}
      <div className="sbr-particles" aria-hidden>
        {PARTICLES.map((p, i) => (
          <span
            key={i}
            className="sbr-particle"
            style={{
              left: p.left,
              fontSize: p.size,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.dur}s`,
            }}
          >
            {p.char}
          </span>
        ))}
      </div>

      {/* Layer A — game HUD */}
      <RoomTopHud
        hearts={0}
        trophies={0}
        crowns={me?.isPremium ? 1 : 0}
        coins={989}
        onBack={() => setShowExit(true)}
      />

      {/* Layer A2 — quick actions toolbar */}
      <RoomQuickActions
        roomLabel={`Table #${initialRoomId.slice(-5).toUpperCase()} · ${playerCount}/${snapshot?.maxPlayers ?? 12}`}
      />

      {/* Layer A3 — event banner */}
      <RoomEventBanner event={tonightEvent()} />

      {/* Layer B — wooden game stage */}
      <div
        ref={stageRef}
        className="sbr-stage"
        style={
          kbHeight > 0 && lockedStageHeight
            ? {
                height: `${lockedStageHeight}px`,
                flex: `0 0 ${lockedStageHeight}px`,
                minHeight: `${lockedStageHeight}px`,
              }
            : undefined
        }
      >
        {seatPlayers.map((p, i) => {
          const pos = SEAT_POSITIONS[p.seatIndex] ?? { x: 50, y: 50 }
          return <RoomPlayerCard key={p.userId} player={p} x={pos.x} y={pos.y} joinedAt={i} />
        })}

        <RoomBottle
          startRotation={displayedRotation.start}
          endRotation={displayedRotation.end}
          duration={currentSpin?.duration ?? 3500}
          spinning={status === 'spinning'}
        />

        {/* status pill */}
        <div className="sbr-status">
          {status === 'spinning' && (
            <span>
              <span aria-hidden>🍾</span>{' '}
              {snapshot?.players.find((p) => p.userId === spinnerId)?.displayName ?? 'Someone'}'s turn — spinning…
            </span>
          )}
          {status === 'awaiting' && (
            <span>
              <span aria-hidden>🎯</span> Bottle points at {targetName}
            </span>
          )}
          {status === 'completed' && (
            <span>
              <span aria-hidden>✨</span> Round complete
            </span>
          )}
          {status === 'idle' && <span>Waiting for players…</span>}
        </div>

        {/* respond overlay — I'm the target */}
        {snapshot?.iAmTarget && status === 'awaiting' && (
          <div className="sbr-respond">
            <p className="sbr-respond-title">
              The bottle points at you! ⏱ <span className="sbr-respond-timer">{responseCountdown}s</span>
            </p>
            <div className="flex w-full items-center gap-2">
              <button className="sbr-btn-no" onClick={() => respond('no')}>
                <X className="h-4 w-4" strokeWidth={3} /> No Thanks
              </button>
              <button className="sbr-btn-yes" onClick={() => respond('yes')}>
                <Heart className="h-4 w-4" fill="currentColor" /> Kiss 💋
              </button>
            </div>
          </div>
        )}

        {/* result flash */}
        <AnimatePresence>
          {kissFlash.kind && (
            <motion.div
              key={kissFlash.kind}
              initial={{ opacity: 0, y: 14, scale: 0.7 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.9 }}
              transition={{ type: 'spring', stiffness: 340, damping: 22 }}
              className="sbr-result"
            >
              <span className="sbr-result-emoji" aria-hidden>
                {kissFlash.kind === 'yes' ? '💋' : kissFlash.kind === 'no' ? '😅' : '⌛'}
              </span>
              {kissFlash.kind === 'yes' && `${kissFlash.name} said YES!`}
              {kissFlash.kind === 'no' && `${kissFlash.name} said no thanks`}
              {kissFlash.kind === 'timeout' && `${kissFlash.name} didn't answer`}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Layer C — social-game chat feed */}
      <RoomChatPanel
        messages={chat}
        players={chatPlayers}
        meId={meId}
        onSend={sendChat}
        sending={sendingChat}
        kbOpen={kbHeight > 0}
      />

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
              className="sbr-sheet fixed inset-x-0 bottom-0 z-[201] p-4 pb-6 flex flex-col gap-3"
            >
              <div className="mx-auto h-1 w-10 rounded-full bg-white/20" />
              <h3 className="text-base font-black">Leave the room?</h3>
              <p className="text-sm font-semibold text-white/60">
                You&apos;ll need to rejoin or find a new table to play again.
              </p>
              <div className="flex gap-2">
                <button className="sbr-sheet-btn-stay" onClick={() => setShowExit(false)}>
                  Stay
                </button>
                <button className="sbr-sheet-btn-leave" onClick={leave}>
                  <span className="inline-flex items-center gap-1.5">
                    <DoorOpen className="h-4 w-4" /> Leave
                  </span>
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
