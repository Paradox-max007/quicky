// Quicky — record a swipe + check for match
// POST /api/quicky/swipe  { toUserId, type: 'like' | 'superlike' | 'pass' | 'rewind' }
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { QUICKY } from '@/lib/quicky/constants'
import { getRemainingLimits } from '@/lib/quicky/discovery'

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const toUserId = String(body.toUserId ?? '')
    let type = String(body.type ?? '') as 'like' | 'superlike' | 'pass' | 'rewind'

    if (!toUserId) return NextResponse.json({ error: 'Missing target user' }, { status: 400 })

    if (type === 'rewind') {
      // Undo last swipe (1 per day for free users)
      const lastSwipe = await db.swipe.findFirst({
        where: { fromUserId: me.id },
        orderBy: { createdAt: 'desc' },
      })
      if (!lastSwipe) return NextResponse.json({ error: 'Nothing to rewind' }, { status: 400 })
      await db.swipe.delete({ where: { id: lastSwipe.id } })
      return NextResponse.json({ ok: true, rewind: true, targetUserId: lastSwipe.toUserId })
    }

    if (!['like', 'superlike', 'pass'].includes(type)) {
      return NextResponse.json({ error: 'Invalid swipe type' }, { status: 400 })
    }

    // Check limits
    const limits = await getRemainingLimits({ userId: me.id })
    if (!limits.isPremium) {
      if (type === 'like' && limits.likes <= 0) {
        return NextResponse.json({ error: 'like_limit', paywall: 'likes' }, { status: 402 })
      }
      if (type === 'superlike' && limits.superLikes <= 0) {
        return NextResponse.json({ error: 'superlike_limit', paywall: 'superlikes' }, { status: 402 })
      }
    }

    // Upsert swipe (replace if exists)
    const existing = await db.swipe.findUnique({
      where: { fromUserId_toUserId: { fromUserId: me.id, toUserId } },
    })
    if (existing) {
      await db.swipe.update({
        where: { id: existing.id },
        data: { type, createdAt: new Date() },
      })
    } else {
      await db.swipe.create({ data: { fromUserId: me.id, toUserId, type } })
    }

    // Check for mutual match (only on like / superlike)
    let match: { id: string; partnerId: string } | null = null
    if (type === 'like' || type === 'superlike') {
      const reverse = await db.swipe.findUnique({
        where: { fromUserId_toUserId: { fromUserId: toUserId, toUserId: me.id } },
      })
      if (reverse && (reverse.type === 'like' || reverse.type === 'superlike')) {
        // Check if match already exists
        const existingMatch = await db.match.findFirst({
          where: {
            OR: [
              { userAId: me.id, userBId: toUserId },
              { userAId: toUserId, userBId: me.id },
            ],
          },
        })
        if (!existingMatch) {
          const m = await db.match.create({
            data: { userAId: me.id, userBId: toUserId, status: 'active' },
          })
          // System message: "You matched!"
          await db.message.create({
            data: {
              matchId: m.id,
              senderId: me.id,
              type: 'system',
              text: 'You matched! Send a Quicky to break the ice \u{1F525}',
            },
          })
          match = { id: m.id, partnerId: toUserId }
        } else if (existingMatch.status === 'unmatched') {
          // Re-match? No, skip.
        } else {
          match = { id: existingMatch.id, partnerId: toUserId }
        }
      }
    }

    const newLimits = await getRemainingLimits({ userId: me.id })

    return NextResponse.json({
      ok: true,
      type,
      match,
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
