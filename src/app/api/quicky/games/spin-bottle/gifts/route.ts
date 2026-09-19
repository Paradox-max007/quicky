// Quicky — Spin the Bottle gifts (Games PRD §18-§28 + v3 §47-§61, §86-§88)
// GET  → DB-DRIVEN gift catalog (GiftCategory + GameItem rows — the admin
//        panel owns this data, nothing is hardcoded) + the viewer's balance.
// POST → send a gift inside a room, SINGLE recipient or BULK:
//
//   { roomId, itemId, recipientId?, quantity?, recipientFilter? }
//     · recipientId       → legacy single-recipient send
//     · recipientFilter   → 'all' | 'male' | 'female'  (§18/§23/§24):
//                           the SERVER resolves the recipient list from the
//                           room's active players (sender always excluded);
//                           the client never sends recipientCount/totalPrice
//                           (§25 — those are computed here).
//     · quantity          → 1 | 10 | 50 | 100 | 1000 (§21), capped at 1000.
//
// totalCost = unitPrice × quantity × recipientCount (§22), deducted RACE-SAFELY
// in ONE transaction (conditional `coinBalance >= totalCost` decrement — no
// negative balance, no partial bulk send, §26/§87/§88). Balance < cost → 402
// `insufficient_coins` and the CLIENT opens the existing coin-purchase modal
// (§27 — never a broken flow).
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { touchMemberActivity } from '@/lib/quicky/room-activity'
import { getClient } from '@/lib/quicky/realtime'
import { emitRoomUpdate } from '@/lib/quicky/spin-events'
import { effectiveSeatGender, normalizeGender } from '@/lib/quicky/room-assignment'

export async function GET(_req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const [categories, items, user] = await Promise.all([
    db.giftCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    }),
    db.gameItem.findMany({
      where: { isActive: true, category: 'gift' },
      orderBy: { sortOrder: 'asc' },
    }),
    db.user.findUnique({ where: { id: me.id }, select: { coinBalance: true } }),
  ])

  const catalog = items.map((g) => ({
    id: g.id,
    categoryId: g.categoryId,
    name: g.name,
    // v3 §48: `icon` is the resolved display payload — iconValue wins,
    // legacy `emoji` column is the fallback.
    icon: g.iconValue ?? g.emoji,
    // v3 §67: iconType/iconValue remain exposed for the future image support.
    iconType: g.iconType,
    iconValue: g.iconValue ?? g.emoji,
    emoji: g.emoji,
    priceCoins: g.coinPrice,
    tier: g.tier,
    sortOrder: g.sortOrder,
    isActive: g.isActive,
  }))

  return NextResponse.json({
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      icon: c.icon,
      sortOrder: c.sortOrder,
    })),
    catalog,
    coinBalance: user?.coinBalance ?? 0,
  })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const { roomId, recipientId, itemId } = body ?? {}
  const recipientFilter = typeof body?.recipientFilter === 'string' ? body.recipientFilter : null
  const quantity = Math.floor(Number(body?.quantity ?? 1))

  if (!roomId || !itemId) return NextResponse.json({ error: 'missing_fields' }, { status: 400 })
  if (!recipientId && !recipientFilter) return NextResponse.json({ error: 'missing_fields' }, { status: 400 })
  // §21 — quantity selector: 1/10/50/100/1000 chips (any integer 1..1000 is
  // accepted server-side; the UI exposes exactly the five chips).
  if (!Number.isFinite(quantity) || quantity < 1 || quantity > 1000) {
    return NextResponse.json({ error: 'invalid_quantity' }, { status: 400 })
  }
  if (recipientId && me.id === recipientId) {
    return NextResponse.json({ error: 'cannot_gift_yourself' }, { status: 400 })
  }

  // Price + activation come from the DB — the client's number is NEVER
  // trusted (v3 §71/§86). Max quantity is admin-configurable per gift (§62).
  const giftDef = await db.gameItem.findFirst({
    where: { id: itemId, isActive: true, category: 'gift' },
  })
  if (!giftDef) return NextResponse.json({ error: 'invalid_item' }, { status: 400 })
  const unitPrice = giftDef.coinPrice
  if (!Number.isInteger(unitPrice) || unitPrice < 0) {
    return NextResponse.json({ error: 'invalid_item' }, { status: 400 })
  }
  const maxQty = Number.isInteger(giftDef.maxQuantity) && giftDef.maxQuantity! > 0 ? giftDef.maxQuantity! : 1000
  if (quantity > maxQty) return NextResponse.json({ error: 'invalid_quantity' }, { status: 400 })

  const senderMembership = await db.spinRoomPlayer.findFirst({
    where: { roomId, userId: me.id, isActive: true },
  })
  if (!senderMembership) return NextResponse.json({ error: 'not_in_room' }, { status: 403 })

  // ── Resolve recipients SERVER-side (§23/§24/§25) ──────────────────────────
  let recipients: { userId: string; name: string }[]
  if (recipientId) {
    const inRoom = await db.spinRoomPlayer.findFirst({
      where: { roomId, userId: recipientId, isActive: true },
    })
    if (!inRoom) return NextResponse.json({ error: 'recipient_not_in_room' }, { status: 400 })
    const u = await db.user.findUnique({ where: { id: recipientId }, select: { name: true } })
    recipients = [{ userId: recipientId, name: u?.name ?? 'Someone' }]
  } else {
    // 'all' → every eligible player in the room except the sender (§23);
    // 'male'/'female' → gender filter (§24). Effective seat gender comes
    // from the profile, falling back to the seat's gender slot.
    const members = await db.spinRoomPlayer.findMany({
      where: { roomId, isActive: true, leftAt: null, userId: { not: me.id } },
      select: { userId: true, seatIndex: true },
    })
    const users = await db.user.findMany({
      where: { id: { in: members.map((m) => m.userId) } },
      select: { id: true, name: true, gender: true },
    })
    const byId = new Map(users.map((u) => [u.id, u]))
    const wanted = recipientFilter === 'male' ? 'male' : recipientFilter === 'female' ? 'female' : null
    if (recipientFilter && recipientFilter !== 'all' && !wanted) {
      return NextResponse.json({ error: 'invalid_filter' }, { status: 400 })
    }
    recipients = members
      .map((m) => {
        const u = byId.get(m.userId)
        if (!u) return null
        if (wanted) {
          const g = effectiveSeatGender(u.gender, m.seatIndex)
          if (g !== wanted) return null
        }
        return { userId: m.userId, name: u.name ?? 'Someone' }
      })
      .filter((r): r is { userId: string; name: string } => r !== null)
    if (recipients.length === 0) {
      return NextResponse.json({ error: 'no_recipients' }, { status: 400 })
    }
  }

  const recipientCount = recipients.length
  // §22 — totalCost = giftPrice × quantity × recipientCount
  const totalCost = unitPrice * quantity * recipientCount
  const recipientReward = Math.floor((unitPrice * quantity * recipientCount * 0.5) / recipientCount)
  const perRecipientCost = unitPrice * quantity

  const firstName = recipients[0]?.name ?? 'you'
  const metadata = JSON.stringify({
    itemId: giftDef.id,
    itemName: giftDef.name,
    itemEmoji: giftDef.emoji,
    recipientId: recipients.length === 1 ? recipients[0].userId : null,
    recipientName: recipients.length === 1 ? firstName : null,
    recipientCount,
    recipientIds: recipients.map((r) => r.userId),
    quantity,
    bulk: recipientCount > 1 || quantity > 1,
  })

  // ATOMIC bulk send (§26): ONE interactive transaction — verify balance,
  // deduct coins, credit recipients, write ledger + gift transactions + the
  // aggregated chat message. Any failure rolls EVERYTHING back (§26: no
  // partial bulk gifts; §111: no negative balance).
  //
  // P2028 FIX (Unified PRD): the recipient writes are BATCHED (updateMany +
  // createMany) instead of a per-recipient query loop — a 1000-recipient
  // bulk send used to issue ~5000 sequential round-trips inside the
  // interactive transaction and blew Prisma's timeout (P2028). Now the
  // whole transaction is O(1) queries regardless of recipient count (all
  // recipients earn the same reward, so grouped writes are exact).
  const newBalance = await db
    .$transaction(
      async (tx) => {
        const debited = await tx.user.updateMany({
          where: { id: me.id, coinBalance: { gte: totalCost } },
          data: { coinBalance: { decrement: totalCost } },
        })
        if (debited.count === 0) {
          throw new Error('insufficient_coins')
        }
        const recipientIds = recipients.map((r) => r.userId)
        // Same reward for every recipient → ONE grouped update.
        await tx.user.updateMany({
          where: { id: { in: recipientIds } },
          data: { coinBalance: { increment: recipientReward }, giftsReceivedCount: { increment: quantity } },
        })
        if (recipientReward > 0) {
          // Per-recipient ledger rows in ONE batched insert.
          await tx.coinLedger.createMany({
            data: recipientIds.map((userId) => ({
              userId,
              delta: recipientReward,
              reason: 'gift_received',
              meta: metadata,
            })),
          })
        }
        // Gift transaction row per recipient — `coinsSpent` snapshots the
        // transaction-time price (v3 §52) — ONE batched insert.
        await tx.spinRoomGift.createMany({
          data: recipientIds.map((userId) => ({
            roomId,
            senderId: me.id,
            recipientId: userId,
            itemId: giftDef.id,
            quantity,
            coinsSpent: perRecipientCost,
          })),
        })
        // Lifetime counters live on the USER rows (lifecycle §20/§21).
        await tx.user.update({
          where: { id: me.id },
          data: { giftsSentCount: { increment: quantity * recipientCount } },
        })
        await tx.coinLedger.create({ data: { userId: me.id, delta: -totalCost, reason: 'gift_sent', meta: metadata } })
        // §28 — aggregated chat entry (never 1000 separate messages/animations).
        await tx.spinRoomMessage.create({
          data: {
            roomId,
            userId: me.id,
            text:
              recipientCount === 1
                ? `${giftDef.emoji} For ${firstName} x${quantity}`
                : `${giftDef.emoji} ${quantity}× ${giftDef.name} for ${recipientCount} players`,
            kind: 'gift',
            metadata,
          },
        })
        const fresh = await tx.user.findUnique({ where: { id: me.id }, select: { coinBalance: true } })
        return fresh?.coinBalance ?? 0
      },
      // Headroom for the batched writes on a slow network — still far below
      // the loop's unbounded runtime that triggered P2028.
      { timeout: 15_000, maxWait: 5_000 }
    )
    .catch((e: any) => {
      if (e?.message === 'insufficient_coins') return null
      throw e
    })

  if (newBalance === null) {
    const bal = (await db.user.findUnique({ where: { id: me.id }, select: { coinBalance: true } }))?.coinBalance ?? 0
    // §27 — the client reacts to `insufficient_coins` by opening the
    // existing coin-purchase modal (Cancel / Buy Coins). The gift drawer
    // stays open; nothing is partially sent.
    return NextResponse.json({ error: 'insufficient_coins', coinBalance: bal }, { status: 402 })
  }

  // Lifecycle §12: sending a gift counts as room activity (sender side).
  await touchMemberActivity(roomId, me.id).catch(() => {})

  // Wake every room member's SSE stream → fresh snapshot → HUD counters
  // (coins, gifts received) update without a refresh (§59/§60).
  emitRoomUpdate(roomId)

  // Supabase broadcast stays the instant cosmetic push (toast/animation);
  // the SSE snapshot above is the authoritative sync path. §28: one
  // AGGREGATED gift event — recipients only bump their own counter.
  // (P2028 hygiene: recipient balances come from ONE findMany, not a
  // per-recipient findUnique round-trip loop.)
  const supabase = getClient()
  if (supabase) {
    const [senderNameRow, recipientBalRows] = await Promise.all([
      db.user.findUnique({ where: { id: me.id }, select: { name: true } }),
      db.user.findMany({
        where: { id: { in: recipients.map((r) => r.userId) } },
        select: { id: true, coinBalance: true },
      }),
    ])
    const balanceById = new Map(recipientBalRows.map((u) => [u.id, u.coinBalance]))
    const ch = supabase.channel(`room:${roomId}`)
    void ch.send({
      type: 'broadcast',
      event: 'gift',
      payload: {
        senderId: me.id,
        senderName: senderNameRow?.name,
        recipientIds: recipients.map((r) => r.userId),
        recipientNames: recipients.map((r) => r.name),
        recipientId: recipients.length === 1 ? recipients[0].userId : null,
        recipientName: recipients.length === 1 ? firstName : null,
        itemId: giftDef.id,
        itemName: giftDef.name,
        itemEmoji: giftDef.emoji,
        quantity,
        recipientCount,
      },
    })
    void ch.send({ type: 'broadcast', event: 'balance', payload: { userId: me.id, coinBalance: newBalance } })
    for (const r of recipients) {
      void ch.send({
        type: 'broadcast',
        event: 'balance',
        payload: { userId: r.userId, coinBalance: balanceById.get(r.userId) ?? 0 },
      })
    }
  }

  return NextResponse.json({
    ok: true,
    coinBalance: newBalance,
    recipientCount,
    quantity,
    totalCost,
  })
}
