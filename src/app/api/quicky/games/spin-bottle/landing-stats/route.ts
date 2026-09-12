// Quicky — Spin the Bottle landing stats (v3 PRD §15-§18)
// EVERYTHING here is database-driven — no placeholders. Kisses come from
// KissPointTransaction rows (one qualifying kiss = one row = one point, PRD
// §24), games from completed spins the user took part in, coins from the
// wallet balance, gift totals from SpinRoomGift transactions.
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

export async function GET(_req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [kissesReceived, kissesGiven, gamesPlayed, giftSentAgg, giftRecvAgg, me2] =
    await Promise.all([
      // Every KissPointTransaction row with me as recipient = one kiss received
      db.kissPointTransaction.count({ where: { toUserId: me.id } }),
      // Kisses I chose to give (my ❤️ responses that earned the other a point)
      db.kissPointTransaction.count({ where: { fromUserId: me.id } }),
      // Games = completed spin rounds I participated in (as spinner or target)
      db.spinBottleSpin.count({
        where: { status: 'completed', OR: [{ spinnerId: me.id }, { targetId: me.id }] },
      }),
      // Total gifts SENT (sum of quantities across my gift transactions)
      db.spinRoomGift.aggregate({ where: { senderId: me.id }, _sum: { quantity: true } }),
      // Total gifts RECEIVED
      db.spinRoomGift.aggregate({ where: { recipientId: me.id }, _sum: { quantity: true } }),
      db.user.findUnique({ where: { id: me.id }, select: { quickyScore: true, coinBalance: true } }),
    ])

  const level = Math.max(1, Math.floor((me2?.quickyScore ?? 0) / 50) + 1)

  return NextResponse.json({
    gamesPlayed,
    kissesReceived,
    kissesGiven,
    giftsSent: giftSentAgg._sum.quantity ?? 0,
    giftsReceived: giftRecvAgg._sum.quantity ?? 0,
    coins: me2?.coinBalance ?? 0,
    level,
  })
}
