// Quicky — Spin the Bottle gifts (v3 PRD §47-§61, §86-§88)
// GET  → DB-DRIVEN gift catalog (GiftCategory + GameItem rows — the admin
//        panel owns this data, nothing is hardcoded) + the viewer's balance.
// POST → send a gift inside a room. Server validates EVERYTHING (§86): gift
//        active, recipient in-room, price from the DB (never the client,
//        §71), balance ≥ cost enforced RACE-SAFELY inside the transaction
//        (conditional updateMany, §87/§88: no negative balance is possible).
//        The transaction also writes the CoinLedger rows, the SpinRoomGift
//        transaction (with the transaction-time price snapshot, §52) and the
//        gift chat message, then wakes the room SSE stream so every member's
//        HUD updates instantly (§59/§60).
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { touchMemberActivity } from '@/lib/quicky/room-activity'
import { getClient } from '@/lib/quicky/realtime'
import { emitRoomUpdate } from '@/lib/quicky/spin-events'

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
  const quantity = Math.floor(Number(body?.quantity ?? 1))
  if (!roomId || !recipientId || !itemId) return NextResponse.json({ error: 'missing_fields' }, { status: 400 })
  if (!Number.isFinite(quantity) || quantity < 1 || quantity > 12) {
    return NextResponse.json({ error: 'invalid_quantity' }, { status: 400 })
  }
  if (me.id === recipientId) return NextResponse.json({ error: 'cannot_gift_yourself' }, { status: 400 })

  // Price + activation come from the DB — the client's number is NEVER
  // trusted (v3 §71/§86).
  const giftDef = await db.gameItem.findFirst({
    where: { id: itemId, isActive: true, category: 'gift' },
  })
  if (!giftDef) return NextResponse.json({ error: 'invalid_item' }, { status: 400 })
  const unitPrice = giftDef.coinPrice
  if (!Number.isInteger(unitPrice) || unitPrice < 0) {
    return NextResponse.json({ error: 'invalid_item' }, { status: 400 })
  }
  const totalCost = unitPrice * quantity

  const [senderMembership, recipientMembership, recipient] = await Promise.all([
    db.spinRoomPlayer.findFirst({ where: { roomId, userId: me.id, isActive: true } }),
    db.spinRoomPlayer.findFirst({ where: { roomId, userId: recipientId, isActive: true } }),
    db.user.findUnique({ where: { id: recipientId }, select: { name: true } }),
  ])
  if (!senderMembership) return NextResponse.json({ error: 'not_in_room' }, { status: 403 })
  if (!recipientMembership) return NextResponse.json({ error: 'recipient_not_in_room' }, { status: 400 })

  const metadata = JSON.stringify({
    itemId: giftDef.id,
    itemName: giftDef.name,
    itemEmoji: giftDef.emoji,
    recipientId,
    recipientName: recipient?.name ?? 'Someone',
    quantity,
  })

  // Recipient keeps earning half the spend back as coins (existing behavior).
  const recipientReward = Math.floor(totalCost * 0.5)

  // ATOMIC send (§54): a single interactive transaction. The balance
  // decrement is a CONDITIONAL update (`coinBalance >= totalCost`) so two
  // concurrent sends can never drive the balance negative (§87).
  const newBalance = await db.$transaction(async (tx) => {
    const debited = await tx.user.updateMany({
      where: { id: me.id, coinBalance: { gte: totalCost } },
      data: { coinBalance: { decrement: totalCost } },
    })
    if (debited.count === 0) {
      // Throws → whole transaction rolls back → API maps to 402 below.
      throw new Error('insufficient_coins')
    }
    await tx.user.update({ where: { id: recipientId }, data: { coinBalance: { increment: recipientReward }, giftsReceivedCount: { increment: quantity } } })
    // Lifecycle PRD §20/§21: lifetime gift counters live on the USER rows —
    // SpinRoomGift rows are temporary room data and cascade away with the
    // room, but these counters (like the CoinLedger) are permanent.
    await tx.user.update({ where: { id: me.id }, data: { giftsSentCount: { increment: quantity } } })
    await tx.coinLedger.create({ data: { userId: me.id, delta: -totalCost, reason: 'gift_sent', meta: metadata } })
    if (recipientReward > 0) {
      await tx.coinLedger.create({ data: { userId: recipientId, delta: recipientReward, reason: 'gift_received', meta: metadata } })
    }
    // Gift transaction row — `coinsSpent` snapshots the transaction-time
    // price (v3 §52: a later price change never rewrites history).
    await tx.spinRoomGift.create({
      data: { roomId, senderId: me.id, recipientId, itemId: giftDef.id, quantity, coinsSpent: totalCost },
    })
    await tx.spinRoomMessage.create({
      data: { roomId, userId: me.id, text: `${giftDef.emoji} For ${recipient?.name ?? 'you'} x${quantity}`, kind: 'gift', metadata },
    })
    const fresh = await tx.user.findUnique({ where: { id: me.id }, select: { coinBalance: true } })
    return fresh?.coinBalance ?? 0
  }).catch((e: any) => {
    if (e?.message === 'insufficient_coins') return null
    throw e
  })

  if (newBalance === null) {
    const bal = (await db.user.findUnique({ where: { id: me.id }, select: { coinBalance: true } }))?.coinBalance ?? 0
    return NextResponse.json({ error: 'insufficient_coins', coinBalance: bal }, { status: 402 })
  }

  // Lifecycle §12: sending a gift counts as room activity (sender side).
  await touchMemberActivity(roomId, me.id).catch(() => {})

  // Wake every room member's SSE stream → fresh snapshot → HUD counters
  // (coins, gifts received) update without a refresh (§59/§60).
  emitRoomUpdate(roomId)

  const recipientCoins = (await db.user.findUnique({ where: { id: recipientId }, select: { coinBalance: true } }))?.coinBalance ?? 0

  // Supabase broadcast stays as the instant cosmetic push (toast/animation);
  // the SSE snapshot above is the authoritative sync path.
  const supabase = getClient()
  if (supabase) {
    const ch = supabase.channel(`room:${roomId}`)
    void ch.send({ type: 'broadcast', event: 'gift', payload: { senderId: me.id, senderName: (await db.user.findUnique({ where: { id: me.id }, select: { name: true } }))?.name, recipientId, recipientName: recipient?.name, itemId: giftDef.id, itemName: giftDef.name, itemEmoji: giftDef.emoji, quantity } })
    void ch.send({ type: 'broadcast', event: 'balance', payload: { userId: me.id, coinBalance: newBalance } })
    void ch.send({ type: 'broadcast', event: 'balance', payload: { userId: recipientId, coinBalance: recipientCoins } })
  }

  return NextResponse.json({ ok: true, coinBalance: newBalance })
}
