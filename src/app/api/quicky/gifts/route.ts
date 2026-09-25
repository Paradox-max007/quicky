// Quicky — GIFTS HUB API (main game screen)
// GET  /api/quicky/gifts → the DB-driven gift catalog (GameItem category
//        'gift', admin-owned) + the viewer's coin balance. Same catalog the
//        room gift drawer serves — reused by the Gifts & Cosmetics modal on
//        the game primary screen (no room needed for browsing).
// POST /api/quicky/gifts → send a gift OUTSIDE a room, to a FRIEND:
//        { recipientId, itemId, quantity? }
//        · Same economy as the room flow: totalCost = unitPrice × quantity,
//          the recipient earns 50% back in coins, lifetime counters bump
//          (giftsSentCount / giftsReceivedCount) and both sides get ledger
//          rows ('gift_sent' / 'gift_received').
//        · Race-safe coin deduction (conditional decrement — never negative,
//          never partial). Balance < cost → 402 insufficient_coins.
//        · No room context → no SpinRoomGift rows / room broadcasts. Realm
//          points are room-scoped and intentionally NOT awarded here.
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const [items, user] = await Promise.all([
    db.gameItem.findMany({
      where: { isActive: true, category: 'gift' },
      orderBy: { sortOrder: 'asc' },
    }),
    db.user.findUnique({ where: { id: me.id }, select: { coinBalance: true, giftsSentCount: true, giftsReceivedCount: true } }),
  ])

  const catalog = items.map((g) => ({
    id: g.id,
    categoryId: g.categoryId,
    name: g.name,
    // Resolved display payload — iconValue (image URL) wins, emoji fallback.
    icon: g.iconValue ?? g.emoji,
    iconType: g.iconType,
    iconValue: g.iconValue ?? g.emoji,
    emoji: g.emoji,
    priceCoins: g.coinPrice,
    maxQuantity: g.maxQuantity,
    tier: g.tier,
    sortOrder: g.sortOrder,
  }))

  return NextResponse.json({
    catalog,
    coinBalance: user?.coinBalance ?? 0,
    giftsSent: user?.giftsSentCount ?? 0,
    giftsReceived: user?.giftsReceivedCount ?? 0,
  })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const recipientId = typeof body?.recipientId === 'string' ? body.recipientId : ''
  const itemId = typeof body?.itemId === 'string' ? body.itemId : ''
  const quantity = Math.floor(Number(body?.quantity ?? 1))
  if (!recipientId || !itemId) return NextResponse.json({ error: 'missing_fields' }, { status: 400 })
  if (!Number.isFinite(quantity) || quantity < 1 || quantity > 1000) {
    return NextResponse.json({ error: 'invalid_quantity' }, { status: 400 })
  }
  // Self-gifting stays allowed (room-flow parity — you pay, you get it).

  const [giftDef, recipient] = await Promise.all([
    db.gameItem.findFirst({ where: { id: itemId, isActive: true, category: 'gift' } }),
    db.user.findUnique({ where: { id: recipientId }, select: { id: true, name: true } }),
  ])
  if (!giftDef) return NextResponse.json({ error: 'invalid_item' }, { status: 400 })
  if (!recipient) return NextResponse.json({ error: 'recipient_not_found' }, { status: 400 })

  const unitPrice = giftDef.coinPrice
  if (!Number.isInteger(unitPrice) || unitPrice < 0) return NextResponse.json({ error: 'invalid_item' }, { status: 400 })
  const rawMaxQty = giftDef.maxQuantity ?? 0
  const maxQty = Number.isInteger(rawMaxQty) && rawMaxQty > 0 ? rawMaxQty : 1000
  if (quantity > maxQty) return NextResponse.json({ error: 'invalid_quantity' }, { status: 400 })

  const totalCost = unitPrice * quantity
  const recipientReward = Math.floor((unitPrice * quantity) / 2) // 50% back, single recipient

  const itemIcon = giftDef.iconType === 'image' || giftDef.iconType === 'png' ? (giftDef.iconValue ?? giftDef.emoji) : giftDef.emoji
  const metadata = JSON.stringify({
    itemId: giftDef.id,
    itemName: giftDef.name,
    itemEmoji: giftDef.emoji,
    itemIcon,
    itemIconType: giftDef.iconType,
    recipientId: recipient.id,
    recipientName: recipient.name,
    quantity,
    context: 'gifts_hub',
  })

  // ONE atomic transaction — verify balance, deduct, credit, ledger, counters.
  const result = await db
    .$transaction(async (tx) => {
      const debited = await tx.user.updateMany({
        where: { id: me.id, coinBalance: { gte: totalCost } },
        data: { coinBalance: { decrement: totalCost }, giftsSentCount: { increment: quantity } },
      })
      if (debited.count === 0) return { insufficient: true as const }
      await tx.user.update({
        where: { id: recipient.id },
        data: { coinBalance: { increment: recipientReward }, giftsReceivedCount: { increment: quantity } },
      })
      if (recipientReward > 0) {
        await tx.coinLedger.create({ data: { userId: recipient.id, delta: recipientReward, reason: 'gift_received', meta: metadata } })
      }
      await tx.coinLedger.create({ data: { userId: me.id, delta: -totalCost, reason: 'gift_sent', meta: metadata } })
      const fresh = await tx.user.findUnique({ where: { id: me.id }, select: { coinBalance: true } })
      return { insufficient: false as const, balance: fresh?.coinBalance ?? 0 }
    })
    .catch(() => null)

  if (!result) return NextResponse.json({ error: 'send_failed' }, { status: 500 })
  if (result.insufficient) {
    const bal = (await db.user.findUnique({ where: { id: me.id }, select: { coinBalance: true } }))?.coinBalance ?? 0
    return NextResponse.json({ error: 'insufficient_coins', coinBalance: bal }, { status: 402 })
  }

  return NextResponse.json({
    ok: true,
    coinBalance: result.balance,
    recipientName: recipient.name ?? 'Someone',
    quantity,
    totalCost,
    recipientReward,
  })
}
