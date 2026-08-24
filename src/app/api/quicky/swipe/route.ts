// Quicky — record swipes (single or batch) + check for matches
// POST /api/quicky/swipe
//   { toUserId, type }                  — single swipe (legacy)
//   { swipes: [{ toUserId, type }] }    — batch of swipes (client queues + flushes)
//   { type: 'rewind' }                  — undo last swipe
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { getRemainingLimits } from '@/lib/quicky/discovery'

type SwipeType = 'like' | 'superlike' | 'pass'

async function recordSwipe(
  meId: string,
  toUserId: string,
  type: SwipeType,
  budget: { likes: number; superLikes: number } // mutated: tracks remaining allowance within this request
): Promise<
  | { ok: true; type: SwipeType; match?: { id: string; partnerId: string } | null }
  | { ok: false; error: string; paywall?: 'likes' | 'superlikes' }
> {
  if (type === 'like' && budget.likes <= 0) return { ok: false, error: 'like_limit', paywall: 'likes' }
  if (type === 'superlike' && budget.superLikes <= 0)
    return { ok: false, error: 'superlike_limit', paywall: 'superlikes' }

  // Upsert swipe (replace if exists) — upsert keeps it one round-trip vs find+update/create
  await db.swipe.upsert({
    where: { fromUserId_toUserId: { fromUserId: meId, toUserId } },
    update: { type, createdAt: new Date() },
    create: { fromUserId: meId, toUserId, type },
  })

  if (type === 'like') budget.likes -= 1
  if (type === 'superlike') budget.superLikes -= 1

  // Check for mutual match (only on like / superlike)
  let match: { id: string; partnerId: string } | null = null
  if (type === 'like' || type === 'superlike') {
    const reverse = await db.swipe.findUnique({
      where: { fromUserId_toUserId: { fromUserId: toUserId, toUserId: meId } },
    })
    if (reverse && (reverse.type === 'like' || reverse.type === 'superlike')) {
      const existingMatch = await db.match.findFirst({
        where: {
          OR: [
            { userAId: meId, userBId: toUserId },
            { userAId: toUserId, userBId: meId },
          ],
        },
      })
      if (!existingMatch) {
        const m = await db.match.create({
          data: { userAId: meId, userBId: toUserId, status: 'active' },
        })
        await db.message.create({
          data: {
            matchId: m.id,
            senderId: meId,
            type: 'system',
            text: 'You matched! Send a Quicky to break the ice \u{1F525}',
          },
        })
        match = { id: m.id, partnerId: toUserId }
      } else if (existingMatch.status === 'active') {
        match = { id: existingMatch.id, partnerId: toUserId }
      }
    }
  }

  return { ok: true, type, match }
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()

    // Undo last swipe (1 per day for free users)
    if (body.type === 'rewind') {
      const lastSwipe = await db.swipe.findFirst({
        where: { fromUserId: me.id },
        orderBy: { createdAt: 'desc' },
      })
      if (!lastSwipe) return NextResponse.json({ error: 'Nothing to rewind' }, { status: 400 })
      await db.swipe.delete({ where: { id: lastSwipe.id } })
      return NextResponse.json({ ok: true, rewind: true, targetUserId: lastSwipe.toUserId })
    }

    // Normalize single + batch payloads into one list
    const items: { toUserId: string; type: string }[] = Array.isArray(body.swipes)
      ? body.swipes
      : [{ toUserId: body.toUserId, type: body.type }]

    const valid = items.filter(
      (it) =>
        it &&
        typeof it.toUserId === 'string' &&
        it.toUserId &&
        ['like', 'superlike', 'pass'].includes(String(it.type))
    )
    if (valid.length === 0) {
      return NextResponse.json({ error: 'Missing or invalid swipe payload' }, { status: 400 })
    }

    // One limit lookup per request; the in-request budget is decremented
    // as we go so a batch can't blow past the daily allowance.
    const limits = await getRemainingLimits({ userId: me.id })
    const budget = {
      likes: limits.isPremium ? Infinity : limits.likes,
      superLikes: limits.isPremium ? Infinity : limits.superLikes,
    }

    const results: {
      toUserId: string
      ok: boolean
      match?: { id: string; partnerId: string } | null
      error?: string
      paywall?: 'likes' | 'superlikes'
    }[] = []
    for (const it of valid) {
      const result = await recordSwipe(me.id, it.toUserId, it.type as SwipeType, budget)
      results.push({ toUserId: it.toUserId, ...result })
    }

    // Single swipe stays 402-on-limit for backward compatibility
    if (results.length === 1 && !results[0].ok) {
      return NextResponse.json({ error: results[0].error, paywall: results[0].paywall }, { status: 402 })
    }

    const newLimits = await getRemainingLimits({ userId: me.id })

    return NextResponse.json({
      ok: true,
      results,
      limits: {
        likes: newLimits.likes === Infinity ? 'unlimited' : newLimits.likes,
        superLikes: newLimits.superLikes,
        quicky: newLimits.quicky === Infinity ? 'unlimited' : newLimits.quicky,
        isPremium: newLimits.isPremium,
      },
    })
  } catch (e: any) {
    console.error('Swipe error', e)
    return NextResponse.json({ error: 'Failed to record swipe' }, { status: 500 })
  }
}
