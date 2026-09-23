'use client'

// Quicky — LUDO ROOM (Ludo PRD §3/§4/§33/§34/§35-§44/§62/§99/§115/§117/§122)
//
// "The room is the platform. The game is a plug-in." — LudoRoom owns the
// Ludo game area but delegates EVERY piece of room infrastructure to the
// existing Quicky room architecture (zero duplication):
//
//   · useLudoRoomStore  — the shared runtime (SSE + poll + ping + channel),
//     the Ludo sibling of useGameRoomStore (§4: same runtime principles)
//   · RoomTopHud / RoomHudChips / RoomExitControl — shared HUD
//   · RoomEventBanner — tonight-event strip
//   · RoomChatPanel — THE room chat (mentions, reactions, gifts, stickers…)
//     with the web 3-state panel (room | contacts | personal) (§35/§115)
//   · GameChatScreen / GameContactsPanel / ChatView — embedded panel states
//   · PlayerInteractionSheet — Message / Mention / Gift / Add Friend /
//     Profile on any player tap (§38/§40)
//   · GiftSheet + CoinStoreSheet — the existing economy surfaces (§37)
//   · exit sheet + room-closure dialog — the shared room lifecycle UI
//   · spin-bottle-room.css — the wooden stage + shell styles are IMPORTED,
//     not copied (§8: reuse the same outer stage treatment)
//
// Layout (§33/§34): mobile = HUD → board → dice → chat sheet;
// web ≥1024px = top bar + (game column | chat sidebar), full-window.

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence, MotionConfig } from 'framer-motion'
import { Capacitor } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'
import { DoorOpen } from 'lucide-react'
import { api } from '@/lib/quicky/api-client'
import { useQuickyStore } from '@/store/quicky'
import { useLudoRoomStore } from '@/store/ludo-room'
import { useGameChatStore } from '@/store/game-chat'
import { useIsDesktopShell } from '@/hooks/useIsDesktopShell'
import { RoomTopHud, RoomHudChips, RoomExitControl } from '../RoomTopHud'
import { RoomEventBanner } from '../RoomEventBanner'
import { useRoomRealm } from '../realm/useRoomRealm'
import { RoomChatPanel, type ChatPlayer, type RoomMessage } from '../RoomChatPanel'
import { useRoomContactsNav } from '../useRoomContactsNav'
import { GameChatScreen } from '../game-chat/GameChatScreen'
import { GameContactsPanel } from '../game-chat/GameContactsPanel'
import { ChatView } from '../ChatView'
import { useDatingUnread } from '../game-hub/useDatingUnread'
import { CoinStoreSheet } from '../CoinStoreSheet'
import { useRoomPlayerToolbox } from '../room-toolbox/useRoomPlayerToolbox'
import { GiftSheet } from '../GiftSheet'
import { LudoGameArea } from './LudoGameArea'
import '../spin-bottle-room.css'
import './ludo-room.css'

/* ── Keyboard helpers (twin of SpinBottleRoom's) ───────────────────────
   A focused text element is the tell for "the soft keyboard is opening or
   up": its layout resize lands on the FOCUS frame in resizes-content
   webviews, so viewport re-baselining (and the stage-height lock
   re-measure) must be suppressed while one holds focus — otherwise the
   shrunk geometry gets baked into the baseline and the board squeezes. */
function isTextElement(el: EventTarget | null): el is HTMLElement {
  return (
    el instanceof HTMLElement &&
    el.matches('input, textarea, [contenteditable="true"], [contenteditable=""]')
  )
}

function anyTextFocused(): boolean {
  return isTextElement(document.activeElement)
}

export function LudoRoom({
  roomId: initialRoomId,
  onClose,
}: {
  roomId: string
  onClose: () => void
}) {
  const me = useQuickyStore((s) => s.user)
  const meId = me?.id ?? ''
  const storeRoomId = useLudoRoomStore((s) => s.roomId)
  const roomId = storeRoomId ?? initialRoomId
  const snapshot = useLudoRoomStore((s) => s.snapshot)
  const chat = useLudoRoomStore((s) => s.chat)
  const economy = useLudoRoomStore((s) => s.economy)
  const closure = useLudoRoomStore((s) => s.closure)
  const mentionFlashId = useLudoRoomStore((s) => s.mentionFlashId)
  const setCoinBalance = useLudoRoomStore((s) => s.setCoinBalance)
  // Realm PRD §41/§71 — the shared realm HUD chip + event-banner queue.
  const { hudRealm, bannerEvents, openDetails } = useRoomRealm()

  const roomChatPanel = useQuickyStore((s) => s.roomChatPanel)
  const setRoomChatPanel = useQuickyStore((s) => s.setRoomChatPanel)
  const gameChatsUnread = useGameChatStore((s) => s.list.reduce((sum, c) => sum + c.unread, 0))

  const [sendingChat, setSendingChat] = useState(false)
  const [showExit, setShowExit] = useState(false)
  const [kbHeight, setKbHeight] = useState(0)
  const [gamesPlayed, setGamesPlayed] = useState(0)
  const [showCoinStore, setShowCoinStore] = useState(false)
  const [isDesktop, setIsDesktop] = useState(false)
  const isNativeCapacitor = Capacitor.isNativePlatform()
  const isDeskShell = useIsDesktopShell() === true
  const datingUnread = useDatingUnread(true)
  const [datingBannerHidden, setDatingBannerHidden] = useState(false)
  const kbHeightRef = useRef(0)
  const [lockedStageHeight, setLockedStageHeight] = useState<number | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  // Keyboard COMPOSER-POP mode (v4 — same as the Spin Bottle room): while
  // the soft keyboard is up ONLY the chat composer pops out of the panel
  // (CSS .sbr-chat.sbr-kb-open .sbr-composer) and floats above the
  // keyboard. The board NEVER changes size, in any webview resize mode:
  //   · --sbr-room-h  → the room root pins to the last keyboard-free
  //                     layout height (blocks resizes-content /
  //                     adjustResize layout shrinks).
  //   · --sbr-sheet-h → the chat sheet's pixel height freezes (the 33dvh
  //                     clamp re-derives when the ICB shrinks — freezing
  //                     it keeps the board's flex allocation identical).
  //   · --sbr-kb      → the composer's translateY: its bottom lands flush
  //                     on the keyboard's top edge in BOTH resize modes.
  //   · lockedStageHeight keeps the .ldo-stage-holder box frozen too.
  // RACE FIX vs v3: baselines are captured at FOCUS time (the only moment
  // the layout is guaranteed keyboard-free, BEFORE the webview resizes)
  // and window-resize re-baselining is suppressed while a text input
  // holds focus — in resizes-content webviews the layout resize can fire
  // BEFORE the visual-viewport events, and the old kbHeight-only guard
  // then baked the already-shrunk innerHeight into the baseline.
  useEffect(() => {
    const doc = document.documentElement
    let stableInner = window.innerHeight // last keyboard-free layout height
    let stableSheetH: number | null = null // last keyboard-free sheet height
    const setKb = (px: number) => {
      const h = Math.max(0, Math.min(px, stableInner * 0.85))
      kbHeightRef.current = h
      doc.style.setProperty('--sbr-kb', `${Math.round(h)}px`)
      if (h > 0) {
        doc.style.setProperty('--sbr-room-h', `${Math.round(stableInner)}px`)
        if (stableSheetH != null) doc.style.setProperty('--sbr-sheet-h', `${Math.round(stableSheetH)}px`)
      } else {
        doc.style.removeProperty('--sbr-room-h')
        doc.style.removeProperty('--sbr-sheet-h')
      }
      setKbHeight(h)
    }
    const vv = window.visualViewport ?? null
    const onVV = () => {
      if (!vv) return
      // Unified formula: keyboard = last stable layout height − visible
      // area. Works in BOTH resize modes (resizes-visual AND
      // resizes-content — where innerHeight already shrank).
      const kb = stableInner - (vv.height + vv.offsetTop)
      setKb(kb)
    }
    vv?.addEventListener('resize', onVV)
    vv?.addEventListener('scroll', onVV)

    // FOCUS-TIME CAPTURE — the moment the input is tapped the layout is
    // still keyboard-free: refresh the root baseline and remember the
    // sheet's exact pixel height so the pin can freeze it (covers inputs
    // inside the room composer AND the embedded personal/dating docks).
    const onFocusIn = (e: FocusEvent) => {
      if (!isTextElement(e.target)) return
      if (kbHeightRef.current === 0) stableInner = Math.max(stableInner, window.innerHeight)
      const sheet = e.target.closest('.sbr-chat') ?? document.querySelector('.sbr-chat')
      if (sheet instanceof HTMLElement) {
        const h = sheet.getBoundingClientRect().height
        if (h > 100) stableSheetH = h
      }
    }
    document.addEventListener('focusin', onFocusIn)

    // Re-baseline ONLY when no text input holds focus: in resizes-content
    // webviews the keyboard's layout resize lands while the composer is
    // still focused — re-baselining there bakes the keyboard into the
    // baseline (the v3 race).
    const onResize = () => {
      if (kbHeightRef.current === 0 && !anyTextFocused()) {
        stableInner = window.innerHeight
        doc.style.removeProperty('--sbr-room-h')
      }
    }
    window.addEventListener('resize', onResize)
    let handles: Awaited<ReturnType<typeof Keyboard.addListener>>[] = []
    if (Capacitor.isNativePlatform()) {
      Keyboard.addListener('keyboardWillShow', (i) => setKb(i.keyboardHeight ?? 0)).then((h) => handles.push(h))
      Keyboard.addListener('keyboardWillHide', () => setKb(0)).then((h) => handles.push(h))
    }
    return () => {
      vv?.removeEventListener('resize', onVV)
      vv?.removeEventListener('scroll', onVV)
      document.removeEventListener('focusin', onFocusIn)
      window.removeEventListener('resize', onResize)
      handles.forEach((h) => h.remove())
      setKb(0)
    }
  }, [])

  // Locked stage height while the keyboard is open (same guard as
  // SpinBottleRoom). The measure ALSO skips while a text input holds
  // focus — the keyboard's layout resize lands on the focus frame, and
  // recording then would lock the ALREADY-SHRUNK board height in.
  useEffect(() => {
    const measure = () => {
      const el = stageRef.current
      if (!el) return
      if (kbHeightRef.current > 0 || anyTextFocused()) return
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

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const apply = () => setIsDesktop(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  // HUD 🏆 — real games-played from the shared landing stats endpoint
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

  // ── RUNTIME ATTACH (Ludo PRD §62/§99) — idempotent, survives navigation.
  useEffect(() => {
    useLudoRoomStore.getState().attach(initialRoomId)
  }, [initialRoomId])

  // ── Unified PRD §23/§24 — ONE shared contacts navigation for BOTH the
  // "Game Chats" header button and the 💬 composer button:
  //   desktop web      → embedded contacts panel (table stays playable)
  //   mobile / Capacitor → dedicated full-screen contacts page (§20/§22).
  // The old desktop-shell openChats('game') full-page branch is REMOVED.
  const openRoomContacts = useRoomContactsNav('ludo-room')

  useEffect(() => {
    return () => {
      useQuickyStore.getState().setRoomChatPanel('room')
    }
  }, [])

  const sendChat = async (
    t: string,
    replyTo?: RoomMessage['replyTo'],
    mentions?: { userId: string; displayName: string }[]
  ) => {
    if (sendingChat) return
    setSendingChat(true)
    try {
      await useLudoRoomStore.getState().sendChat(t, replyTo, mentions)
    } finally {
      setSendingChat(false)
    }
  }

  // ── THE SHARED PLAYER TOOLBOX (§38/§40 REVISED — game-agnostic template).
  // "A user id comes in → tapping it opens the tool box": yard avatars on
  // the board, HUD chips, ANY surface — one hook, zero per-game logic.
  // Owns mention / personal chat / gift / add-friend / profile + the gift
  // sheet, ghost cleanup and the optimistic gift economy.
  const chatPlayers: ChatPlayer[] = (snapshot?.players ?? []).map((p) => ({
    userId: p.userId,
    displayName: p.displayName,
    avatar: p.avatar,
    gender: p.gender as string | null | undefined,
    seatIndex: p.seatIndex as number | undefined,
    // Room-chat settings: players with mentions OFF lose the Mention action.
    mentionDisabled: p.mentionsEnabled === false,
  }))
  const toolbox = useRoomPlayerToolbox({
    roomId,
    meId,
    members: chatPlayers,
    coinBalance: economy.coinBalance,
    mode: isDesktop ? 'popover' : 'sheet',
    returnView: 'ludo-room',
    onCoinBalance: setCoinBalance,
    onReconcile: () => void useLudoRoomStore.getState().reconcile(),
    onOpenCoinStore: () => setShowCoinStore(true),
    resolveAnchor: (el) => {
      const card = el?.getBoundingClientRect() ?? null
      const stage = stageRef.current?.getBoundingClientRect() ?? null
      return card && stage ? { card, stage } : null
    },
  })

  // ── Open the room-options sheet (mobile/Capacitor exit fix).
  // Capacitor runs KeyboardResize.None — the keyboard OVERLAYS the WebView,
  // so an open keyboard would sit ON TOP of the bottom sheet and swallow
  // the Leave button ("the exit button does nothing"). Clear the focus +
  // hide the native keyboard FIRST, then slide the sheet up.
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
  const leave = useCallback(() => {
    if (!roomId) return
    useLudoRoomStore.getState().detach()
    onClose()
    void api.ludo.leave(roomId).catch(() => {})
  }, [roomId, onClose])

  const roomLabel = `Board #${roomId.slice(-5).toUpperCase()}`

  return (
    <MotionConfig reducedMotion="user">
      <div className="sbr-root ldo-root absolute inset-0">
        {/* ═══ WEB top bar (≥1024px) — shared club header ═══ */}
        <header className="sbr-webtop safe-area-top sbr-d-only">
          <span className="sbr-webtop-emoji" aria-hidden>🎲</span>
          <div className="sbr-webtop-title">
            <div className="sbr-webtop-line">
              <h1>Quicky Ludo</h1>
              <span className="sbr-live"><i aria-hidden />Live</span>
            </div>
            <p className="sbr-webtop-sub">Classic 4-player Ludo • {roomLabel}</p>
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
          <RoomExitControl onClick={openExit} />
        </header>

        {/* ═══ MOBILE HUD (hidden ≥1024px) ═══ */}
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
            <RoomEventBanner events={bannerEvents} />

            {datingUnread && !datingBannerHidden && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mx-2 mb-2 rounded-2xl border border-[var(--qk-accent)]/30 bg-[var(--qk-card)]/90 backdrop-blur px-3 py-2.5 flex items-center gap-3"
                data-testid="ludo-dating-banner"
              >
                <span className="shrink-0 text-lg" aria-hidden>💗</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black text-white truncate">New Dating Message — {datingUnread.name}</p>
                  <p className="text-[11px] text-white/60 truncate">{datingUnread.preview}</p>
                </div>
                <button
                  onClick={() => {
                    const qk = useQuickyStore.getState()
                    qk.clearUnreadForMatch(datingUnread.matchId)
                    qk.setActiveMatchId(datingUnread.matchId)
                    if (isNativeCapacitor) {
                      qk.openChat(datingUnread.matchId, 'ludo-room')
                    } else if (isDeskShell) {
                      qk.openChats('dating')
                    } else {
                      qk.setRoomChatPanel('dating')
                    }
                  }}
                  className="shrink-0 rounded-full bg-coral-gradient px-3.5 py-1.5 text-[11px] font-black text-white active:scale-95 transition-transform"
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

            {/* The Ludo game area — board + HUD + dice (own component) */}
            <div
              ref={stageRef}
              className="ldo-stage-holder"
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
              {snapshot ? (
                <LudoGameArea
                  snapshot={snapshot}
                  meId={meId}
                  onMove={(tokenId) => void useLudoRoomStore.getState().move(tokenId)}
                  onLeave={() => void leave()}
                  onOpenGifts={toolbox.openGiftSheet}
                  onPlayerTap={(p, el) => toolbox.open(p, el)}
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-white/70">
                  <div className="w-9 h-9 rounded-full border-2 border-[var(--qk-accent)] border-t-transparent animate-spin" />
                  <p className="text-sm font-bold">Joining table…</p>
                  <p className="text-xs text-white/45">Preparing board…</p>
                </div>
              )}
            </div>
          </div>

          {/* Layer C — THE shared chat shell (§35/§115: never redesigned) */}
          <RoomChatPanel
            messages={chat}
            players={chatPlayers}
            meId={meId}
            roomId={roomId}
            onSend={sendChat}
            onSendSticker={(s, r) => void useLudoRoomStore.getState().sendSticker(s, r)}
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
            onMentionFlashDone={() => useLudoRoomStore.getState().setMentionFlash(null)}
          />
        </div>

        {/* ═══ Room options — leave always works (§41). z-[240/241]: the
            room's CONTROL surfaces stay above the transient in-game alert
            drawers (225-232) so an alert can never block leaving. ═══ */}
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
                {snapshot?.status === 'PLAYING' && (
                  <p className="text-sm font-semibold text-amber-300/90 -mt-1">
                    Game in progress — leaving removes your tokens from the board.
                  </p>
                )}
                <button
                  className="sbr-sheet-btn-leave w-full justify-center"
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

        {/* ═══ Room-lifecycle closure dialog (shared) ═══ */}
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
                    useLudoRoomStore.getState().detach()
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

        {/* ═══ Shared economy + interaction surfaces (§37) ═══ */}
        <CoinStoreSheet
          open={showCoinStore}
          onClose={() => setShowCoinStore(false)}
          coinBalance={economy.coinBalance}
          onPurchased={(newBalance) => setCoinBalance(newBalance)}
        />

        {/* ═══ THE SHARED PLAYER TOOLBOX surfaces — sheet | popover + gifts.
            Every player surface in this room (yard avatars, HUD chips)
            opens THIS through toolbox.open(player). ═══ */}
        {toolbox.surfaces}
      </div>
    </MotionConfig>
  )
}
