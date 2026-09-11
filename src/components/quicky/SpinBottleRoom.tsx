'use client'

// Quicky — Spin the Bottle room view ("Club Royale: Spin & Kiss") — PRD v2
//
// WEB (≥1024px): full-window layout — top bar (title + Live + economy chips),
// LEFT game column (event banner, wooden table with 12 mathematically-placed
// clock seats + dashed rings + corner status pills, bottom action bar) and
// RIGHT chat sidebar.
// MOBILE / Capacitor (<1024px): stacked HUD → event banner → table → bottom
// chat sheet with reactions.
//
// Round sync (PRD §2/§60): PRIMARY path is the SSE stream
// (/api/quicky/games/spin-bottle/stream) — the server pushes a fresh
// snapshot on every state-machine transition. Polling exists ONLY as a
// recovery path while the stream is down. The countdown derives from the
// server responseDeadline + serverNow skew (§29) — never a local 10s tick.
//
// Two-party round (§3/§27/§28): BOTH the spinner and the target answer
// ❤️ Kiss / 💔 No Thanks. First answer locks; the round resolves
// server-side and everyone sees MUTUAL KISS / PARTIAL KISS / FULL REJECTION
// with Kiss Point awards (§31).
//
// Duel animation (§22-§24/§32-§34): bottle stops → ~150ms settle → bottle
// fades out while the spinner+target cards (same DOM nodes, same React keys)
// slide to the math-derived center → response panel appears → result swaps
// in → cards slide back to their seats.
//
// Geometry (§10-§19/§75-§77): one shared engine (spin-geometry.ts) feeds the
// seat ring, duel positions, card size (from the MEASURED table, not vw) and
// the server's bottle landing angle — mathematically the same rays.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence, MotionConfig } from 'framer-motion'
import { X, Heart, DoorOpen, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Capacitor } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'
import { api } from '@/lib/quicky/api-client'
import { useQuickyStore } from '@/store/quicky'
import { joinRoomChannel } from '@/lib/quicky/realtime'
import type { RoomChannel } from '@/lib/quicky/realtime'
import { seatRingPositions, duelPositions, seatSizeFor } from '@/lib/quicky/spin-geometry'
import { RoomTopHud, RoomHudChips } from './RoomTopHud'
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
    kissPoints: number
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
    spinnerResponse: string | null
    targetResponse: string | null
    result: string | null
    responseDeadline: string | null
  } | null
  myTurnIndex: number
  myTurnIs: boolean
  iAmTarget: boolean
  iAmSpinner: boolean
  serverNow: number
  recentMessages: { id: string; userId: string; text: string; kind: string; createdAt: string }[]
}

// The 12-seat ring + duel spotlight — all derived from the shared geometry
// engine (PRD §48: no per-seat magic percentages anywhere).
const SEATS = seatRingPositions()
const DUEL = duelPositions()

const MAX_SEATS = 12
// Result reveal pacing (§32): reveal ~1.4s + return slide ~0.5s + idle beat.
const RESULT_VIEW_MS = 2600
// Settle beat between the bottle stopping and the cards sliding (§24).
const SETTLE_MS = 150

/** Copy for the round-status pills (corner pills on web, center pill on mobile). */
function statusCopy(status: string): { emoji: string; text: string } {
  switch (status) {
    case 'spinning':
      return { emoji: '⚡', text: 'Bottle is spinning…' }
    case 'awaiting':
      return { emoji: '🎯', text: 'Round decision' }
    case 'completed':
      return { emoji: '✨', text: 'Round complete' }
    default:
      return { emoji: '⏳', text: 'Waiting for players' }
  }
}

/* Empty-seat placeholder label — bottom-center seat is the Invite spot. */
function openSeatLabel(seatIndex: number) {
  return seatIndex === 6 ? 'Invite' : 'Open Seat'
}

export function SpinBottleRoom({
  roomId: initialRoomId,
  onClose,
}: {
  roomId: string
  onClose: () => void
}) {
  const me = useQuickyStore((s) => s.user)
  const meId = me?.id ?? ''
  // Room id lives in state so "Change Table" can swap rooms without a
  // remount of the whole app shell (§65).
  const [roomId, setRoomId] = useState(initialRoomId)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [chat, setChat] = useState<RoomMessage[]>([])
  const [sendingChat, setSendingChat] = useState(false)
  const [showExit, setShowExit] = useState(false)
  const [switching, setSwitching] = useState(false)
  // Duel spotlight presentation state — `dismissedSpinId` is the spin whose
  // result panel has been shown & dismissed (cards slide back); `myResponse`
  // is the optimistic answer of THIS client (the responder sees the result
  // instantly, before the stream confirms it).
  const [dismissedSpinId, setDismissedSpinId] = useState<string | null>(null)
  const [myResponse, setMyResponse] = useState<{ spinId: string; choice: 'yes' | 'no' } | null>(null)
  const [displayedRotation, setDisplayedRotation] = useState({ start: 0, end: 0 })
  const [settleDone, setSettleDone] = useState(true)
  const [kbHeight, setKbHeight] = useState(0)
  const kbHeightRef = useRef(0)
  const stageRef = useRef<HTMLDivElement>(null)
  const [stageBox, setStageBox] = useState({ w: 0, h: 0 })
  const [lockedStageHeight, setLockedStageHeight] = useState<number | null>(null)
  const [streamOk, setStreamOk] = useState(false)
  const [remaining, setRemaining] = useState(0)
  const spinStartTimeRef = useRef<number>(0)
  const roomChannelRef = useRef<RoomChannel | null>(null)
  // Server clock skew (ms) — remaining = deadline − (localNow + skew) (§29)
  const clockSkewRef = useRef(0)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  // Table-relative card sizing (PRD §15-§18): seat size derives from the
  // MEASURED stage box via the geometry engine — same ring proportions on a
  // 320px phone and a 4K monitor. The keyboard guard also applies: never
  // re-measure while the keyboard is open (the table must not shrink, §85).
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () => {
      if (kbHeightRef.current > 0) return
      const r = el.getBoundingClientRect()
      if (r.width > 40 && r.height > 40) setStageBox({ w: r.width, h: r.height })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('orientationchange', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('orientationchange', measure)
    }
  }, [])
  const seatSize = useMemo(() => seatSizeFor(stageBox.w, stageBox.h), [stageBox])

  // Keyboard OVERLAY mode — the OS keyboard never resizes the page
  // (Capacitor config plugins.Keyboard.resize='none' on native;
  // interactive-widget=resizes-visual on web), so the game table keeps its
  // full size and the keyboard simply covers the lower part of the screen.
  // The chat composer lifts itself above the keyboard via --sbr-kb.
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
    if (!roomId) return
    const ch = joinRoomChannel(roomId, {
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
  }, [roomId])

  // Apply snapshot, handling side effects for spin transitions
  const applySnapshot = useCallback((s: Snapshot) => {
    if (s.serverNow) clockSkewRef.current = s.serverNow - Date.now()
    setSnapshot((prev) => {
      // Track spin start for the bottle
      if (s.currentSpin && (!prev?.currentSpin || prev.currentSpin.id !== s.currentSpin.id)) {
        spinStartTimeRef.current = Date.now()
        setDisplayedRotation({ start: s.currentSpin.startRotation, end: s.currentSpin.endRotation })
        // A NEW spin invalidates any stale optimistic answer
        setMyResponse(null)
        setDismissedSpinId(null)
        // Cards must wait for the settle beat after the bottle stops (§24)
        setSettleDone(false)
        if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
        settleTimerRef.current = setTimeout(() => setSettleDone(true), SETTLE_MS)
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

  // ─── GAME-STATE SYNC — SSE stream is primary (PRD STEP 3) ────────────────
  useEffect(() => {
    if (!roomId) return
    let es: EventSource | null = null
    let cancelled = false
    try {
      es = new EventSource(`/api/quicky/games/spin-bottle/stream?roomId=${encodeURIComponent(roomId)}`)
      es.addEventListener('snapshot', (e) => {
        if (cancelled) return
        try {
          const snap = JSON.parse((e as MessageEvent).data) as Snapshot
          setStreamOk(true)
          applySnapshot(snap)
        } catch {}
      })
      es.addEventListener('room_gone', () => {
        if (!cancelled) toast('This table has closed — find a new one.')
      })
      es.onerror = () => {
        // EventSource auto-reconnects; flag down so the recovery poll resumes
        setStreamOk(false)
      }
    } catch {
      setStreamOk(false)
    }
    return () => {
      cancelled = true
      es?.close()
      setStreamOk(false)
    }
  }, [roomId, applySnapshot])

  // Recovery poll — runs ONLY while the stream is down (PRD §2/§63: polling
  // is a recovery mechanism, never the primary sync path).
  useEffect(() => {
    if (!roomId || streamOk) return
    let cancelled = false
    const tick = async () => {
      try {
        const res = await api.spinBottle.room(roomId)
        if (!cancelled && res?.snapshot) applySnapshot(res.snapshot)
      } catch {
        // Silent: keep recovering
      }
    }
    tick()
    const t = setInterval(tick, 3000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [roomId, streamOk, applySnapshot])

  // ─── Response countdown — derived from the SERVER deadline (PRD §29) ──────
  const currentSpinForTimer = snapshot?.currentSpin
  const awaiting = currentSpinForTimer?.status === 'awaiting'
  const deadlineMs = awaiting && currentSpinForTimer?.responseDeadline
    ? new Date(currentSpinForTimer.responseDeadline).getTime()
    : null
  useEffect(() => {
    if (deadlineMs == null) {
      setRemaining(0)
      return
    }
    const calc = () => {
      const left = Math.max(0, deadlineMs - (Date.now() + clockSkewRef.current))
      setRemaining(Math.ceil(left / 1000))
    }
    calc()
    const t = setInterval(calc, 250)
    return () => clearInterval(t)
  }, [deadlineMs])

  // ─── DUEL RESULT FLOW (§31/§32) ───────────────────────────────────────────
  // When the round completes, the result panel replaces the response panel for
  // RESULT_VIEW_MS, then the two spotlight cards slide back to their seats
  // and the bottle fades back in for the next round. The dismiss timer is
  // derived from the snapshot so it survives re-renders and stream refreshes.
  useEffect(() => {
    const spinId = snapshot?.currentSpin?.id
    if (snapshot?.currentSpin?.status !== 'completed' || !spinId) return
    if (dismissedSpinId === spinId) return
    const t = setTimeout(() => setDismissedSpinId(spinId), RESULT_VIEW_MS)
    return () => clearTimeout(t)
  }, [snapshot?.currentSpin?.id, snapshot?.currentSpin?.status, dismissedSpinId])

  const respond = async (choice: 'yes' | 'no') => {
    if (!snapshot?.currentSpin || !roomId) return
    if (!snapshot.iAmTarget && !snapshot.iAmSpinner) return
    const spinId = snapshot.currentSpin.id
    try {
      await api.spinBottle.respond(roomId, choice)
      // Optimistic: the responder sees the result immediately (the server has
      // already recorded it — respond() only succeeds when it was accepted).
      setMyResponse({ spinId, choice })
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to respond')
    }
  }

  const sendChat = async (t: string, replyTo?: RoomMessage['replyTo']) => {
    const text = t.trim()
    if (!text || sendingChat || !roomId) return
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
      const res = await api.spinBottle.sendChat(roomId, text)
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
    if (!roomId) return
    try {
      await api.spinBottle.leave(roomId)
    } catch {}
    onClose()
  }

  // Change Table (PRD §65): atomic leave → random join → load new state.
  // No intermediate blank screen — the new snapshot (returned by join) swaps
  // in while the table stays rendered.
  const changeTable = async () => {
    if (switching || !roomId) return
    if (iAmRoundParticipant) {
      toast('Finish the current round first.')
      return
    }
    setSwitching(true)
    try {
      try {
        await api.spinBottle.leave(roomId)
      } catch {}
      const res = await api.spinBottle.join()
      if (res?.roomId && res.roomId !== roomId) {
        useQuickyStore.getState().setSpinBottleRoomId(res.roomId)
        setSnapshot(null)
        setChat([])
        setDismissedSpinId(null)
        setMyResponse(null)
        setDisplayedRotation({ start: 0, end: 0 })
        setRoomId(res.roomId)
        if (res.snapshot) applySnapshot(res.snapshot)
        toast('Moved to a new table 🍾')
      } else {
        toast('No other table available right now — try again soon.')
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Could not switch tables')
    } finally {
      setSwitching(false)
    }
  }

  // ─── Derived state ────────────────────────────────────────────────────────
  const currentSpin = snapshot?.currentSpin
  const status = currentSpin?.status ?? 'idle'
  const spinnerId = currentSpin?.spinnerId
  const targetId = currentSpin?.targetId
  const playerCount = snapshot?.players.length ?? 0
  const roomLabel = `Table #${roomId.slice(-5).toUpperCase()}`
  const statusPill = statusCopy(status)
  const spinnerName = snapshot?.players.find((p) => p.userId === spinnerId)?.displayName ?? 'Someone'
  const targetName = snapshot?.players.find((p) => p.userId === targetId)?.displayName ?? '?'

  // Am I one of the two round participants? (Both answer — §28.) While my
  // participation window is open the room is locked for me (§9/§66).
  const iAmRoundParticipant =
    !!currentSpin &&
    (currentSpin.status === 'spinning' || currentSpin.status === 'awaiting') &&
    (snapshot?.iAmTarget || snapshot?.iAmSpinner || spinnerId === meId || targetId === meId)

  // Duel phase machine (presentation only — server state stays untouched):
  //   table   → normal play; bottle visible, everyone at their seat
  //   settle  → bottle stopped, brief beat before the slide (§24)
  //   duel    → bottle faded out, spinner+target slid to center, response UI
  //             (after MY choice the panel stays here showing the locked
  //              chip + "waiting for {other}" — §28/§59 — until the server
  //              resolves the round)
  //   result  → ONLY a server-completed round swaps in (❤️/💋/💔); then slide
  //             back. The optimistic response never renders a fake result.
  const duelPhase: 'table' | 'duel' | 'result' =
    status === 'awaiting'
      ? settleDone
        ? 'duel'
        : 'table'
      : status === 'completed' && dismissedSpinId !== currentSpin?.id
        ? 'result'
        : 'table'
  const dueling = duelPhase !== 'table'

  // ─── Two-party response derivation (§27/§28) ──────────────────────────────
  const iAmSpinner = !!snapshot?.iAmSpinner
  const iAmTarget = !!snapshot?.iAmTarget
  const iCanRespond = status === 'awaiting' && (iAmSpinner || iAmTarget)
  // Optimistic answer of THIS client (covers stream latency between tap and
  // the next snapshot) — never rendered as a result.
  const optimisticChoice =
    myResponse && currentSpin && myResponse.spinId === currentSpin.id
      ? myResponse.choice
      : null
  // My confirmed choice (server) or optimistic one — drives the locked chip
  // and disables the buttons after answering (§59: cannot change the answer).
  const myChoice: 'yes' | 'no' | null =
    status !== 'awaiting'
      ? null
      : iAmSpinner
        ? ((currentSpin?.spinnerResponse as 'yes' | 'no' | null) ?? optimisticChoice)
        : iAmTarget
          ? ((currentSpin?.targetResponse as 'yes' | 'no' | null) ?? optimisticChoice)
          : null
  const otherName = iAmSpinner ? targetName : spinnerName

  // ─── Result content (§31) ─────────────────────────────────────────────────
  const resultKind = status === 'completed' ? currentSpin?.result : null
  const sResp = (currentSpin?.spinnerResponse ?? 'timeout') as string
  const tResp = (currentSpin?.targetResponse ?? 'timeout') as string
  const choiceWord = (r: string) => (r === 'yes' ? '❤️ Kiss' : r === 'no' ? '💔 No Thanks' : "didn't answer")
  const actorWord = (name: string, r: string) =>
    r === 'timeout' ? `${name} didn't answer` : `${name} chose ${choiceWord(r)}`
  const kissedOne =
    resultKind === 'partial_kiss'
      ? sResp === 'yes'
        ? targetName
        : spinnerName
      : null
  const resultVisual = (() => {
    if (resultKind === 'mutual_kiss')
      return { emoji: '❤️', title: 'MUTUAL KISS', cls: 'mutual' }
    if (resultKind === 'partial_kiss')
      return { emoji: '💋', title: 'PARTIAL KISS', cls: 'partial' }
    if (resultKind === 'full_rejection')
      return { emoji: '💔', title: 'FULL REJECTION', cls: 'reject' }
    return { emoji: '⏳', title: 'No answer', cls: 'reject' }
  })()

  const seatPlayers: SeatPlayer[] = (snapshot?.players ?? []).map((p, i) => ({
    userId: p.userId,
    seatIndex: p.seatIndex,
    displayName: p.displayName,
    avatar: p.avatar,
    isMe: p.userId === meId,
    isPremium: false,
    isCurrentTurn: (status === 'spinning' || dueling) && p.userId === spinnerId,
    isTarget: p.userId === targetId && (status === 'awaiting' || dueling),
    joinedAt: i,
  }))

  // Every unoccupied seat renders as a dashed "Open Seat" / "Invite" slot —
  // same geometric centers as occupied seats (PRD §54).
  const takenSeats = new Set(seatPlayers.map((p) => p.seatIndex))
  const openSeats = Array.from({ length: MAX_SEATS }, (_, i) => i).filter((i) => !takenSeats.has(i))

  const chatPlayers: ChatPlayer[] = (snapshot?.players ?? []).map((p) => ({
    userId: p.userId,
    displayName: p.displayName,
    avatar: p.avatar,
  }))

  return (
    <MotionConfig reducedMotion="user">
      <div className="sbr-root absolute inset-0">
        {/* ═══ WEB top bar (hidden <1024px) — Club Royale header ═══ */}
        <header className="sbr-webtop safe-area-top sbr-d-only">
          <button className="sbr-round-btn" onClick={() => setShowExit(true)} aria-label="Leave room">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <span className="sbr-webtop-emoji" aria-hidden>🍾</span>
          <div className="sbr-webtop-title">
            <div className="sbr-webtop-line">
              <h1>Club Royale: Spin &amp; Kiss</h1>
              <span className="sbr-live"><i aria-hidden />Live</span>
            </div>
            <p className="sbr-webtop-sub">Casual Dating &amp; Friendship • {roomLabel}</p>
          </div>
          <div className="sbr-webtop-center">
            <RoomHudChips hearts={0} trophies={0} crowns={me?.isPremium ? 1 : 0} coins={989} />
          </div>
        </header>

        {/* ═══ MOBILE HUD (hidden ≥1024px) ═══ */}
        <div className="sbr-m-only">
          <RoomTopHud
            hearts={0}
            trophies={0}
            crowns={me?.isPremium ? 1 : 0}
            coins={989}
            onBack={() => setShowExit(true)}
          />
        </div>

        {/* ═══ Body: game column + chat ═══ */}
        <div className="sbr-body">
          <div className="sbr-gamecol">
            {/* Event banner */}
            <RoomEventBanner event={tonightEvent()} />

            {/* Wooden game stage — --seat-w is table-relative, set from the
                measured stage box by the geometry engine (PRD §15-§18) */}
            <div
              ref={stageRef}
              className="sbr-stage"
              style={{
                ...(seatSize ? ({ '--seat-w': `${seatSize}px` } as React.CSSProperties) : null),
                ...(kbHeight > 0 && lockedStageHeight
                  ? {
                      height: `${lockedStageHeight}px`,
                      flex: `0 0 ${lockedStageHeight}px`,
                      minHeight: `${lockedStageHeight}px`,
                    }
                  : undefined),
              } as React.CSSProperties}
            >
              {/* center guide rings */}
              <div className="sbr-ring sbr-ring-outer" aria-hidden />
              <div className="sbr-ring sbr-ring-inner" aria-hidden />

              {/* web corner status pills */}
              <div className="sbr-corner sbr-d-only" aria-hidden={status === 'idle'}>
                <span className={`sbr-corner-pill sbr-corner-status`}>
                  {statusPill.emoji} {statusPill.text}
                </span>
                {status === 'awaiting' && (
                  <span className="sbr-corner-pill sbr-corner-target">🎯 {targetName} Targeted</span>
                )}
              </div>

              {seatPlayers.map((p) => {
                const seatPos = SEATS[p.seatIndex] ?? { x: 50, y: 50 }
                // During the duel the spinner & target slide to the spotlight
                // center; everyone else stays pinned to their seat (§23).
                const inSpotlight = dueling && (p.userId === spinnerId || p.userId === targetId)
                const pos = inSpotlight
                  ? p.userId === spinnerId ? DUEL.spinner : DUEL.target
                  : seatPos
                return (
                  <RoomPlayerCard
                    key={p.userId}
                    player={p}
                    x={pos.x}
                    y={pos.y}
                    joinedAt={p.joinedAt}
                    spotlight={inSpotlight}
                  />
                )
              })}

              {/* open / invite seats */}
              {openSeats.map((seatIdx) => {
                const pos = SEATS[seatIdx]
                return (
                  <button
                    key={`open-${seatIdx}`}
                    className="sbr-open-seat"
                    style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                    onClick={() => toast('Invites are coming soon!')}
                    aria-label={openSeatLabel(seatIdx)}
                  >
                    <span className="sbr-open-box">
                      <span className="sbr-open-plus" aria-hidden>+</span>
                    </span>
                    <span className="sbr-open-label">
                      <span className="sbr-open-full">{openSeatLabel(seatIdx)}</span>
                      <span className="sbr-open-short">{seatIdx === 6 ? 'Invite' : 'Open'}</span>
                    </span>
                  </button>
                )
              })}

              <RoomBottle
                startRotation={displayedRotation.start}
                endRotation={displayedRotation.end}
                duration={currentSpin?.duration ?? 3500}
                spinning={status === 'spinning'}
                visible={duelPhase === 'table'}
              />

              {/* ═══ Bottle-anchored status (PRD §25) — lives UNDER the bottle
                  so bottle + status read as one presentation ═══ */}
              {duelPhase === 'table' && (
                <div className="sbr-bottle-status" aria-live="polite">
                  {status === 'spinning' && (
                    <>
                      <span className="sbr-bs-title"><span aria-hidden>🍾</span> BOTTLE</span>
                      <span className="sbr-bs-text">Bottle is spinning…</span>
                    </>
                  )}
                  {status === 'completed' && (
                    <span className="sbr-bs-text">✨ Round complete</span>
                  )}
                  {status === 'idle' && <span className="sbr-bs-text">Waiting for players…</span>}
                </div>
              )}

              {/* ═══ DUEL SPOTLIGHT — bottle stopped: the two cards slide to
                  the center, the bottle fades out, and the response / result
                  panel appears (§22-§24) ═══ */}
              <AnimatePresence>
                {dueling && status !== 'spinning' && (
                  <motion.div
                    key="duel-dim"
                    className="sbr-duel-dim"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.35 }}
                    aria-hidden
                  />
                )}
              </AnimatePresence>

              {dueling && status !== 'spinning' && (
                <div className="sbr-duel-anchor">
                  <AnimatePresence mode="wait">
                    {duelPhase === 'duel' ? (
                      <motion.div
                        key="duel-question"
                        className="sbr-duel-panel"
                        initial={{ opacity: 0, y: 20, scale: 0.82 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -14, scale: 0.9 }}
                        transition={{ type: 'spring', stiffness: 320, damping: 24 }}
                      >
                        <p className="sbr-duel-kicker">
                          <span aria-hidden>🎯</span> The bottle chose {targetName}
                        </p>
                        <p className="sbr-duel-question">Choose your response</p>
                        {iCanRespond && (
                          <span className="sbr-duel-timer">0:{String(Math.max(0, remaining)).padStart(2, '0')}s</span>
                        )}
                        <div className="sbr-duel-actions">
                          <button
                            className="sbr-btn-yes"
                            disabled={!iCanRespond || !!myChoice}
                            onClick={() => respond('yes')}
                          >
                            <Heart className="h-4 w-4" fill="currentColor" /> Kiss
                          </button>
                          <button
                            className="sbr-btn-no"
                            disabled={!iCanRespond || !!myChoice}
                            onClick={() => respond('no')}
                          >
                            <X className="h-4 w-4" strokeWidth={3} /> No Thanks
                          </button>
                        </div>
                        {iCanRespond && myChoice ? (
                          <p className="sbr-duel-locked">
                            ✓ Your response is locked — waiting for {otherName}…
                          </p>
                        ) : iCanRespond ? (
                          <p className="sbr-duel-waiting">Your response: Kiss or No Thanks</p>
                        ) : (
                          <p className="sbr-duel-waiting">
                            Waiting for {spinnerName} &amp; {targetName}…
                            {remaining > 0 ? ` 0:${String(Math.max(0, remaining)).padStart(2, '0')}` : ''}
                          </p>
                        )}
                      </motion.div>
                    ) : (
                      <motion.div
                        key={`duel-result-${currentSpin?.id}`}
                        className={`sbr-duel-panel sbr-duel-result sbr-res-${resultVisual.cls}`}
                        initial={{ opacity: 0, y: 20, scale: 0.82 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -14, scale: 0.9 }}
                        transition={{ type: 'spring', stiffness: 320, damping: 24 }}
                      >
                        <motion.span
                          className={`sbr-duel-emoji sbr-duel-emoji-${resultVisual.cls}`}
                          initial={{ scale: 0, rotate: -30 }}
                          animate={{ scale: 1, rotate: 0 }}
                          transition={{ type: 'spring', stiffness: 380, damping: 16 }}
                          aria-hidden
                        >
                          {resultVisual.emoji}
                        </motion.span>
                        <p className={`sbr-duel-verdict sbr-verdict-${resultVisual.cls}`}>{resultVisual.title}</p>
                        {resultKind === 'mutual_kiss' && (
                          <>
                            <p className="sbr-duel-sub">{spinnerName} ❤️ {targetName}</p>
                            <p className="sbr-duel-points">+1 Kiss Point each</p>
                          </>
                        )}
                        {resultKind === 'partial_kiss' && (
                          <>
                            <p className="sbr-duel-sub">
                              {actorWord(spinnerName, sResp)} · {actorWord(targetName, tResp)}
                            </p>
                            <p className="sbr-duel-points">+1 Kiss Point → {kissedOne}</p>
                          </>
                        )}
                        {resultKind === 'full_rejection' && (
                          <p className="sbr-duel-sub">
                            {(sResp === 'timeout' || tResp === 'timeout') && sResp !== tResp
                              ? `${sResp === 'timeout' ? spinnerName : targetName} didn't answer in time`
                              : 'Both said No Thanks'}
                          </p>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>

            {/* web bottom action bar (hidden <1024px) */}
            <div className="sbr-tablebar sbr-d-only">
              <button className="sbr-tablebar-btn" onClick={changeTable} disabled={switching}>
                <RefreshCw className={`h-3.5 w-3.5${switching ? ' animate-spin' : ''}`} /> Change Table
              </button>
              <div className="sbr-tablebar-status">
                <span className="sbr-tablebar-dot" aria-hidden />
                Table status: {statusPill.text}
              </div>
              <button className="sbr-tablebar-btn sbr-tablebar-gift" onClick={() => toast('Gifts are coming soon!')}>
                <span aria-hidden>🍷</span> Gift Wine
              </button>
            </div>
          </div>

          {/* Layer C — chat: bottom sheet on mobile, right sidebar on web */}
          <RoomChatPanel
            messages={chat}
            players={chatPlayers}
            meId={meId}
            onSend={sendChat}
            sending={sendingChat}
            kbOpen={kbHeight > 0}
          />
        </div>

        {/* Exit confirmation — locked while I'm in an active round (§66) */}
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
                <h3 className="text-base font-black">
                  {iAmRoundParticipant ? 'Round in progress' : 'Leave the room?'}
                </h3>
                <p className="text-sm font-semibold text-white/60">
                  {iAmRoundParticipant
                    ? 'Finish the current round first — the table is locked while you decide.'
                    : "You'll need to rejoin or find a new table to play again."}
                </p>
                <div className="flex gap-2">
                  <button className="sbr-sheet-btn-stay" onClick={() => setShowExit(false)}>
                    {iAmRoundParticipant ? 'Back to the round' : 'Stay'}
                  </button>
                  {!iAmRoundParticipant && (
                    <button className="sbr-sheet-btn-leave" onClick={leave}>
                      <span className="inline-flex items-center gap-1.5">
                        <DoorOpen className="h-4 w-4" /> Leave
                      </span>
                    </button>
                  )}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  )
}

