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
import { DoorOpen } from 'lucide-react'
import { toast } from 'sonner'
import { Capacitor } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'
import { api } from '@/lib/quicky/api-client'
import { useQuickyStore } from '@/store/quicky'
import { useLudoRoomStore } from '@/store/ludo-room'
import { useGameChatStore } from '@/store/game-chat'
import { useIsDesktopShell } from '@/hooks/useIsDesktopShell'
import { RoomTopHud, RoomHudChips, RoomExitControl } from '../RoomTopHud'
import { RoomEventBanner, tonightEvent } from '../RoomEventBanner'
import { RoomChatPanel, type ChatPlayer, type RoomMessage } from '../RoomChatPanel'
import { GameChatScreen } from '../game-chat/GameChatScreen'
import { GameContactsPanel } from '../game-chat/GameContactsPanel'
import { ChatView } from '../ChatView'
import { useDatingUnread } from '../game-hub/useDatingUnread'
import { CoinStoreSheet } from '../CoinStoreSheet'
import { PlayerInteractionSheet, type CatalogGift, type InteractionPlayer } from '../PlayerInteractionSheet'
import { GiftSheet } from '../GiftSheet'
import { LudoGameArea } from './LudoGameArea'
import '../spin-bottle-room.css'
import './ludo-room.css'

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
  const bumpEconomy = useLudoRoomStore((s) => s.bumpEconomy)
  const getSkew = useLudoRoomStore((s) => s.getSkew)

  const roomChatPanel = useQuickyStore((s) => s.roomChatPanel)
  const setRoomChatPanel = useQuickyStore((s) => s.setRoomChatPanel)
  const gameChatsUnread = useGameChatStore((s) => s.list.reduce((sum, c) => sum + c.unread, 0))

  const [sendingChat, setSendingChat] = useState(false)
  const [showExit, setShowExit] = useState(false)
  const [kbHeight, setKbHeight] = useState(0)
  const [gamesPlayed, setGamesPlayed] = useState(0)
  const [showCoinStore, setShowCoinStore] = useState(false)
  const [showGiftSheet, setShowGiftSheet] = useState(false)
  const [interaction, setInteraction] = useState<{ player: InteractionPlayer } | null>(null)
  const [isDesktop, setIsDesktop] = useState(false)
  const isNativeCapacitor = Capacitor.isNativePlatform()
  const isDeskShell = useIsDesktopShell() === true
  const datingUnread = useDatingUnread(true)
  const [datingBannerHidden, setDatingBannerHidden] = useState(false)
  const kbHeightRef = useRef(0)
  const [lockedStageHeight, setLockedStageHeight] = useState<number | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  // Keyboard OVERLAY mode — identical guard to the Spin Bottle room so the
  // board keeps its size while the chat composer is open (§33).
  useEffect(() => {
    const doc = document.documentElement
    const setKb = (px: number) => {
      kbHeightRef.current = px
      doc.style.setProperty('--sbr-kb', `${Math.round(px)}px`)
      setKbHeight(px)
    }
    const vv = window.visualViewport ?? null
    const onVV = () => {
      if (!vv) return
      const kb = window.innerHeight - vv.height - vv.offsetTop
      setKb(Math.max(0, Math.min(kb, window.innerHeight * 0.6)))
    }
    vv?.addEventListener('resize', onVV)
    vv?.addEventListener('scroll', onVV)
    let handles: Awaited<ReturnType<typeof Keyboard.addListener>>[] = []
    if (Capacitor.isNativePlatform()) {
      Keyboard.addListener('keyboardWillShow', (i) => setKb(i.keyboardHeight ?? 0)).then((h) => handles.push(h))
      Keyboard.addListener('keyboardWillHide', () => setKb(0)).then((h) => handles.push(h))
    }
    return () => {
      vv?.removeEventListener('resize', onVV)
      vv?.removeEventListener('scroll', onVV)
      handles.forEach((h) => h.remove())
      setKb(0)
    }
  }, [])

  // Locked stage height while the keyboard is open (same guard as SpinBottleRoom)
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

  // ── Player interaction (§38/§40) — the SHARED interaction sheet ─────────
  const openInteraction = (p: InteractionPlayer) => {
    if (p.userId === meId) {
      toast("That's you! Tap someone else to interact.")
      return
    }
    setInteraction({ player: p })
  }
  useEffect(() => {
    if (!interaction) return
    const stillHere = (snapshot?.players ?? []).some((pl) => pl.userId === interaction.player.userId)
    if (!stillHere) setInteraction(null) // §41: no ghost popups
  }, [snapshot?.players, interaction])

  const handleMessage = (p: InteractionPlayer) => {
    setInteraction(null)
    const qk = useQuickyStore.getState()
    const peer = { peerUserId: p.userId, peerName: p.displayName, peerAvatar: p.avatar }
    qk.pinGameChatPeer(peer)
    if (isNativeCapacitor) {
      qk.openGameChat(peer, 'game-chat-contacts')
    } else if (isDeskShell) {
      useGameChatStore.getState().openConversation(peer)
      qk.openChats('game')
    } else {
      useGameChatStore.getState().openConversation(peer)
      qk.setRoomChatPanel('personal')
    }
  }
  const handleMention = (p: InteractionPlayer) => {
    setInteraction(null)
    useQuickyStore.getState().insertRoomChatMention({ userId: p.userId, displayName: p.displayName })
  }
  const handleProfile = (p: InteractionPlayer) => {
    setInteraction(null)
    useQuickyStore.getState().openProfile(p.userId, 'ludo-room')
  }

  // ── Friends (refactor PRD §25 — same toolbox as the Spin Bottle room) ────
  const [friendIds, setFriendIds] = useState<Set<string>>(() => new Set())
  const [friendBusy, setFriendBusy] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    api.friends
      .list()
      .then((res) => {
        if (cancelled) return
        setFriendIds(new Set((res.friends ?? []).map((f: { id: string }) => f.id)))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  const handleToggleFriend = async (p: InteractionPlayer) => {
    if (friendBusy) return
    setFriendBusy(p.userId)
    const wasFriend = friendIds.has(p.userId)
    try {
      if (wasFriend) {
        await api.friends.remove(p.userId)
        setFriendIds((prev) => {
          const next = new Set(prev)
          next.delete(p.userId)
          return next
        })
        toast.success(`${p.displayName} removed from friends`)
      } else {
        await api.friends.add(p.userId)
        setFriendIds((prev) => new Set(prev).add(p.userId))
        toast.success(`${p.displayName} is now your friend`)
      }
    } catch (e: any) {
      toast.error(e?.status === 409 ? 'Already friends' : e?.status === 403 ? 'Not available' : (e?.message ?? 'Failed'))
    } finally {
      setFriendBusy(null)
    }
  }

  // ── Gifts (§37/§100) — the existing economy, optimistic at the HUD ───────
  const sendGift = async (recipientId: string, gift: CatalogGift): Promise<boolean> => {
    if (!roomId) return false
    bumpEconomy({ coinBalance: -gift.priceCoins })
    try {
      const res = await api.ludo.gifts.send(roomId, recipientId, gift.id)
      if (res?.ok) {
        setCoinBalance(res.coinBalance)
        const me2 = useQuickyStore.getState().user
        const recipientName = snapshot?.players.find((p) => p.userId === recipientId)?.displayName
        useLudoRoomStore.getState().broadcastGift({
          senderId: me2?.id ?? '',
          senderName: me2?.name ?? 'Someone',
          recipientId,
          recipientName: recipientName ?? 'Someone',
          itemId: gift.id,
          itemName: gift.name,
          itemEmoji: gift.icon,
          quantity: 1,
        })
        return true
      }
      return false
    } catch (e: any) {
      if (e?.body?.coinBalance !== undefined) setCoinBalance(Number(e.body.coinBalance))
      else void useLudoRoomStore.getState().reconcile()
      toast.error(e?.body?.error === 'insufficient_coins' ? 'Not enough coins — top up in the coin store.' : e?.message ?? 'Failed to send gift')
      return false
    }
  }

  // ── Leave (§41) — always works; the server cleans everything up ──────────
  const leave = useCallback(async () => {
    if (!roomId) return
    try {
      await api.ludo.leave(roomId)
    } catch {}
    useLudoRoomStore.getState().detach()
    onClose()
  }, [roomId, onClose])

  const chatPlayers: ChatPlayer[] = (snapshot?.players ?? []).map((p) => ({
    userId: p.userId,
    displayName: p.displayName,
    avatar: p.avatar,
    gender: p.gender as string | null | undefined,
    seatIndex: p.seatIndex as number | undefined,
  }))

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
            />
          </div>
          <RoomExitControl onClick={() => setShowExit(true)} />
        </header>

        {/* ═══ MOBILE HUD (hidden ≥1024px) ═══ */}
        <div className="sbr-m-only">
          <RoomTopHud
            hearts={economy.kissPoints}
            trophies={gamesPlayed}
            crowns={me?.isPremium ? 1 : 0}
            gifts={economy.giftsReceived}
            coins={economy.coinBalance}
            onRoomOptions={() => setShowExit(true)}
            onAddCoins={() => setShowCoinStore(true)}
          />
        </div>

        {/* ═══ Body: game column + chat ═══ */}
        <div className="sbr-body">
          <div className="sbr-gamecol">
            <RoomEventBanner event={tonightEvent()} />

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
                  onRoll={() => void useLudoRoomStore.getState().roll()}
                  onMove={(tokenId) => void useLudoRoomStore.getState().move(tokenId)}
                  onLeave={() => void leave()}
                  onOpenGifts={() => setShowGiftSheet(true)}
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
            onSend={sendChat}
            sending={sendingChat}
            kbOpen={kbHeight > 0}
            onOpenGifts={() => setShowGiftSheet(true)}
            onOpenGameChats={
              isNativeCapacitor
                ? () => useQuickyStore.getState().openGameChatContacts('ludo-room')
                : isDeskShell
                  ? () => useQuickyStore.getState().openChats('game')
                  : () => setRoomChatPanel('contacts')
            }
            gameChatsUnread={gameChatsUnread}
            panel={roomChatPanel}
            panelContent={
              !isNativeCapacitor && roomChatPanel === 'contacts' ? (
                <GameContactsPanel />
              ) : !isNativeCapacitor && roomChatPanel === 'personal' ? (
                <GameChatScreen embedded onBack={() => setRoomChatPanel('contacts')} />
              ) : !isNativeCapacitor && roomChatPanel === 'dating' ? (
                <ChatView embedded onBack={() => setRoomChatPanel('contacts')} />
              ) : null
            }
            mentionFlashId={mentionFlashId}
            onMentionFlashDone={() => useLudoRoomStore.getState().setMentionFlash(null)}
          />
        </div>

        {/* ═══ Room options — leave always works (§41) ═══ */}
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
                className="sbr-sheet fixed inset-x-0 bottom-0 z-[201] mx-auto max-w-md p-4 sbr-sheet-safe flex flex-col gap-3"
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
                className="fixed inset-0 z-[220] bg-black/85 backdrop-blur-sm"
              />
              <motion.div
                initial={{ scale: 0.92, opacity: 0, y: 12 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 24 }}
                className="fixed inset-x-0 top-1/2 z-[221] mx-auto w-[min(92vw,24rem)] -translate-y-1/2 bg-[var(--qk-card)] border border-white/10 rounded-3xl p-6 text-center flex flex-col items-center gap-3"
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

        <PlayerInteractionSheet
          player={interaction?.player ?? null}
          mode={isDesktop ? 'popover' : 'sheet'}
          anchor={null}
          coinBalance={economy.coinBalance}
          onClose={() => setInteraction(null)}
          onTag={() => setInteraction(null)}
          onMessage={handleMessage}
          onMention={handleMention}
          onProfile={handleProfile}
          isFriend={interaction ? friendIds.has(interaction.player.userId) : false}
          friendBusy={!!interaction && friendBusy === interaction.player.userId}
          onToggleFriend={handleToggleFriend}
          onBuyCoins={() => {
            setInteraction(null)
            setShowCoinStore(true)
          }}
          onSendGift={sendGift}
        />

        <GiftSheet
          open={showGiftSheet}
          onClose={() => setShowGiftSheet(false)}
          roomId={roomId}
          players={chatPlayers}
          meId={meId}
          coinBalance={economy.coinBalance}
          onGiftSent={(newBalance) => setCoinBalance(newBalance)}
          onBuyCoins={() => {
            setShowGiftSheet(false)
            setShowCoinStore(true)
          }}
        />
      </div>
    </MotionConfig>
  )
}
