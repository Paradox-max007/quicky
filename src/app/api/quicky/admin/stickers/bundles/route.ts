// Quicky — ADMIN sticker BUNDLE management (game-chat PRD §63/§69/§70/§116/§117/§127)
// Gated by requireAdmin() — a fresh DB isAdmin check on EVERY request (§127).
//
// GET    → ALL bundles (including inactive) + their stickers + the league/
//          season catalogs for the edit form (never hardcoded, §65).
// POST   → create { name, description?, icon?, leagueId?, seasonId?,
//          priceCoins?, minimumLeaguePoints?, purchaseEnabled?, rewardEnabled?,
//          isActive?, sortOrder? }
// PATCH  → { id, data { …same fields… } }
// DELETE → { id }  (bundle + stickers cascade; ownership rows cascade too)
// Every mutation writes an AdminAuditLog row (§120).
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, logAdminAction } from '@/lib/quicky/admin'

const clean = (v: unknown, max: number): string | undefined => {
  if (v === undefined) return undefined
  const s = String(v).trim()
  return s ? s.slice(0, max) : undefined
}
const cleanInt = (v: unknown): number | undefined => {
  if (v === undefined) return undefined
  const n = Math.floor(Number(v))
  return Number.isFinite(n) && n >= 0 ? n : undefined
}
const cleanBool = (v: unknown): boolean | undefined => (v === undefined ? undefined : !!v)
const cleanRef = (v: unknown): string | null | undefined => {
  if (v === undefined) return undefined
  const s = String(v ?? '').trim()
  return s ? s : null
}
// Games PRD §32 — valid acquisition mechanisms
const UNLOCK_TYPES = ['free', 'coins', 'league', 'season', 'event', 'subscription']
const cleanUnlockType = (v: unknown): string | undefined => {
  const s = String(v ?? '').trim()
  return UNLOCK_TYPES.includes(s) ? s : undefined
}

export async function GET() {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const [bundles, leagues, seasons, events] = await Promise.all([
    db.gameStickerBundle.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        stickers: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
        league: { select: { name: true } },
        season: { select: { name: true } },
        event: { select: { name: true } },
        _count: { select: { stickers: true, owners: true } },
      },
    }),
    db.gameLeague.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }] }),
    db.gameSeason.findMany({ where: { isActive: true }, orderBy: [{ createdAt: 'asc' }] }),
    db.gameEvent.findMany({ where: { isActive: true }, orderBy: [{ createdAt: 'asc' }] }),
  ])

  return NextResponse.json({ bundles, leagues, seasons, events })
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const body = await req.json().catch(() => null)
  const name = clean(body?.name, 60)
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })

  // §117: at least one acquisition route should be configured — unless the
  // bundle uses a non-purchasable/non-league unlock (event, season,
  // subscription, free), which carries its own requirement field.
  const priceCoins = cleanInt(body?.priceCoins) ?? 0
  const minimumLeaguePoints = cleanInt(body?.minimumLeaguePoints) ?? 0
  const purchaseEnabled = cleanBool(body?.purchaseEnabled) ?? priceCoins > 0
  const rewardEnabled = cleanBool(body?.rewardEnabled) ?? minimumLeaguePoints > 0
  const unlockType = cleanUnlockType(body?.unlockType) ?? 'coins'
  const selfSufficient = ['event', 'season', 'subscription', 'free'].includes(unlockType)
  if (!purchaseEnabled && !rewardEnabled && !selfSufficient) {
    return NextResponse.json({ error: 'acquisition_route_required' }, { status: 400 })
  }
  // §32: an event/season unlock must point at its requirement.
  if (unlockType === 'event' && !cleanRef(body?.eventId)) {
    return NextResponse.json({ error: 'event_required' }, { status: 400 })
  }

  const created = await db.gameStickerBundle.create({
    data: {
      name,
      description: clean(body?.description, 200) ?? null,
      icon: clean(body?.icon, 8) ?? '✨',
      unlockType: cleanUnlockType(body?.unlockType) ?? 'coins',
      leagueId: cleanRef(body?.leagueId) ?? null,
      seasonId: cleanRef(body?.seasonId) ?? null,
      eventId: cleanRef(body?.eventId) ?? null,
      priceCoins,
      minimumLeaguePoints,
      purchaseEnabled,
      rewardEnabled,
      isActive: cleanBool(body?.isActive) ?? true,
      sortOrder: cleanInt(body?.sortOrder) ?? 0,
    },
  })
  await logAdminAction(gate.me.id, 'create', 'sticker_bundle', created.id, { name })
  return NextResponse.json({ ok: true, bundle: created })
}

export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const body = await req.json().catch(() => null)
  const id = String(body?.id ?? '')
  const data = body?.data ?? {}
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  const name = clean(data?.name, 60)
  if (name !== undefined) {
    if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })
    patch.name = name
  }
  if (data?.description !== undefined) patch.description = clean(data.description, 200) ?? null
  if (data?.icon !== undefined) {
    const icon = clean(data.icon, 8)
    if (icon) patch.icon = icon
  }
  if (data?.leagueId !== undefined) patch.leagueId = cleanRef(data.leagueId)
  if (data?.seasonId !== undefined) patch.seasonId = cleanRef(data.seasonId)
  const unlockType = cleanUnlockType(data?.unlockType)
  if (unlockType !== undefined) patch.unlockType = unlockType
  if (data?.eventId !== undefined) patch.eventId = cleanRef(data.eventId)
  const priceCoins = cleanInt(data?.priceCoins)
  if (priceCoins !== undefined) patch.priceCoins = priceCoins
  const minimumLeaguePoints = cleanInt(data?.minimumLeaguePoints)
  if (minimumLeaguePoints !== undefined) patch.minimumLeaguePoints = minimumLeaguePoints
  const purchaseEnabled = cleanBool(data?.purchaseEnabled)
  if (purchaseEnabled !== undefined) patch.purchaseEnabled = purchaseEnabled
  const rewardEnabled = cleanBool(data?.rewardEnabled)
  if (rewardEnabled !== undefined) patch.rewardEnabled = rewardEnabled
  const isActive = cleanBool(data?.isActive)
  if (isActive !== undefined) patch.isActive = isActive
  const sortOrder = cleanInt(data?.sortOrder)
  if (sortOrder !== undefined) patch.sortOrder = sortOrder
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 })

  const updated = await db.gameStickerBundle.update({ where: { id }, data: patch }).catch(() => null)
  if (!updated) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  await logAdminAction(gate.me.id, 'update', 'sticker_bundle', id, patch)
  return NextResponse.json({ ok: true, bundle: updated })
}

export async function DELETE(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const body = await req.json().catch(() => null)
  const id = String(body?.id ?? '')
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })
  const gone = await db.gameStickerBundle.delete({ where: { id } }).catch(() => null)
  if (!gone) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  await logAdminAction(gate.me.id, 'delete', 'sticker_bundle', id, { name: gone.name })
  return NextResponse.json({ ok: true })
}
