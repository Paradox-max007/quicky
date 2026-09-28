// Quicky — MONETIZATION FUNNEL TRACKING (Game Economy PRD §60-§62)
// POST /api/quicky/game-store/track  { type, metadata? }
// Client-side funnel signals (store_opened from surfaces without a payload
// fetch, boost_seen, insufficient_coins, crate_viewed…). Fire-and-forget,
// rate-safe (best-effort insert; never blocks or errors the UI flow).
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { trackMonetizationEvent } from '@/lib/quicky/game-store'

const ALLOWED = new Set([
  'store_opened',
  'coin_package_viewed',
  'checkout_started',
  'crate_viewed',
  'crate_details_opened',
  'boost_seen',
  'insufficient_coins',
  'cosmetics_viewed',
  'featured_viewed',
  'buy_coins_prompt',
  'buy_coins_prompt_dismissed',
])

export async function POST(req: NextRequest) {
  const me = await getCurrentUser().catch(() => null)
  const body = await req.json().catch(() => null)
  const type = String(body?.type ?? '')
  if (!type || !ALLOWED.has(type)) return NextResponse.json({ ok: false }, { status: 400 })

  const metadata = (body?.metadata ?? undefined) as Record<string, unknown> | undefined
  await trackMonetizationEvent(me?.id ?? null, type, metadata)
  return NextResponse.json({ ok: true })
}
