// Quicky — PURCHASE HISTORY (Monetization PRD §7)
// GET /api/quicky/payments/history → the user's orders + wallet ledger tail.
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const [purchases, walletTx] = await Promise.all([
    db.gamePurchase.findMany({
      where: { userId: me.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        productType: true,
        provider: true,
        currency: true,
        amount: true,
        coins: true,
        bonusCoins: true,
        status: true,
        createdAt: true,
        completedAt: true,
      },
    }),
    db.walletTransaction.findMany({
      where: { userId: me.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        currencyType: true,
        amount: true,
        transactionType: true,
        source: true,
        balanceAfter: true,
        createdAt: true,
      },
    }),
  ])

  return NextResponse.json({ purchases, walletTransactions: walletTx })
}
