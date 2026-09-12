// Quicky — Spin the Bottle coins (v3 PRD §26-§30)
// GET  → current coin balance.
// POST → MOCK / DEVELOPMENT PURCHASE. Adds coins for the selected package,
//        persists a CoinLedger audit row (`reason: 'purchase'`, meta marks it
//        mock). No Google Play / Apple IAP / Stripe — the client calls
//        `purchaseCoins(packageId)` (api.spinBottle.coins.purchase), so the
//        mock can later be swapped for a real store flow without UI changes.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/quicky/auth'
import { COIN_PACKS } from '@/lib/quicky/constants'

export async function GET(_req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const user = await db.user.findUnique({ where: { id: me.id }, select: { coinBalance: true } })
  return NextResponse.json({ coinBalance: user?.coinBalance ?? 0 })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const packageId = String(body?.packageId ?? '')
  const pack = COIN_PACKS.find((p) => p.id === packageId)
  if (!pack) return NextResponse.json({ error: 'invalid_package' }, { status: 400 })

  // MOCK purchase: simulate success → add coins → persist audit row.
  const meta = JSON.stringify({ packageId: pack.id, coins: pack.coins, mock: true, label: pack.label })
  const updated = await db.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: me.id },
      data: { coinBalance: { increment: pack.coins } },
      select: { coinBalance: true },
    })
    await tx.coinLedger.create({
      data: { userId: me.id, delta: pack.coins, reason: 'purchase', meta },
    })
    return user
  })

  return NextResponse.json({
    ok: true,
    mock: true, // explicit: this whole flow is MOCK / DEVELOPMENT (§29)
    packageId: pack.id,
    coinsAdded: pack.coins,
    coinBalance: updated.coinBalance,
  })
}
