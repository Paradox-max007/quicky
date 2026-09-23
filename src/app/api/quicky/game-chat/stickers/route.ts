// Quicky — GAME STICKERS for the composer (game-chat PRD §62-§78 + Games PRD §29-§35
// + admin-console PRD §13)
// GET  /api/quicky/game-chat/stickers
//      → active bundles (+ stickers) with MY ownership flags; the composer
//        tray renders owned stickers and — for un-owned bundles — the unlock
//        requirement (coins price / realm / season / event / subscription).
// POST /api/quicky/game-chat/stickers { action: 'purchase' | 'claim', bundleId }
//      · purchase (§64/§76): server-side coin deduction in ONE transaction
//        (CoinLedger row + balance + ownership). The client NEVER grants.
//      · claim (Games PRD §32): the SERVER evaluates the bundle's unlockType
//        — realm result / active season / active event / premium
//        subscription / free — the client never self-grants.
//
// Admin-console PRD §13.2: the obsolete "minimum league points" rule is
// GONE (schema + backend). Realm-linked bundles unlock through the
// FINALIZED realm result: the player's best final rank in a settled cycle
// of the linked realm level must be within the configured winner positions
// (1st + 2nd by default).
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const UNLOCK_TYPES = ['free', 'coins', 'league', 'realm', 'season', 'event', 'subscription']

/** Admin-console PRD §13 — parse the bundle's winnerPositions JSON ([1,2]). */
function parseWinnerPositions(json: string | null): number[] {
  if (!json) return [1, 2]
  try {
    const arr = JSON.parse(json) as unknown
    if (!Array.isArray(arr)) return [1, 2]
    const positions = arr.map((p) => Number(p)).filter((p) => Number.isInteger(p) && p >= 1 && p <= 7)
    return positions.length ? Array.from(new Set(positions)).sort((a, b) => a - b) : []
  } catch {
    return [1, 2]
  }
}

/** True when the user has a finalized top-N rank in any settled cycle of the realm. */
async function realmQualified(userId: string, realmLevel: number, positions: number[]): Promise<boolean> {
  if (positions.length === 0) return false
  const claims = await db.realmRewardClaim.findMany({
    where: { userId, rank: { in: positions } },
    select: { cycleId: true },
  })
  if (claims.length === 0) return false
  const cycles = await db.realmCycle.findMany({
    where: { id: { in: claims.map((c) => c.cycleId) }, realmLevel, status: 'COMPLETED' },
    select: { id: true },
  })
  return cycles.length > 0
}

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
      select: { coinBalance: true, isPremium: true, premiumUntil: true, premiumTier: true },
    }),
  ])
  const ownedIds = new Set(owned.map((o) => o.bundleId))

  // §35 + admin-console §13 — the client can show exactly WHY a set is locked
  // and whether I can claim it right now, all server-computed.
  const premiumActive =
    !!meRow?.isPremium && (!meRow?.premiumUntil || meRow.premiumUntil > new Date())

  return NextResponse.json({
    bundles: await Promise.all(
      bundles.map(async (b) => {
        const unlockType = UNLOCK_TYPES.includes(b.unlockType) ? b.unlockType : 'coins'
        const winnerPositions = parseWinnerPositions(b.winnerPositions)
        let canClaimNow = false
        if (!ownedIds.has(b.id)) {
          if (unlockType === 'free') canClaimNow = true
          else if (unlockType === 'realm')
            canClaimNow = !!b.realmLevel && (await realmQualified(me.id, b.realmLevel, winnerPositions))
          else if (unlockType === 'league') canClaimNow = false // legacy type — no points rule anymore
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
          realmLevel: b.realmLevel ?? null,
          winnerPositions,
          priceCoins: b.priceCoins,
          purchaseEnabled: b.purchaseEnabled,
          rewardEnabled: b.rewardEnabled,
          owned: ownedIds.has(b.id),
          canClaimNow,
          stickers: b.stickers.map((s) => ({ id: s.id, name: s.name, assetUrl: s.assetUrl })),
        }
      })
    ),
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
    // P2028 fix: Prisma's default interactive-transaction timeout is 5s —
    // slow dev machines (cold Turbopack compiles + remote DB round-trips)
    // blew straight past it, closing the transaction mid-flight. 15s matches
    // the gifts route, and maxWait lets the tx wait for a free connection.
    // The balance check + decrement are ONE atomic conditional updateMany —
    // no read-then-write race, one round-trip less inside the transaction.
    const spent = await db
      .$transaction(
        async (tx) => {
          const res = await tx.user.updateMany({
            where: { id: me.id, coinBalance: { gte: bundle.priceCoins } },
            data: { coinBalance: { decrement: bundle.priceCoins } },
          })
          if (res.count === 0) throw new Error('insufficient_coins')
          await tx.coinLedger.create({
            data: { userId: me.id, delta: -bundle.priceCoins, reason: 'sticker_bundle_purchase' },
          })
          await tx.userGameStickerBundle.create({
            data: { userId: me.id, bundleId, source: 'purchase' },
          })
        },
        { timeout: 15_000, maxWait: 5_000 }
      )
      .catch((e: any) => {
        if (e?.message === 'insufficient_coins') return null
        throw e
      })
    if (spent === null) {
      return NextResponse.json({ error: 'insufficient_coins' }, { status: 402 })
    }
    // Balance is read AFTER the commit — one less query on the connection.
    const coinBalance =
      (await db.user.findUnique({ where: { id: me.id }, select: { coinBalance: true } }))?.coinBalance ?? 0
    return NextResponse.json({ ok: true, coinBalance })
  }

  // ── claim — server-evaluated unlocks (Games PRD §32) ───────────────────────
  const unlockType = UNLOCK_TYPES.includes(bundle.unlockType) ? bundle.unlockType : 'coins'

  if (unlockType === 'coins') {
    return NextResponse.json({ error: 'claim_not_available', reason: 'coins_unlock' }, { status: 400 })
  }

  // Admin-console PRD §13 — realm qualification via the FINALIZED result +
  // configured winner positions (min-league-points rule removed, §13.2).
  if (unlockType === 'realm') {
    if (!bundle.realmLevel) return NextResponse.json({ error: 'claim_not_available' }, { status: 400 })
    const positions = parseWinnerPositions(bundle.winnerPositions)
    const qualified = await realmQualified(me.id, bundle.realmLevel, positions)
    if (!qualified) {
      return NextResponse.json(
        { error: 'realm_not_qualified', realmLevel: bundle.realmLevel, winnerPositions: positions },
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
