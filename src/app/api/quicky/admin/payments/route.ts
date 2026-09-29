// Quicky — ADMIN: STORE & PAYMENTS (Monetization PRD §9.2)
// GET  /api/quicky/admin/payments                 → orders + provider events + KPIs
// GET  /api/quicky/admin/payments?userId=..&status=.. → filtered search
// POST /api/quicky/admin/payments { action: 'refund', purchaseId } → record
//      a refund (provider charge is refunded in the provider dashboard; the
//      backend flips the order + writes the compensating wallet entry).
//
// PRD §9.2 rules honoured: product metadata/provider-id mapping is edited on
// the game-store screen; this surface covers ORDERS, provider events and
// safe refunds. Prices themselves are never set here — they live in Stripe
// and Play Console.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, logAdminAction } from '@/lib/quicky/admin'
import { refundGamePurchase } from '@/lib/quicky/payments/fulfill'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const sp = req.nextUrl.searchParams
  const userId = sp.get('userId')?.trim() || undefined
  const status = sp.get('status')?.trim() || undefined
  const provider = sp.get('provider')?.trim() || undefined

  const where = {
    ...(userId ? { userId } : {}),
    ...(status ? { status } : {}),
    ...(provider ? { provider } : {}),
  }

  const [orders, events, byProvider, totals] = await Promise.all([
    db.gamePurchase.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true, userId: true, productId: true, productType: true, provider: true,
        providerTransactionId: true, currency: true, amount: true, coins: true,
        bonusCoins: true, status: true, createdAt: true, completedAt: true,
      },
    }),
    db.paymentEvent.findMany({ orderBy: { processedAt: 'desc' }, take: 50 }),
    db.gamePurchase.groupBy({
      by: ['provider', 'status'],
      _count: { _all: true },
      _sum: { amount: true },
    }),
    db.gamePurchase.aggregate({
      where: { status: 'COMPLETED' },
      _count: { _all: true },
      _sum: { amount: true },
    }),
  ])

  const refunded = await db.gamePurchase.aggregate({
    where: { status: 'REFUNDED' },
    _count: { _all: true },
    _sum: { amount: true },
  })

  return NextResponse.json({
    orders: orders.map((o) => ({
      ...o,
      createdAt: o.createdAt.toISOString(),
      completedAt: o.completedAt?.toISOString() ?? null,
    })),
    events: events.map((e) => ({ ...e, processedAt: e.processedAt.toISOString() })),
    kpis: {
      fulfilledOrders: totals._count._all,
      grossVolume: totals._sum.amount ?? 0,
      refundedOrders: refunded._count._all,
      refundedVolume: refunded._sum.amount ?? 0,
      byProvider: byProvider.map((g) => ({
        provider: g.provider,
        status: g.status,
        count: g._count._all,
        volume: g._sum.amount ?? 0,
      })),
    },
  })
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const body = await req.json().catch(() => null)
  const action = String(body?.action ?? '')

  if (action === 'refund') {
    const purchaseId = String(body?.purchaseId ?? '')
    if (!purchaseId) return NextResponse.json({ error: 'invalid_purchase' }, { status: 400 })
    // Refund the charge in the provider dashboard FIRST (Stripe/Play) — this
    // records the currency-side reversal + order flip.
    const res = await refundGamePurchase(purchaseId, 'admin')
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
    await logAdminAction(gate.me.id, 'refund', 'game_purchase', purchaseId)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
}
