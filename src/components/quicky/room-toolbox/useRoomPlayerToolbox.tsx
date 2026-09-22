'use client'

// Quicky — ROOM PLAYER TOOLBOX (the REUSABLE per-player interaction kit)
//
// THE room template piece: "a user id comes in → tapping it (by another
// user) opens the TOOL BOX" — mention, personal chat, gift, add/remove
// friend, profile + the coin-store escape hatch. It is deliberately GAME-
// AGNOSTIC: every room surface (Spin the Bottle seats, Ludo yard avatars,
// any future game's player chip) calls `toolbox.open(player)` with nothing
// but a user id + display name + avatar — no per-game wiring, ever.
//
// What this owns (one copy for EVERY game — never duplicated again):
//   · the interaction sheet (PlayerInteractionSheet — sheet | popover)
//   · the bulk gift sheet (GiftSheet) + the DB-driven gift catalog
//   · the relationship layer (friend list + add/remove with optimistic UI)
//   · Message → platform-correct personal chat navigation
//     (Capacitor dedicated screen / web + desktop-shell room chat panel)
//   · Mention → prefills the Room Chat composer (@Name, never auto-sends)
//   · Profile → the app's real profile route with the room as back target
//   · ghost cleanup — a player who left can never keep a popup alive
//   · gift send — optimistic coin spend, server balance reconcile, the
//     sender→receiver FLY animation (the room-channel gift push that
//     drives every OTHER client's visuals comes from the SERVER)
//
// Rooms keep ONLY their own specifics: the economy reconcile callback and
// (optionally) a guard + popover anchor.

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Capacitor } from '@capacitor/core'
import { api } from '@/lib/quicky/api-client'
import { useQuickyStore, type AppView } from '@/store/quicky'
import { useGameChatStore } from '@/store/game-chat'
import { launchGiftFly } from '@/components/quicky/gift-fly/GiftFlyLayer'
import {
  PlayerInteractionSheet,
  type CatalogGift,
  type InteractionPlayer,
} from '../PlayerInteractionSheet'
import { GiftSheet } from '../GiftSheet'

export type ToolboxPlayer = {
  userId: string
  displayName: string
  avatar?: string | null
  gender?: string | null
  seatIndex?: number
  /** Room-chat settings: this player turned mentions OFF for this room. */
  mentionDisabled?: boolean
}

/** Popover anchor rects (desktop) — identical contract to PlayerInteractionSheet. */
export type ToolboxAnchor = { card: DOMRect; stage: DOMRect } | null

export type RoomPlayerToolboxOptions = {
  roomId: string | null
  meId: string
  /** Authoritative room membership — drives ghost cleanup + gift recipients. */
  members: ToolboxPlayer[]
  coinBalance: number
  /** 'sheet' (mobile) | 'popover' (desktop, needs resolveAnchor). */
  mode: 'sheet' | 'popover'
  /** Profile back target — the room the toolbox was opened FROM. */
  returnView: AppView
  /** Economy wiring (store is per-game → injected). */
  onCoinBalance: (n: number) => void
  onReconcile?: () => void
  onOpenCoinStore: () => void
  /** Optional guard — return a toast string to BLOCK the toolbox opening. */
  beforeOpen?: (p: ToolboxPlayer) => string | null
  /** Optional popover anchor resolver (desktop) from the tapped element. */
  resolveAnchor?: (el: HTMLElement | null) => ToolboxAnchor
}

export function useRoomPlayerToolbox(opts: RoomPlayerToolboxOptions) {
  const {
    roomId,
    meId,
    members,
    coinBalance,
    mode,
    returnView,
    onCoinBalance,
    onReconcile,
    onOpenCoinStore,
    beforeOpen,
    resolveAnchor,
  } = opts

  const isNativeCapacitor = Capacitor.isNativePlatform()

  const [interaction, setInteraction] = useState<{
    player: InteractionPlayer
    anchor: ToolboxAnchor
  } | null>(null)
  const [giftOpen, setGiftOpen] = useState(false)

  // ── open(player) — THE reusable entry point. Any surface, any game:
  // a user id comes in, the tool box opens (unless a room guard blocks it).
  // SELF-OPEN (gifting-revision): tapping YOUR OWN surface (seat / yard
  // avatar) opens the toolbox in self mode — Gift yourself + View Profile
  // (PlayerInteractionSheet renders the reduced self layout).
  const open = useCallback(
    (p: ToolboxPlayer, el?: HTMLElement | null) => {
      const blocked = beforeOpen?.(p)
      if (blocked) {
        toast(blocked)
        return
      }
      setInteraction({
        player: {
          userId: p.userId,
          displayName: p.displayName,
          avatar: p.avatar ?? null,
          isMe: p.userId === meId,
          mentionDisabled: p.mentionDisabled === true,
        },
        anchor: resolveAnchor ? resolveAnchor(el ?? null) : null,
      })
    },
    [beforeOpen, meId, resolveAnchor]
  )
  const close = useCallback(() => setInteraction(null), [])

  // Ghost cleanup — the members array IS the authoritative presence: the
  // moment a player disappears from it, their popup can never linger.
  useEffect(() => {
    if (!interaction) return
    const stillHere = members.some((m) => m.userId === interaction.player.userId)
    if (!stillHere) setInteraction(null)
  }, [members, interaction])

  // ── Message — platform-correct personal chat (one copy for every game):
  //   · CAPACITOR → the dedicated full-screen chat; back stack personal →
  //     contacts → room (returnView preserved by the store).
  //   · WEB + DESKTOP SHELL (≥1024px) → the room's own chat panel swaps to
  //     'personal' (embedded GameChatScreen in the right chat sidebar — the
  //     game table never unmounts, stays playable + realtime). Back chain:
  //     chat → contacts → Room Chat. The old desktop-shell openChats('game')
  //     full-page redirect is GONE (same rule as useRoomContactsNav §23/§24).
  const handleMessage = useCallback(
    (p: InteractionPlayer) => {
      setInteraction(null)
      const qk = useQuickyStore.getState()
      const peer = { peerUserId: p.userId, peerName: p.displayName, peerAvatar: p.avatar ?? null }
      qk.pinGameChatPeer(peer)
      if (isNativeCapacitor) {
        qk.openGameChat(peer, 'game-chat-contacts')
      } else {
        useGameChatStore.getState().openConversation(peer)
        qk.setRoomChatPanel('personal')
      }
    },
    [isNativeCapacitor]
  )

  // ── Mention — prefills the Room Chat composer, never auto-sends.
  const handleMention = useCallback((p: InteractionPlayer) => {
    setInteraction(null)
    useQuickyStore.getState().insertRoomChatMention({ userId: p.userId, displayName: p.displayName })
  }, [])

  // ── Profile — the app's real profile route, back to THIS room.
  const handleProfile = useCallback(
    (p: InteractionPlayer) => {
      setInteraction(null)
      useQuickyStore.getState().openProfile(p.userId, returnView)
    },
    [returnView]
  )

  const handleTag = useCallback((p: InteractionPlayer) => {
    toast(`Tag — coming soon. You picked ${p.displayName}.`)
    setInteraction(null)
  }, [])

  // ── Friends — ONE relationship layer for every room (server validates
  // not-self / not-blocked / not-duplicate).
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
  const handleToggleFriend = useCallback(
    async (p: InteractionPlayer) => {
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
        toast.error(
          e?.status === 409 ? 'Already friends' : e?.status === 403 ? 'Not available' : (e?.message ?? 'Failed')
        )
      } finally {
        setFriendBusy(null)
      }
    },
    [friendBusy, friendIds]
  )

  // ── Gifts — optimistic spend, server truth, FLY ANIMATION (gifting-rev).
  // The gift endpoint is the SHARED room-gift API (every game posts to the
  // same route) — the recipient reward, chat card and every other client's
  // visuals arrive through the SERVER's room-channel broadcast (it carries
  // the real chat-row id, resolved icon and recipient list), so the toolbox
  // no longer duplicates that broadcast locally. The sender's own payoff:
  // the gift icons FLY from MY seat to the RECIPIENT's seat the moment the
  // server commits (works for SELF-gifts too — the server accepts me as the
  // recipient; I pay and also collect the recipient reward).
  const sendGift = useCallback(
    async (recipientId: string, gift: CatalogGift, quantity = 1): Promise<boolean> => {
      if (!roomId) return false
      const qty = Math.max(1, Math.floor(quantity) || 1)
      onCoinBalance(coinBalance - gift.priceCoins * qty) // optimistic HUD spend
      try {
        // Realm PRD §20 — fresh idempotency key per SEND ACTION: a retried
        // request (double tap / reconnect) can never double-charge or
        // double-award; the server ledger keys on it.
        const giftEventId = crypto.randomUUID()
        const res = await api.spinBottle.gifts.send(roomId, recipientId, gift.id, qty, giftEventId)
        if (res?.ok) {
          onCoinBalance(res.coinBalance)
          // Realm PRD §61 — echo the point allocation so the player sees the
          // payoff (coins never multiply, points do).
          if (res.multiplier && res.multiplier > 1 && res.senderPoints) {
            toast.success(`+${res.senderPoints} Realm Points${res.multiplier ? ` · ${res.multiplier}× event` : ''}`)
          }
          launchGiftFly({
            fromUserId: meId || undefined,
            toUserIds: [recipientId],
            icon: gift.icon,
            iconType: gift.iconType,
            quantity: qty,
          })
          return true
        }
        return false
      } catch (e: any) {
        if (e?.body?.coinBalance !== undefined) onCoinBalance(Number(e.body.coinBalance))
        else onReconcile?.()
        toast.error(
          e?.body?.error === 'insufficient_coins'
            ? 'Not enough coins — top up in the coin store.'
            : (e?.message ?? 'Failed to send gift')
        )
        return false
      }
    },
    [roomId, coinBalance, meId, onCoinBalance, onReconcile]
  )

  // ── The surfaces — render this ONCE anywhere in the room's tree.
  const surfaces = (
    <>
      <PlayerInteractionSheet
        player={interaction?.player ?? null}
        mode={mode}
        anchor={interaction?.anchor ?? null}
        coinBalance={coinBalance}
        onClose={() => setInteraction(null)}
        onTag={handleTag}
        onMessage={handleMessage}
        onMention={handleMention}
        onProfile={handleProfile}
        isFriend={interaction ? friendIds.has(interaction.player.userId) : false}
        friendBusy={!!interaction && friendBusy === interaction.player.userId}
        onToggleFriend={handleToggleFriend}
        onBuyCoins={() => {
          setInteraction(null)
          onOpenCoinStore()
        }}
        onSendGift={sendGift}
      />
      <GiftSheet
        open={giftOpen}
        onClose={() => setGiftOpen(false)}
        roomId={roomId ?? ''}
        players={members}
        meId={meId}
        coinBalance={coinBalance}
        onGiftSent={(newBalance) => onCoinBalance(newBalance)}
        onBuyCoins={() => {
          setGiftOpen(false)
          onOpenCoinStore()
        }}
      />
    </>
  )

  return {
    /** Open the toolbox for ANY player surface (userId in → toolbox out). */
    open,
    close,
    /** Interaction sheet + gift sheet — render once per room. */
    surfaces,
    /** Bulk gift sheet opener (room HUD "send a gift" shortcuts). */
    openGiftSheet: () => setGiftOpen(true),
    sendGift,
    friendIds,
  }
}
