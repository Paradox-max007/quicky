// Quicky — GAME STORE payload (Game Economy PRD §6/§50)
// GET /api/quicky/game-store?platform=web|android|ios
// One call powers the whole store: coin packages, real-money crates,
// coin-bought cosmetics, owned (unopened) crates, the viewer's final-hours
// boost and the coin balance. The dating Premium system is never touched.
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { getGameStorePayload, ensureGameStoreBootstrap, trackMonetizationEvent } from '@/lib/quicky/game-store'

export const dynamic = 'force-dynamic'

function parsePlatform(v: string | null): 'web' | 'android' | 'ios' {
  return v === 'android' || v === 'ios' ? v : 'web'
}

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  await ensureGameStoreBootstrap()
  try {
    const platform = parsePlatform(req.nextUrl.searchParams.get('platform'))
    const payload = await getGameStorePayload(me.id, platform)
    void trackMonetizationEvent(me.id, 'store_opened', { platform, tab: req.nextUrl.searchParams.get('tab') ?? undefined })
    return NextResponse.json(payload)
  } catch {
    // Tables missing / DB hiccup — the store opens empty instead of erroring.
    return NextResponse.json(
      {
        ok: true,
        coinBalance: 0,
        isPremium: false,
        platform: parsePlatform(req.nextUrl.searchParams.get('platform')),
        coinPackages: [],
        crates: [],
        cosmetics: [],
        pendingCrates: [],
        boost: { active: false, multiplier: 1, hoursBeforeEnd: 4, endsAt: null, startsAt: null, realmLevel: null },
        sandbox: true,
      },
      { status: 200 }
    )
  }
}
