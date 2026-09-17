// Quicky — GAME STICKERS for the composer (game-chat PRD §62-§78 + Games PRD §29-§35)
// GET  /api/quicky/game-chat/stickers
//      → active bundles (+ stickers) with MY ownership flags; the composer
//        tray renders owned stickers and — for un-owned bundles — the unlock
//        requirement (coins price / league / season / event / subscription).
// POST /api/quicky/game-chat/stickers { action: 'purchase' | 'claim', bundleId }
//      · purchase (§64/§76): server-side coin deduction in ONE transaction
//        (CoinLedger row + balance + ownership). The client NEVER grants.
//      · claim (Games PRD §32): the SERVER evaluates the bundle's unlockType
//        — league points / active season / active event / premium
//        subscription / free — the client never self-grants.
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const UNLOCK_TYPES = ['free', 'coins', 'league', 'season', 'event', 'subscription']

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [bundles, owned, meRow] = await Promise.all([
    db.gameStickerBundle.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        stickers: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }] },
        league: { select: { name: true } },
        season: { select: { name: true } },
        event: { select: { name: true } },
      },
    }),
    db.userGameStickerBundle.findMany({ where: { userId: me.id }, select: { bundleId: true } }),
    db.user.findUnique({
      where: { id: me.id },
      select: { coinBalance: true, quickyScore: true, isPremium: true, premiumUntil: true, premiumTier: true },
    }),
  ])
  const ownedIds = new Set(owned.map((o) => o.bundleId))

  // §35 — the client can show exactly WHY a set is locked and whether I can
  // claim it right now, all server-computed (never client-guessed).
  const premiumActive =
    !!meRow?.isPremium && (!meRow?.premiumUntil || meRow.premiumUntil > new Date())

  return NextResponse.json({
    bundles: bundles.map((b) => {
      const unlockType = UNLOCK_TYPES.includes(b.unlockType) ? b.unlockType : 'coins'
      let canClaimNow = false
      if (!ownedIds.has(b.id)) {
        if (unlockType === 'free') canClaimNow = true
        else if (unlockType === 'league') canClaimNow = (meRow?.quickyScore ?? 0) >= b.minimumLeaguePoints && b.minimumLeaguePoints > 0
        else if (unlockType === 'season') canClaimNow = !!b.seasonId
        else if (unlockType === 'event') canClaimNow = !!b.eventId
        else if (unlockType === 'subscription') canClaimNow = premiumActive
      }
      return {
        id: b.id,
        name: b.name,
        description: b.description,
        icon: b.icon,
        unlockType,
        league: b.league?.name ?? null,
        season: b.season?.name ?? null,
        event: b.event?.name ?? null,
        priceCoins: b.priceCoins,
        minimumLeaguePoints: b.minimumLeaguePoints,
        purchaseEnabled: b.purchaseEnabled,
        rewardEnabled: b.rewardEnabled,
        owned: ownedIds.has(b.id),
        canClaimNow,
        stickers: b.stickers.map((s) => ({ id: s.id, name: s.name, assetUrl: s.assetUrl })),
      }
    }),
    coinBalance: meRow?.coinBalance ?? 0,
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
  if (already) {
    return NextResponse.json({
      ok: true,
      alreadyOwned: true,
      coinBalance: (await db.user.findUnique({ where: { id: me.id }, select: { coinBalance: true } }))?.coinBalance ?? 0,
    })
  }

  // ── purchase (coins unlock, §64/§76) ───────────────────────────────────────
  if (action === 'purchase') {
    if (bundle.unlockType === 'free') {
      await db.userGameStickerBundle.create({ data: { userId: me.id, bundleId, source: 'free_grant' } })
      return NextResponse.json({ ok: true })
    }
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

  // ── claim — server-evaluated unlocks (Games PRD §32) ───────────────────────
  const unlockType = UNLOCK_TYPES.includes(bundle.unlockType) ? bundle.unlockType : 'coins'

  if (unlockType === 'coins') {
    return NextResponse.json({ error: 'claim_not_available', reason: 'coins_unlock' }, { status: 400 })
  }

  if (unlockType === 'league') {
    // Legacy behaviour (§77): league reward via minimumLeaguePoints.
    if (!bundle.rewardEnabled || bundle.minimumLeaguePoints <= 0) {
      return NextResponse.json({ error: 'claim_not_available' }, { status: 400 })
    }
    const u = await db.user.findUnique({ where: { id: me.id }, select: { quickyScore: true } })
    if (!u || u.quickyScore < bundle.minimumLeaguePoints) {
      return NextResponse.json(
        { error: 'league_points_insufficient', minimumLeaguePoints: bundle.minimumLeaguePoints },
        { status: 403 }
      )
    }
    await db.userGameStickerBundle.create({ data: { userId: me.id, bundleId, source: 'league_reward' } })
    return NextResponse.json({ ok: true })
  }

  if (unlockType === 'season') {
    if (!bundle.seasonId) return NextResponse.json({ error: 'claim_not_available' }, { status: 400 })
    const season = await db.gameSeason.findUnique({ where: { id: bundle.seasonId } })
    const within =
      !!season &&
      season.isActive &&
      (!season.startsAt || season.startsAt <= new Date()) &&
      (!season.endsAt || season.endsAt >= new Date())
    if (!within) return NextResponse.json({ error: 'season_inactive' }, { status: 403 })
    await db.userGameStickerBundle.create({ data: { userId: me.id, bundleId, source: 'season_reward' } })
    return NextResponse.json({ ok: true })
  }

  if (unlockType === 'event') {
    if (!bundle.eventId) return NextResponse.json({ error: 'claim_not_available' }, { status: 400 })
    const event = await db.gameEvent.findUnique({ where: { id: bundle.eventId } })
    const within =
      !!event &&
      event.isActive &&
      (!event.startsAt || event.startsAt <= new Date()) &&
      (!event.endsAt || event.endsAt >= new Date())
    if (!within) return NextResponse.json({ error: 'event_inactive' }, { status: 403 })
    await db.userGameStickerBundle.create({ data: { userId: me.id, bundleId, source: 'event_reward' } })
    return NextResponse.json({ ok: true })
  }

  if (unlockType === 'subscription') {
    const u = await db.user.findUnique({
      where: { id: me.id },
      select: { isPremium: true, premiumUntil: true },
    })
    const premiumActive = !!u?.isPremium && (!u?.premiumUntil || u.premiumUntil > new Date())
    if (!premiumActive) return NextResponse.json({ error: 'subscription_required' }, { status: 403 })
    await db.userGameStickerBundle.create({ data: { userId: me.id, bundleId, source: 'subscription_grant' } })
    return NextResponse.json({ ok: true })
  }

  // free
  await db.userGameStickerBundle.create({ data: { userId: me.id, bundleId, source: 'free_grant' } })
  return NextResponse.json({ ok: true })
}
