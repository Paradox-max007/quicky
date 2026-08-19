// Quicky — send/open Quicky (disappearing media)
// POST /api/quicky/matches/[matchId]/quicky  { mediaUrl, duration, text? }
//   -> creates a quicky message + awards score points
// GET  /api/quicky/matches/[matchId]/quicky  -> lists un-opened quickies in this match (for recipient)
// PATCH /api/quicky/matches/[matchId]/quicky  { messageId, action: 'open' | 'replay' | 'screenshot' }
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { QUICKY } from '@/lib/quicky/constants'
import { awardQuickyScore } from '@/lib/quicky/score'
import { getRemainingLimits } from '@/lib/quicky/discovery'

// POST: send a Quicky
export async function POST(req: NextRequest, ctx: { params: Promise<{ matchId: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { matchId } = await ctx.params

  const match = await db.match.findUnique({ where: { id: matchId } })
  if (!match || (match.userAId !== me.id && match.userBId !== me.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (match.status !== 'active') return NextResponse.json({ error: 'Unmatched' }, { status: 410 })

  const body = await req.json()
  const mediaUrl = String(body.mediaUrl ?? '')
  const duration = Number(body.duration ?? QUICKY.quickyDefaultDuration)
  const text = body.text ? String(body.text).slice(0, 100) : null

  if (!mediaUrl) return NextResponse.json({ error: 'Media required' }, { status: 400 })
  if (!QUICKY.quickyDurations.includes(duration as 3 | 5 | 8 | 10)) {
    return NextResponse.json({ error: 'Invalid duration' }, { status: 400 })
  }

  // Check daily Quicky limit (free users)
  const limits = await getRemainingLimits({ userId: me.id, matchId })
  if (!limits.isPremium && limits.quicky <= 0) {
    return NextResponse.json({ error: 'quicky_limit', paywall: 'quicky' }, { status: 402 })
  }

  // Recipient = the other user
  const recipientId = match.userAId === me.id ? match.userBId : match.userAId

  // Expiry = 24h (server keeps the URL record but client can't open after that)
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000)

  const msg = await db.message.create({
    data: {
      matchId,
      senderId: me.id,
      type: 'quicky',
      mediaUrl,
      text,
      quickyDuration: duration,
      quickyExpiresAt: expiresAt,
    },
  })

  // Award score: sender gets +1 for sending
  await awardQuickyScore({
    senderId: me.id,
    recipientId,
    eventType: 'sent',
    messageId: msg.id,
  })

  await db.match.update({ where: { id: matchId }, data: { lastMessageAt: new Date() } })

  // Compute streak post-send
  const freshLimits = await getRemainingLimits({ userId: me.id, matchId })
  return NextResponse.json({
    ok: true,
    message: {
      id: msg.id,
      senderId: msg.senderId,
      type: 'quicky',
      mediaUrl: msg.mediaUrl,
      text: msg.text,
      quickyDuration: msg.quickyDuration,
      quickyExpiresAt: msg.quickyExpiresAt,
      createdAt: msg.createdAt,
    },
    limits: {
      quicky: freshLimits.quicky === Infinity ? 'unlimited' : freshLimits.quicky,
      isPremium: freshLimits.isPremium,
    },
  })
}

// GET: list un-opened Quickies in this match (for the recipient)
export async function GET(req: NextRequest, ctx: { params: Promise<{ matchId: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { matchId } = await ctx.params

  const match = await db.match.findUnique({ where: { id: matchId } })
  if (!match || (match.userAId !== me.id && match.userBId !== me.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // All quicky messages where I am NOT the sender and not yet opened
  const quickies = await db.message.findMany({
    where: {
      matchId,
      type: 'quicky',
      senderId: { not: me.id },
      quickyOpenedAt: null,
      quickyExpiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json({
    quickies: quickies.map((q) => ({
      id: q.id,
      senderId: q.senderId,
      mediaUrl: q.mediaUrl,
      text: q.text,
      quickyDuration: q.quickyDuration,
      quickyExpiresAt: q.quickyExpiresAt,
      createdAt: q.createdAt,
    })),
  })
}

// PATCH: open / replay / screenshot a Quicky
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ matchId: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { matchId } = await ctx.params

  const body = await req.json()
  const messageId = String(body.messageId ?? '')
  const action = String(body.action ?? '') as 'open' | 'replay' | 'screenshot'

  const match = await db.match.findUnique({ where: { id: matchId } })
  if (!match || (match.userAId !== me.id && match.userBId !== me.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const msg = await db.message.findUnique({ where: { id: messageId } })
  if (!msg || msg.matchId !== matchId || msg.type !== 'quicky') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Only recipient can open/replay/screenshot
  if (msg.senderId === me.id) {
    return NextResponse.json({ error: 'Cannot open own quicky' }, { status: 400 })
  }

  const senderId = msg.senderId

  if (action === 'open') {
    if (msg.quickyOpenedAt) {
      // Already opened; this is a replay — record as QuickyEvent
      await awardQuickyScore({ senderId: me.id, recipientId: senderId, eventType: 'replay', messageId: msg.id })
      return NextResponse.json({ ok: true, replay: true, mediaUrl: msg.mediaUrl, duration: msg.quickyDuration })
    }
    const opened = await db.message.update({
      where: { id: messageId },
      data: { quickyOpenedAt: new Date() },
    })
    // Award recipient +1 for opening
    await awardQuickyScore({ senderId: senderId, recipientId: me.id, eventType: 'opened', messageId: msg.id })

    // Check if both users sent a quicky in last 24h (mutual exchange bonus)
    const since = new Date(Date.now() - 86400000)
    const bothSent = await db.message.findMany({
      where: {
        matchId,
        type: 'quicky',
        createdAt: { gte: since },
        senderId: { in: [me.id, senderId] },
      },
      select: { senderId: true },
      distinct: 'senderId',
    })
    if (bothSent.length === 2) {
      // Award +2 to both
      await db.user.updateMany({
        where: { id: { in: [me.id, senderId] } },
        data: { quickyScore: { increment: QUICKY.score.mutualExchange24h } },
      })
      await db.quickyEvent.create({
        data: {
          senderId: me.id,
          recipientId: senderId,
          eventType: 'replay',
          pointsAwarded: QUICKY.score.mutualExchange24h,
          messageId: msg.id,
        },
      })
    }

    return NextResponse.json({
      ok: true,
      opened: true,
      mediaUrl: opened.mediaUrl,
      duration: opened.quickyDuration,
    })
  }

  if (action === 'screenshot') {
    // Flag the message
    await db.message.update({
      where: { id: messageId },
      data: { screenshotFlagged: true },
    })
    await awardQuickyScore({ senderId: senderId, recipientId: me.id, eventType: 'screenshot', messageId: msg.id })
    return NextResponse.json({ ok: true, flagged: true })
  }

  if (action === 'replay') {
    // Award nothing; just allow replay if free replays remain
    await awardQuickyScore({ senderId: me.id, recipientId: senderId, eventType: 'replay', messageId: msg.id })
    return NextResponse.json({ ok: true, replay: true, mediaUrl: msg.mediaUrl, duration: msg.quickyDuration })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
