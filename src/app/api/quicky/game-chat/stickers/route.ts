// Quicky — GAME STICKERS for the composer (game-chat PRD §62-§78)
// GET  /api/quicky/game-chat/stickers
//      → active bundles (+ stickers) with MY ownership flags; the composer
//        tray renders owned stickers and — for un-owned bundles — the coin
//        price / league requirement.
// POST /api/quicky/game-chat/stickers { action: 'purchase' | 'claim', bundleId }
//      · purchase (§64/§76): server-side coin deduction in ONE transaction
//        (CoinLedger row + balance + ownership). The client NEVER grants.
//      · claim (§65/§77): the SERVER evaluates league eligibility (bundled
//        minimumLeaguePoints vs my quickyScore) — the client never self-grants.
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [bundles, owned] = await Promise.all([
    db.gameStickerBundle.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        stickers: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }] },
        league: { select: { name: true } },
        season: { select: { name: true } },
      },
    }),
    db.userGameStickerBundle.findMany({ where: { userId: me.id }, select: { bundleId: true } }),
  ])
  const ownedIds = new Set(owned.map((o) => o.bundleId))

  return NextResponse.json({
    bundles: bundles.map((b) => ({
      id: b.id,
      name: b.name,
      description: b.description,
      icon: b.icon,
      league: b.league?.name ?? null,
      season: b.season?.name ?? null,
      priceCoins: b.priceCoins,
      minimumLeaguePoints: b.minimumLeaguePoints,
      purchaseEnabled: b.purchaseEnabled,
      rewardEnabled: b.rewardEnabled,
      owned: ownedIds.has(b.id),
      stickers: b.stickers.map((s) => ({ id: s.id, name: s.name, assetUrl: s.assetUrl })),
    })),
    coinBalance: (await db.user.findUnique({ where: { id: me.id }, select: { coinBalance: true } }))?.coinBalance ?? 0,
  })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const action = body?.action === 'claim' ? 'claim' : 'purchase'
  const bundleId = body?.bundleId ? String(body.bundleId) : null
  if (!bundleId) return NextResponse.json({ error: 'bundleId required' }, { status: 400 })

  const bundle = await db.gameStickerBundle.findUnique({ where: { id: bundleId } })
  if (!bundle || !bundle.isActive) return NextResponse.json({ error: 'bundle_unavailable' }, { status: 404 })

  const already = await db.userGameStickerBundle.findUnique({
    where: { userId_bundleId: { userId: me.id, bundleId } },
  })
  if (already) return NextResponse.json({ ok: true, alreadyOwned: true, coinBalance: (await db.user.findUnique({ where: { id: me.id }, select: { coinBalance: true } }))?.coinBalance ?? 0 })

  if (action === 'purchase') {
    if (!bundle.purchaseEnabled || bundle.priceCoins <= 0) {
      return NextResponse.json({ error: 'purchase_not_available' }, { status: 400 })
    }
    const result = await db
      .$transaction(async (tx) => {
        const u = await tx.user.findUnique({ where: { id: me.id }, select: { coinBalance: true } })
        if (!u || u.coinBalance < bundle.priceCoins) throw new Error('insufficient_coins')
        const updated = await tx.user.update({
          where: { id: me.id },
          data: { coinBalance: { decrement: bundle.priceCoins } },
          select: { coinBalance: true },
        })
        await tx.coinLedger.create({
          data: { userId: me.id, delta: -bundle.priceCoins, reason: 'sticker_bundle_purchase' },
        })
        await tx.userGameStickerBundle.create({
          data: { userId: me.id, bundleId, source: 'purchase' },
        })
        return updated.coinBalance
      })
      .catch((e: any) => {
        if (e?.message === 'insufficient_coins') return null
        throw e
      })
    if (result === null) {
      return NextResponse.json({ error: 'insufficient_coins' }, { status: 402 })
    }
    return NextResponse.json({ ok: true, coinBalance: result })
  }

  // claim — league reward (§77): eligibility decided SERVER-side
  if (!bundle.rewardEnabled || bundle.minimumLeaguePoints <= 0) {
    return NextResponse.json({ error: 'claim_not_available' }, { status: 400 })
  }
  const u = await db.user.findUnique({ where: { id: me.id }, select: { quickyScore: true } })
  if (!u || u.quickyScore < bundle.minimumLeaguePoints) {
    return NextResponse.json({ error: 'league_points_insufficient', minimumLeaguePoints: bundle.minimumLeaguePoints }, { status: 403 })
  }
  await db.userGameStickerBundle.create({ data: { userId: me.id, bundleId, source: 'league_reward' } })
  return NextResponse.json({ ok: true })
}
