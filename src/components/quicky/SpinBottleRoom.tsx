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
import { useIsDesktopShell } from '@/hooks/useIsDesktopShell'
import { Keyboard } from '@capacitor/keyboard'
import { api } from '@/lib/quicky/api-client'
import { useQuickyStore } from '@/store/quicky'
import { useGameRoomStore } from '@/store/game-room'
import {
  calculateTableGeometry,
  deviceClassFor,
  CENTER_CARD_SCALE,
  DUEL_PANEL_ESTIMATE,
} from '@/lib/quicky/spin-geometry'
import { useRoundTimer } from '@/hooks/useRoundTimer'
import { useOptimisticResponse } from '@/hooks/useOptimisticResponse'
import { RoomTopHud, RoomHudChips, RoomExitControl } from './RoomTopHud'
import { RoomEventBanner } from './RoomEventBanner'
import { useRoomRealm } from './realm/useRoomRealm'
import { RoomPlayerCard, type SeatPlayer } from './RoomPlayerCard'
import { RoomBottle } from './RoomBottle'
import { RoomChatPanel, type ChatPlayer, type RoomMessage } from './RoomChatPanel'
import { useRoomContactsNav } from './useRoomContactsNav'
import { GameChatScreen } from './game-chat/GameChatScreen'
import { ChatView } from './ChatView'
import { useDatingUnread } from './game-hub/useDatingUnread'
import { GameContactsPanel } from './game-chat/GameContactsPanel'
import { useGameChatStore } from '@/store/game-chat'
import { CoinStoreSheet } from './CoinStoreSheet'
import { useRoomPlayerToolbox } from './room-toolbox/useRoomPlayerToolbox'
import './spin-bottle-room.css'

// The 12-seat ring + duel spotlight are derived per-measure from the shared
// geometry engine (PRD v2.1 §64 — calculateTableGeometry is the ONLY source).

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
      // Games PRD §13 — NEVER gendered wording; aggregate + neutral only.
      return { emoji: '⏳', text: 'Waiting for more players' }
  }
}

/* Empty-seat placeholder label — bottom-center seat is the Invite spot. */
function openSeatLabel(seatIndex: number) {
  return seatIndex === 6 ? 'Invite' : 'Open Seat'
}

// ─── SHARED GAME ROOM RUNTIME (game-chat PRD §5/§6) ─────────────────────────
// ALL game state (snapshot, chat, economy, optimistic response, closure) and
// ALL sync machinery (SSE, recovery poll, presence ping, realtime channel)
// live in useGameRoomStore — the runtime survives navigating away to Game
// Chat / profiles and both the table UI and the decision drawer consume it.
// This component is now purely PRESENTATION over the shared runtime.
export function SpinBottleRoom({
  roomId: initialRoomId,
  onClose,
}: {
  roomId: string
  onClose: () => void
}) {
  const me = useQuickyStore((s) => s.user)
  const meId = me?.id ?? ''
  // Runtime state (shared — survives navigation to chat/profile)
  const storeRoomId = useGameRoomStore((s) => s.roomId)
  const roomId = storeRoomId ?? initialRoomId
  const snapshot = useGameRoomStore((s) => s.snapshot)
  const chat = useGameRoomStore((s) => s.chat)
  const economy = useGameRoomStore((s) => s.economy)
  const closure = useGameRoomStore((s) => s.closure)
  const optimistic = useGameRoomStore((s) => s.optimistic)
  const bumpEconomy = useGameRoomStore((s) => s.bumpEconomy)
  const setCoinBalance = useGameRoomStore((s) => s.setCoinBalance)
  const getSkew = useGameRoomStore((s) => s.getSkew)
  // Bug-fix PRD §9: web sidebar chat-section state (room | contacts | personal)
  const roomChatPanel = useQuickyStore((s) => s.roomChatPanel)
  const setRoomChatPanel = useQuickyStore((s) => s.setRoomChatPanel)
  // Mentions §48: the bubble that mentions ME flashes briefly.
  const mentionFlashId = useGameRoomStore((s) => s.mentionFlashId)
  const gameChatsUnread = useGameChatStore((s) =>
    s.list.reduce((sum, c) => sum + c.unread, 0)
  )
  const [sendingChat, setSendingChat] = useState(false)
  const [showExit, setShowExit] = useState(false)
  const [switching, setSwitching] = useState(false)
  // Realm PRD §41/§71 — the shared realm HUD chip + event-banner queue.
  const { hudRealm, bannerEvents, openDetails } = useRoomRealm()
  // Duel spotlight presentation state — `dismissedSpinId` is the spin whose
  // result panel has been shown & dismissed (cards slide back).
  const [dismissedSpinId, setDismissedSpinId] = useState<string | null>(null)
  const [displayedRotation, setDisplayedRotation] = useState({ start: 0, end: 0 })
  const [settleDone, setSettleDone] = useState(true)
  const [kbHeight, setKbHeight] = useState(0)
  // ─── v3 state domains (§91): coin store, gift sheet, player interaction —
  // each isolated so a gift arriving never rebuilds the table.
  const [gamesPlayed, setGamesPlayed] = useState(0) // HUD 🏆 (DB-driven)
  const [showCoinStore, setShowCoinStore] = useState(false)
  // Web breakpoint (≥1024px) → popover interaction; below → bottom sheet (§82/§83)
  const [isDesktop, setIsDesktop] = useState(false)
  // Layout PRD §76: ONE platform check drives the chat-navigation split —
  // Capacitor uses the dedicated full-screen chat screens (§8), web uses the
  // in-room chat panel at every viewport width.
  const isNativeCapacitor = Capacitor.isNativePlatform()
  // Web Premium PRD §15/§17: on the desktop web shell, "Message" navigates
  // to the Chats experience (contacts stay visible on the left); below
  // 1024px web the in-room chat panel remains the chat surface.
  const isDeskShell = useIsDesktopShell() === true
  // Game Hub PRD §41/§53: lightweight poll for unread DATING messages —
  // the banner must not interrupt gameplay; tap Reply → dating chat while
  // the room runtime keeps running underneath (§44: nothing is reset).
  const datingUnread = useDatingUnread(true)
  const [datingBannerHidden, setDatingBannerHidden] = useState(false)
  const kbHeightRef = useRef(0)
  const stageRef = useRef<HTMLDivElement>(null)
  const [stageBox, setStageBox] = useState({ w: 0, h: 0 })
  const [lockedStageHeight, setLockedStageHeight] = useState<number | null>(null)
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

  // Table-relative card sizing (v2.1 §18-§25 + §64): ONE geometry contract
  // derives ring radii, collision/boundary-safe card size, duel positions —
  // from the MEASURED stage box. The keyboard guard applies: never re-measure
  // while the keyboard is open (the table must not shrink, §69).
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
  const geometry = useMemo(
    () => calculateTableGeometry({ width: stageBox.w, height: stageBox.h }),
    [stageBox]
  )
  const seatSize = geometry.cardSize
  const deviceClass = deviceClassFor(stageBox.w)
  // Center spotlight cards pop slightly larger (§32) but never overlap:
  // at 17% duel spacing the clearance between the two center cards stays
  // ≥ 46px even on a 320px table (verified in geometry QA).
  const centerCardSize = Math.round(seatSize * CENTER_CARD_SCALE)
  // §30: the response panel is DYNAMICALLY anchored just below the duel row
  // (which itself rises on short stages — see duelRowYFor) so the panel can
  // never cover the center cards. Never a fixed top/bottom percentage.
  const duelPanelTop = useMemo(() => {
    if (stageBox.h <= 0) return null
    const rowY = geometry.duelPositions.spinner.y
    const top = (rowY / 100) * stageBox.h + centerCardSize / 2 + 12
    // sanity clamp: the panel's estimated height must stay inside the stage
    return Math.max(0, Math.round(Math.min(top, stageBox.h - DUEL_PANEL_ESTIMATE - 20)))
  }, [stageBox.h, centerCardSize, geometry.duelPositions.spinner.y])

  // ─── Layout PRD §9/§48: the wake lock is owned by AppRoot for the WHOLE
  // game section — entering Game Chat / the contacts screen must not release
  // it (§9 forbids exactly that). This call site is intentionally gone. ───

  // Desktop breakpoint for the interaction popover (single listener, cheap)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const apply = () => setIsDesktop(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  // HUD 🏆 — real games-played from the DB (landing stats endpoint)
  useEffect(() => {
    let stopped = false
    api.spinBottle
      .landing()
      .then((s) => {
        if (!stopped) setGamesPlayed(s.gamesPlayed ?? 0)
      })
      .catch(() => {})
    return () => {
      stopped = true
    }
  }, [])

  // ─── RUNTIME ATTACH (game-chat PRD §5/§99) ──────────────────────────────
  // The shared runtime owns the SSE stream, recovery poll, presence ping and
  // realtime channel. attach() is idempotent — remounting this screen after
  // visiting Game Chat re-attaches to the SAME live runtime (no restart).
  useEffect(() => {
    useGameRoomStore.getState().attach(initialRoomId)
  }, [initialRoomId])

  // Sidebar chat panel resets when the room screen goes away — the next
  // visit starts on the Room Chat state (§9: room is the default panel).
  useEffect(() => {
    return () => {
      useQuickyStore.getState().setRoomChatPanel('room')
    }
  }, [])

  // ── Unified PRD §23/§24 — the ONE shared contacts navigation used by both
  // the "Game Chats" header button and the 💬 composer message button:
  // desktop web → embedded contacts panel; mobile / Capacitor → dedicated
  // full-screen contacts page. The room runtime never detaches (§21/§92).
  const openRoomContacts = useRoomContactsNav('spin-bottle-room')

  // ─── Spin-transition presentation (new spin / room swap) ─────────────────
  // The store resets its optimistic answer when a new spin id appears; this
  // effect drives the PRESENTATION side: bottle rotation target, the ~150ms
  // settle beat before the duel slide (§24) and the dismissed-result flag.
  const spinId = snapshot?.currentSpin?.id ?? null
  useEffect(() => {
    if (!roomId) return
    setDismissedSpinId(null)
    const spin = snapshot?.currentSpin
    if (spin) {
      setDisplayedRotation({ start: spin.startRotation, end: spin.endRotation })
      setSettleDone(false)
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
      settleTimerRef.current = setTimeout(() => setSettleDone(true), SETTLE_MS)
    } else {
      setDisplayedRotation({ start: 0, end: 0 })
      setSettleDone(true)
    }
     
  }, [roomId, spinId])

  // ─── Keyboard OVERLAY mode (v3 — sheet ride) ──────────────────────────
  // While the soft keyboard is up:
  //   · --sbr-kb      → the chat sheet translates up over the table (CSS
  //                     .sbr-chat.sbr-kb-open) — the message area OVERLAYS
  //                     the table instead of resizing it.
  //   · --sbr-room-h  → the room root pins to the last keyboard-free
  //                     layout height, so a webview that resizes its LAYOUT
  //                     viewport (resizes-content / old Capacitor APKs)
  //                     can never shrink the table to make room.
  // The unified formula (stableInner − visible area) works in BOTH resize
  // modes: in resizes-visual stableInner == innerHeight (classic formula);
  // in resizes-content innerHeight already shrank, so the stable baseline
  // still yields the true keyboard height. Native Capacitor overrides with
  // the plugin's exact pixel height either way.
  useEffect(() => {
    const doc = document.documentElement
    let stableInner = window.innerHeight // last keyboard-free layout height
    const setKb = (px: number) => {
      const h = Math.max(0, px)
      kbHeightRef.current = h
      doc.style.setProperty('--sbr-kb', `${Math.round(h)}px`)
      if (h > 0) {
        doc.style.setProperty('--sbr-room-h', `${Math.round(stableInner)}px`)
      } else {
        doc.style.removeProperty('--sbr-room-h')
      }
      setKbHeight(h)
    }

    // Web / safety net: derive keyboard height from the visual viewport.
    const vv = window.visualViewport ?? null
    const onVV = () => {
      if (!vv) return
      const kb = stableInner - (vv.height + vv.offsetTop)
      setKb(Math.min(kb, stableInner * 0.6))
    }
    vv?.addEventListener('resize', onVV)
    vv?.addEventListener('scroll', onVV)

    // Track the keyboard-free layout height (rotation, browser chrome,
    // desktop window resize) — never while a keyboard is up, so the pin
    // baseline can never absorb the keyboard's own shrink.
    const onResize = () => {
      if (kbHeightRef.current === 0) {
        stableInner = window.innerHeight
        doc.style.removeProperty('--sbr-room-h')
      }
    }
    window.addEventListener('resize', onResize)

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
      window.removeEventListener('resize', onResize)
      handles.forEach((h) => h.remove())
      setKb(0)
    }
  }, [])

  // Supabase room realtime channel + SSE + recovery poll + presence ping now
  // live in the shared runtime (useGameRoomStore.attach above).

  // ─── Response countdown — derived from the SERVER deadline (§29/§34-§40).
  // The hook owns everything: 250ms ticks, hard stop at exactly 0, a short
  // "Time's up" beat, and no negative values — ever.
  const currentSpinForTimer = snapshot?.currentSpin
  const awaiting = currentSpinForTimer?.status === 'awaiting'
  const deadlineMs = awaiting && currentSpinForTimer?.responseDeadline
    ? new Date(currentSpinForTimer.responseDeadline).getTime()
    : null
  const { remaining, expired, timeUp } = useRoundTimer(deadlineMs, getSkew)

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

  // ─── Round response (§4-§13 + game-chat PRD §38/§110): the SHARED action.
  // Both the table UI and the off-screen decision drawer call exactly this —
  // one optimistic flip, one respond API, one set of guards.
  const respond = (choice: 'yes' | 'no') => {
    useGameRoomStore.getState().respond(choice)
  }

  // ─── KISS POINT HEART FX (bug-fix PRD §44-§47) ───────────────────────────
  // The authoritative kissPoints arrive via the SSE snapshot (§47 — the
  // server value IS the reconciliation; no double increment). When it goes
  // up, animate a heart from the table area toward the top HUD and pulse
  // the HUD — pure presentation, never gameplay-interfering (§46).
  const prevKissRef = useRef(economy.kissPoints)
  const [heartFxKey, setHeartFxKey] = useState(0)
  useEffect(() => {
    if (economy.kissPoints > prevKissRef.current) {
      setHeartFxKey((k) => k + 1)
    }
    prevKissRef.current = economy.kissPoints
  }, [economy.kissPoints])

  const sendChat = async (
    t: string,
    replyTo?: RoomMessage['replyTo'],
    mentions?: { userId: string; displayName: string }[]
  ) => {
    if (sendingChat) return
    setSendingChat(true)
    try {
      await useGameRoomStore.getState().sendChat(t, replyTo, mentions)
    } finally {
      setSendingChat(false)
    }
  }

  // duelPhase in a ref so the seat click handler never goes stale (§85)
  const duelPhaseRef = useRef<'table' | 'duel' | 'result'>('table')

  // Room members as the toolbox sees them (§19/§66: the snapshot IS the
  // authoritative membership — gifts, ghost cleanup, @ picker all read this).
  const chatPlayers = (snapshot?.players ?? []).map((p) => ({
    userId: p.userId,
    displayName: p.displayName,
    avatar: p.avatar,
    gender: p.gender as string | null | undefined,
    seatIndex: p.seatIndex as number | undefined,
    // Room-chat settings: players with mentions OFF lose the Mention action.
    mentionDisabled: p.mentionsEnabled === false,
  }))

  // ─── THE SHARED PLAYER TOOLBOX (v3 §40-§46 REVISED — game-agnostic) ─────
  // One hook for EVERY room game: mention / personal chat / gift / add
  // friend / profile + the gift sheet, relationship layer, ghost cleanup
  // and the optimistic gift economy. The Spin room only contributes its own
  // specifics: the duel-spotlight guard and the seat-anchored popover.
  const toolbox = useRoomPlayerToolbox({
    roomId,
    meId,
    members: chatPlayers,
    coinBalance: economy.coinBalance,
    mode: isDesktop ? 'popover' : 'sheet',
    returnView: 'spin-bottle-room',
    onCoinBalance: setCoinBalance,
    onReconcile: () => void useGameRoomStore.getState().reconcile(),
    onOpenCoinStore: () => setShowCoinStore(true),
    // §85: while a duel is on stage the interaction stays disabled — it must
    // never interfere with the round or cover the center cards.
    beforeOpen: () =>
      duelPhaseRef.current !== 'table'
        ? 'Wait for the round to finish — the spotlight is busy ✨'
        : null,
    resolveAnchor: (el) => {
      const card = el?.getBoundingClientRect() ?? null
      const stage = stageRef.current?.getBoundingClientRect() ?? null
      return card && stage ? { card, stage } : null
    },
  })

  // Seat tap → toolbox (§84 popover anchor from the tapped card's real rect).
  const openInteraction = (p: SeatPlayer, cardEl: HTMLElement | null) => {
    toolbox.open({ userId: p.userId, displayName: p.displayName, avatar: p.avatar }, cardEl)
  }

  // ── Open the room-options sheet (mobile/Capacitor exit fix).
  // Capacitor runs KeyboardResize.None — the keyboard OVERLAYS the WebView,
  // so an open keyboard would sit ON TOP of the bottom sheet and swallow
  // the Leave / Move buttons ("the exit button does nothing"). Clear the
  // focus + hide the native keyboard FIRST, then slide the sheet up.
  const openExit = () => {
    try {
      ;(document.activeElement as HTMLElement | null)?.blur?.()
    } catch {}
    if (isNativeCapacitor) void Keyboard.hide().catch(() => {})
    setShowExit(true)
  }

  // Leave ALWAYS lands the user out of the room, INSTANTLY: the runtime
  // detaches and the view navigates BEFORE the server call resolves (the
  // hardware-back path in AppRoot already uses this exact pattern). On a
  // slow/stalled mobile connection the old `await` kept the user trapped in
  // the room after the sheet closed; now the leave request runs in the
  // background and the room-sweep job mops up any stale membership if it
  // never lands.
  const leave = () => {
    if (!roomId) return
    useGameRoomStore.getState().detach()
    onClose()
    void api.spinBottle.leave(roomId).catch(() => {})
  }

  // Change Table (Games PRD §9): ONE server call — the server runs the exact
  // same gender-aware assignment algorithm as Play Now (excluding this room)
  // and returns the new snapshot. The client never decides the assignment.
  // No intermediate blank screen — the new snapshot swaps in while the table
  // stays rendered. Round participants may switch: the server cancels the
  // round safely (PRD §14-§17).
  const changeTable = async () => {
    if (switching || !roomId) return
    setSwitching(true)
    try {
      const res = await api.spinBottle.changeTable(roomId)
      if (res?.roomId && res.roomId !== roomId) {
        useQuickyStore.getState().setSpinBottleRoomId(res.roomId)
        // attach() resets the runtime state (snapshot/chat/optimistic/closure)
        // for the new room; the presentation effect below re-syncs the
        // rotation/settle/dismissed flags from the roomId change.
        useGameRoomStore.getState().attach(res.roomId)
        toast('Moved to a new table 🍾')
      } else if (res?.roomId) {
        // Server kept us (no other valid table) — a fresh room was created
        // for us or we re-seated; sync the snapshot either way.
        useGameRoomStore.getState().attach(res.roomId)
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
  // Keep the interaction guard (§85) in sync without re-binding handlers
  duelPhaseRef.current = duelPhase

  // ─── Two-party response derivation (§27/§28) ──────────────────────────────
  const iAmSpinner = !!snapshot?.iAmSpinner
  const iAmTarget = !!snapshot?.iAmTarget
  const iCanRespond = status === 'awaiting' && (iAmSpinner || iAmTarget)
  // Optimistic answer of THIS client (v2.1 §6: set the instant the finger
  // lifts — never gated on the network) — never rendered as a result.
  const optimisticChoice =
    optimistic && currentSpin && optimistic.spinId === currentSpin.id
      ? optimistic.choice
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

  // ─── Singleton-room countdown hint (lifecycle §5/§6/§10): while the room
  // has exactly one player, show a gentle "this table closes in mm:ss".
  // The deadline is the SERVER timestamp (singletonStartedAt + 5 min) read
  // through the server-clock skew — the client never owns the timer.
  const [nowTick, setNowTick] = useState(Date.now())
  const alone = playerCount === 1 && !currentSpin
  useEffect(() => {
    if (!alone) return
    const t = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(t)
  }, [alone])
  const singletonCloseInMs =
    alone && snapshot?.singletonStartedAt
      ? new Date(snapshot.singletonStartedAt).getTime() + 5 * 60_000 - (nowTick + getSkew())
      : null
  const singletonCloseLabel =
    singletonCloseInMs == null
      ? null
      : `${Math.max(0, Math.floor(singletonCloseInMs / 60000))}:${String(
          Math.max(0, Math.floor(singletonCloseInMs / 1000)) % 60
        ).padStart(2, '0')}`

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

  return (
    <MotionConfig reducedMotion="user">
      <div className="sbr-root absolute inset-0">
        {/* ═══ KISS POINT heart FX (bug-fix PRD §45/§46) — a heart flies from
            the table toward the top HUD while the HUD pulses once. ═══ */}
        <AnimatePresence>
          {heartFxKey > 0 && (
            <motion.div
              key={`heart-fly-${heartFxKey}`}
              className="sbr-heart-fly"
              initial={{ opacity: 0, scale: 0.4, y: 0 }}
              animate={{ opacity: [0, 1, 1, 0], scale: [0.4, 1.35, 1, 0.9], y: [-10, -60, -140, -240] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.72, ease: 'easeOut' }}
              onAnimationComplete={() => setHeartFxKey(0)}
              aria-hidden
            >
              ❤️
            </motion.div>
          )}
        </AnimatePresence>
        {heartFxKey > 0 && (
          <span key={`heart-pulse-${heartFxKey}`} className="sbr-heart-pulse" aria-hidden />
        )}
        {/* ═══ WEB top bar (hidden <1024px) — Club Royale header (§78) ═══ */}
        <header className="sbr-webtop safe-area-top sbr-d-only">
          <span className="sbr-webtop-emoji" aria-hidden>🍾</span>
          <div className="sbr-webtop-title">
            <div className="sbr-webtop-line">
              <h1>Club Royale: Spin &amp; Kiss</h1>
              <span className="sbr-live"><i aria-hidden />Live</span>
            </div>
            <p className="sbr-webtop-sub">Casual Dating &amp; Friendship • {roomLabel}</p>
          </div>
          <div className="sbr-webtop-center">
            <RoomHudChips
              hearts={economy.kissPoints}
              trophies={gamesPlayed}
              crowns={me?.isPremium ? 1 : 0}
              gifts={economy.giftsReceived}
              coins={economy.coinBalance}
              onAddCoins={() => setShowCoinStore(true)}
              realm={hudRealm}
              onRealm={openDetails}
            />
          </div>
          {/* §31/§32: the room's only control — leave/change room, top-right */}
          <RoomExitControl onClick={openExit} />
        </header>

        {/* ═══ MOBILE HUD (hidden ≥1024px) — no back arrow (§31) ═══ */}
        <div className="sbr-m-only">
          <RoomTopHud
            hearts={economy.kissPoints}
            trophies={gamesPlayed}
            crowns={me?.isPremium ? 1 : 0}
            gifts={economy.giftsReceived}
            coins={economy.coinBalance}
            onRoomOptions={openExit}
            onAddCoins={() => setShowCoinStore(true)}
            realm={hudRealm}
            onRealm={openDetails}
          />
        </div>

        {/* ═══ Body: game column + chat ═══ */}
        <div className="sbr-body">
          <div className="sbr-gamecol">
            {/* Event banner */}
            <RoomEventBanner events={bannerEvents} />

            {/* Game Hub PRD §41/§53 — non-blocking DATING message banner.
                The game continues underneath; Reply opens the dating chat
                (web: inside the right chat panel / desktop Chats page,
                mobile: full screen with back to THIS live room, §82). */}
            {datingUnread && !datingBannerHidden && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mx-2 mb-2 rounded-2xl border border-[var(--qk-accent)]/30 bg-[var(--qk-card)]/90 backdrop-blur px-3 py-2.5 flex items-center gap-3"
                data-testid="dating-message-banner"
              >
                <span className="shrink-0 text-lg" aria-hidden>💗</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black text-white truncate">
                    New Dating Message — {datingUnread.name}
                  </p>
                  <p className="text-[11px] text-white/60 truncate">{datingUnread.preview}</p>
                </div>
                <button
                  onClick={() => {
                    const qk = useQuickyStore.getState()
                    qk.clearUnreadForMatch(datingUnread.matchId)
                    qk.setActiveMatchId(datingUnread.matchId)
                    if (isNativeCapacitor) {
                      qk.openChat(datingUnread.matchId, 'spin-bottle-room')
                    } else if (isDeskShell) {
                      qk.openChats('dating')
                    } else {
                      qk.setRoomChatPanel('dating')
                    }
                  }}
                  className="shrink-0 rounded-full bg-coral-gradient px-3.5 py-1.5 text-[11px] font-black text-white active:scale-95 transition-transform"
                  data-testid="dating-banner-reply"
                >
                  Reply
                </button>
                <button
                  onClick={() => setDatingBannerHidden(true)}
                  className="shrink-0 text-white/40 hover:text-white/80 text-xs px-1"
                  aria-label="Dismiss"
                >
                  ✕
                </button>
              </motion.div>
            )}

            {/* Wooden game stage — --seat-w is table-relative, set from the
                measured stage box by the geometry engine (v2.1 §18-§25).
                --duel-top anchors the response panel BELOW the center cards;
                --ring-rx/--ring-ry keep the dashed guide rings on the exact
                seat ellipse for the active device class. */}
            <div
              ref={stageRef}
              className="sbr-stage"
              style={{
                ...(seatSize ? ({ '--seat-w': `${seatSize}px` } as React.CSSProperties) : null),
                ...(duelPanelTop != null
                  ? ({ '--duel-top': `${duelPanelTop}px` } as React.CSSProperties)
                  : null),
                ...({
                  '--ring-rx': `${geometry.radiusX}%`,
                  '--ring-ry': `${geometry.radiusY}%`,
                } as React.CSSProperties),
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
                {alone && singletonCloseLabel && (
                  <span className="sbr-corner-pill" title="This table closes if nobody joins">
                    ⏳ Closes in {singletonCloseLabel}
                  </span>
                )}
              </div>

              {seatPlayers.map((p) => {
                const seatPos = geometry.seats[p.seatIndex] ?? { x: 50, y: 50 }
                // During the duel the spinner & target slide to the spotlight
                // center; everyone else stays pinned to their seat (§23).
                const inSpotlight = dueling && (p.userId === spinnerId || p.userId === targetId)
                const pos = inSpotlight
                  ? p.userId === spinnerId
                    ? geometry.duelPositions.spinner
                    : geometry.duelPositions.target
                  : seatPos
                return (
                  <RoomPlayerCard
                    key={p.userId}
                    player={p}
                    x={pos.x}
                    y={pos.y}
                    joinedAt={p.joinedAt}
                    spotlight={inSpotlight}
                    // gifting-revision: OWN seat is tappable too — the
                    // toolbox opens in self mode (Gift yourself + View
                    // Profile). Only the duel spotlight still guards it (§85).
                    interactive={!dueling}
                    onTap={(el) => openInteraction(p, el)}
                  />
                )
              })}

              {/* open / invite seats */}
              {openSeats.map((seatIdx) => {
                const pos = geometry.seats[seatIdx]
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
                  {status === 'idle' && (
                    <>
                      <span className="sbr-bs-text">Waiting for more players</span>
                      {snapshot && !snapshot.canSpin && snapshot.players.length > 1 && (
                        <span className="sbr-bs-sub">The game will start when another player joins.</span>
                      )}
                    </>
                  )}
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
                        {/* §39: countdown while counting, a short "Time's up"
                            beat at zero, then it disappears — never 0:00 forever,
                            never negative (hook guarantees the stop). */}
                        {iCanRespond && !expired && remaining > 0 && (
                          <span className="sbr-duel-timer">0:{String(remaining).padStart(2, '0')}s</span>
                        )}
                        {iCanRespond && timeUp && (
                          <span className="sbr-duel-timer sbr-timer-up">Time&#39;s up</span>
                        )}
                        <div className="sbr-duel-actions">
                          <button
                            className={`sbr-btn-yes${myChoice === 'yes' ? ' sbr-btn-chosen' : ''}`}
                            disabled={!iCanRespond || !!myChoice}
                            onClick={() => respond('yes')}
                          >
                            <Heart className="h-4 w-4" fill="currentColor" /> {myChoice === 'yes' ? 'Kiss ✓' : 'Kiss'}
                          </button>
                          <button
                            className={`sbr-btn-no${myChoice === 'no' ? ' sbr-btn-chosen' : ''}`}
                            disabled={!iCanRespond || !!myChoice}
                            onClick={() => respond('no')}
                          >
                            <X className="h-4 w-4" strokeWidth={3} /> {myChoice === 'no' ? 'No Thanks ✓' : 'No Thanks'}
                          </button>
                        </div>
                        {iCanRespond && myChoice ? (
                          <p className="sbr-duel-locked">
                            ✓ Waiting for {otherName}…
                          </p>
                        ) : iCanRespond ? (
                          <p className="sbr-duel-waiting">Your response: Kiss or No Thanks</p>
                        ) : (
                          <p className="sbr-duel-waiting">
                            Waiting for {spinnerName} &amp; {targetName}…
                            {remaining > 0 ? ` 0:${String(remaining).padStart(2, '0')}` : timeUp ? " — time's up" : ''}
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
                            <p className="sbr-duel-points">+1 Game Point each</p>
                          </>
                        )}
                        {resultKind === 'partial_kiss' && (
                          <>
                            <p className="sbr-duel-sub">
                              {actorWord(spinnerName, sResp)} · {actorWord(targetName, tResp)}
                            </p>
                            <p className="sbr-duel-points">+1 Game Point → {kissedOne}</p>
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
                {alone && singletonCloseLabel && (
                  <span className="text-white/50"> · closes in {singletonCloseLabel}</span>
                )}
              </div>
              <button className="sbr-tablebar-btn sbr-tablebar-gift" onClick={toolbox.openGiftSheet}>
                <span aria-hidden>🎁</span> Send a Gift
              </button>
            </div>
          </div>

          {/* Layer C — THE chat shell (mentions PRD §4/§74/§99/§100/§118).
              One panel, three states: Room Chat | Game Contacts | Personal
              Game Chat. contacts/personal render as NORMAL CHILDREN of the
              panel — no absolute overlay, no z-index tricks, and the game
              table is completely outside this state machine (§118). Room
              Chat stays MOUNTED inside the shell (display:none) so its
              scroll survives the personal → contacts → room round-trip
              (§15/§16/§17); messages keep arriving via the shared runtime
              either way (§13/§65).

              Unified PRD §23/§24 — ONE shared contacts navigation (the
              "Game Chats" header button AND the composer message button):
              desktop web → embedded contacts panel (bottle stays spinning);
              mobile / Capacitor → dedicated full-screen contacts page. The
              old desktop-shell openChats('game') full-page branch is GONE. */}
          <RoomChatPanel
            messages={chat}
            players={chatPlayers}
            meId={meId}
            roomId={roomId}
            onSend={sendChat}
            onSendSticker={(s, r) => void useGameRoomStore.getState().sendSticker(s, r)}
            sending={sendingChat}
            kbOpen={kbHeight > 0}
            onOpenGifts={toolbox.openGiftSheet}
            onOpenGameChats={openRoomContacts}
            gameChatsUnread={gameChatsUnread}
            panel={roomChatPanel}
            panelContent={
              !isNativeCapacitor && roomChatPanel === 'contacts' ? (
                <GameContactsPanel />
              ) : !isNativeCapacitor && roomChatPanel === 'personal' ? (
                <GameChatScreen embedded visible={roomChatPanel === 'personal'} onBack={() => setRoomChatPanel('contacts')} />
              ) : !isNativeCapacitor && roomChatPanel === 'dating' ? (
                <ChatView embedded onBack={() => setRoomChatPanel('contacts')} />
              ) : null
            }
            mentionFlashId={mentionFlashId}
            onMentionFlashDone={() => useGameRoomStore.getState().setMentionFlash(null)}
          />
        </div>

        {/* ═══ Games PRD §34-§39/§14-§17 — ROOM OPTIONS. Leaving ALWAYS works:
            if a round is in flight the server cancels it safely (§17) — no
            more 409 lock. Cancel always works too. z-[240/241]: the room's
            CONTROL surfaces stay above the transient in-game alert drawers
            (225-232) so an alert can never block leaving. */}
        <AnimatePresence>
          {showExit && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[240] bg-black/60"
                onClick={() => setShowExit(false)}
              />
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', stiffness: 320, damping: 30 }}
                className="sbr-sheet fixed inset-x-0 bottom-0 z-[241] mx-auto max-w-md p-4 sbr-sheet-safe flex flex-col gap-3"
              >
                <div className="mx-auto h-1 w-10 rounded-full bg-white/20" />
                <h3 className="text-base font-black">Room options</h3>
                {iAmRoundParticipant && (
                  <p className="text-sm font-semibold text-amber-300/90 -mt-1">
                    Round in progress — leaving cancels the round for everyone.
                  </p>
                )}
                <button
                  className="sbr-sheet-btn-stay w-full justify-center"
                  disabled={switching}
                  onClick={async () => {
                    setShowExit(false)
                    await changeTable()
                  }}
                >
                  <RefreshCw className={`h-4 w-4${switching ? ' animate-spin' : ''}`} />
                  {switching ? 'Finding a table…' : 'Move to Random Room'}
                </button>
                <button
                  className="sbr-sheet-btn-leave w-full justify-center"
                  disabled={switching}
                  onClick={() => {
                    setShowExit(false)
                    void leave()
                  }}
                >
                  <DoorOpen className="h-4 w-4" /> Leave Room
                </button>
                <button
                  className="text-sm font-semibold text-white/60 hover:text-white py-2"
                  onClick={() => setShowExit(false)}
                >
                  Cancel
                </button>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* ═══ Room-lifecycle closure dialog (lifecycle PRD §27/§28/§29).
            Shown when the SERVER deletes this room — empty sweep, 5-minute
            singleton rule, inactivity removal, or manual close. The player
            always gets a clean way back; never a raw error or a ghost table. */}
        <AnimatePresence>
          {closure && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[242] bg-black/85 backdrop-blur-sm"
              />
              <motion.div
                initial={{ scale: 0.92, opacity: 0, y: 12 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 24 }}
                className="fixed inset-x-0 top-1/2 z-[243] mx-auto w-[min(92vw,24rem)] -translate-y-1/2 bg-[var(--qk-card)] border border-white/10 rounded-3xl p-6 text-center flex flex-col items-center gap-3"
              >
                <div className="text-4xl" aria-hidden>
                  {closure.reason === 'inactivity' ? '😴' : '🔒'}
                </div>
                <h2 className="text-xl font-black tracking-wide">ROOM CLOSED</h2>
                <p className="text-sm text-white/60 leading-relaxed">
                  {closure.reason === 'inactivity'
                    ? 'You were removed from the room due to inactivity.'
                    : closure.reason === 'singleton'
                      ? 'No other players joined. Try playing again to find another room.'
                      : 'This room was closed. Try playing again to find another room.'}
                </p>
                <button
                  onClick={() => {
                    // Game-chat PRD §131: room deleted → runtime ends; the
                    // chat list stays available but the game session is over.
                    useGameRoomStore.getState().dismissClosure()
                    onClose()
                  }}
                  className="mt-2 bg-coral-gradient glow-coral rounded-2xl py-3 px-8 font-bold tracking-wide active:scale-[0.98] transition-transform"
                >
                  BACK TO GAME
                </button>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* ═══ v3 §26-§30 — mock coin store (opened by the ＋ on the chip) ═══ */}
        <CoinStoreSheet
          open={showCoinStore}
          onClose={() => setShowCoinStore(false)}
          coinBalance={economy.coinBalance}
          onPurchased={(newBalance) => setCoinBalance(newBalance)}
        />

        {/* ═══ THE SHARED PLAYER TOOLBOX surfaces (v3 §40-§46 revised) —
            interaction sheet (mobile sheet / desktop popover anchored to the
            tapped seat) + the bulk gift sheet + the friend layer — all owned
            by the game-agnostic hook. ═══ */}
        {toolbox.surfaces}
      </div>
    </MotionConfig>
  )
}

