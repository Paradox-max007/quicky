import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/quicky/auth"
import { SPIN_BOTTLE_GIFTS } from "@/lib/quicky/constants"
import { getClient } from "@/lib/quicky/realtime"

export async function GET(_req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const user = await db.user.findUnique({ where: { id: me.id }, select: { coinBalance: true } })
  return NextResponse.json({ catalog: SPIN_BOTTLE_GIFTS, coinBalance: user?.coinBalance ?? 0 })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = await req.json()
  const { roomId, recipientId, itemId, quantity = 1 } = body
  if (!roomId || !recipientId || !itemId) return NextResponse.json({ error: "missing_fields" }, { status: 400 })
  if (me.id === recipientId) return NextResponse.json({ error: "cannot_gift_yourself" }, { status: 400 })

  const giftDef = SPIN_BOTTLE_GIFTS.find((g) => g.id === itemId)
  if (!giftDef) return NextResponse.json({ error: "invalid_item" }, { status: 400 })
  const totalCost = giftDef.coinPrice * quantity

  const [senderMembership, recipientMembership] = await Promise.all([
    db.spinRoomPlayer.findFirst({ where: { roomId, userId: me.id, isActive: true } }),
    db.spinRoomPlayer.findFirst({ where: { roomId, userId: recipientId, isActive: true } }),
  ])
  if (!senderMembership) return NextResponse.json({ error: "not_in_room" }, { status: 403 })
  if (!recipientMembership) return NextResponse.json({ error: "recipient_not_in_room" }, { status: 400 })

  const [sender, recipient] = await Promise.all([
    db.user.findUnique({ where: { id: me.id }, select: { coinBalance: true, name: true } }),
    db.user.findUnique({ where: { id: recipientId }, select: { name: true } }),
  ])
  if (!sender || sender.coinBalance < totalCost) {
    return NextResponse.json({ error: "insufficient_coins", coinBalance: sender?.coinBalance ?? 0 }, { status: 402 })
  }

  const recipientReward = Math.floor(totalCost * 0.5)
  const metadata = JSON.stringify({ itemId, itemName: giftDef.name, itemEmoji: giftDef.emoji, recipientId, recipientName: recipient?.name ?? "Someone", quantity })

  await db.$transaction([
    db.user.update({ where: { id: me.id }, data: { coinBalance: { decrement: totalCost } } }),
    db.user.update({ where: { id: recipientId }, data: { coinBalance: { increment: recipientReward } } }),
    db.coinLedger.create({ data: { userId: me.id, delta: -totalCost, reason: "gift_sent", meta: metadata } }),
    db.coinLedger.create({ data: { userId: recipientId, delta: recipientReward, reason: "gift_received", meta: metadata } }),
    db.spinRoomGift.create({ data: { roomId, senderId: me.id, recipientId, itemId, quantity, coinsSpent: totalCost } }),
    db.spinRoomMessage.create({ data: { roomId, userId: me.id, text: `${giftDef.emoji} For ${recipient?.name ?? "you"} x${quantity}`, kind: "gift", metadata } }),
  ])

  const [newSender, newRecipient] = await Promise.all([
    db.user.findUnique({ where: { id: me.id }, select: { coinBalance: true } }),
    db.user.findUnique({ where: { id: recipientId }, select: { coinBalance: true } }),
  ])

  const supabase = getClient()
  if (supabase) {
    const ch = supabase.channel(`room:${roomId}`)
    void ch.send({ type: "broadcast", event: "gift", payload: { senderId: me.id, senderName: sender.name, recipientId, recipientName: recipient?.name, itemId, itemName: giftDef.name, itemEmoji: giftDef.emoji, quantity } })
    void ch.send({ type: "broadcast", event: "balance", payload: { userId: me.id, coinBalance: newSender?.coinBalance ?? 0 } })
    void ch.send({ type: "broadcast", event: "balance", payload: { userId: recipientId, coinBalance: newRecipient?.coinBalance ?? 0 } })
  }

  return NextResponse.json({ ok: true, coinBalance: newSender?.coinBalance ?? 0 })
}
