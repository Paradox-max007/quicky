// Quicky — list messages + send text/image message in a match
// GET  /api/quicky/matches/[matchId]/messages  -> list messages
// POST /api/quicky/matches/[matchId]/messages  { type, text?, mediaUrl? } -> send message
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

export async function GET(req: NextRequest, ctx: { params: Promise<{ matchId: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { matchId } = await ctx.params

  const match = await db.match.findUnique({
    where: { id: matchId },
    include: {
      userA: { include: { photos: { orderBy: { position: 'asc' } } } },
      userB: { include: { photos: { orderBy: { position: 'asc' } } } },
    },
  })
  if (!match || (match.userAId !== me.id && match.userBId !== me.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (match.status !== 'active') return NextResponse.json({ error: 'Unmatched' }, { status: 410 })

  const partner = match.userAId === me.id ? match.userB : match.userA
  const messages = await db.message.findMany({
    where: { matchId },
    orderBy: { createdAt: 'asc' },
    take: 200,
  })

  return NextResponse.json({
    match: {
      id: match.id,
      partner: {
        id: partner.id,
        name: partner.name,
        age: partner.age,
        isPremium: partner.isPremium,
        isVerified: partner.isVerified,
        quickyScore: partner.quickyScore,
        photo: partner.photos[0]?.url ?? null,
        bio: partner.bio,
        interests: partner.interests ? JSON.parse(partner.interests) : [],
        city: partner.city,
      },
    },
    me: { id: me.id, isPremium: me.isPremium },
    messages: messages.map((m) => ({
      id: m.id,
      senderId: m.senderId,
      type: m.type,
      text: m.text,
      mediaUrl: m.mediaUrl,
      quickyDuration: m.quickyDuration,
      quickyOpenedAt: m.quickyOpenedAt,
      quickyExpiresAt: m.quickyExpiresAt,
      screenshotFlagged: m.screenshotFlagged,
      createdAt: m.createdAt,
    })),
  })
}

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
  const type = String(body.type ?? 'text') as 'text' | 'image' | 'video' | 'system'
  if (!['text', 'image', 'video'].includes(type)) {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  }
  const text = body.text ? String(body.text).slice(0, 1000) : null
  const mediaUrl = body.mediaUrl ? String(body.mediaUrl) : null
  if (!text && !mediaUrl) {
    return NextResponse.json({ error: 'Empty message' }, { status: 400 })
  }

  const msg = await db.message.create({
    data: { matchId, senderId: me.id, type, text, mediaUrl },
  })
  await db.match.update({
    where: { id: matchId },
    data: { lastMessageAt: new Date() },
  })

  return NextResponse.json({
    ok: true,
    message: {
      id: msg.id,
      senderId: msg.senderId,
      type: msg.type,
      text: msg.text,
      mediaUrl: msg.mediaUrl,
      createdAt: msg.createdAt,
    },
  })
}
