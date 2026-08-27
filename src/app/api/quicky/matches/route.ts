// Quicky — list matches for current user
// GET /api/quicky/matches
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const matches = await db.match.findMany({
    where: {
      OR: [{ userAId: me.id }, { userBId: me.id }],
      status: 'active',
    },
    include: {
      userA: { include: { photos: { orderBy: { position: 'asc' } }, settings: true } },
      userB: { include: { photos: { orderBy: { position: 'asc' } }, settings: true } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
    orderBy: { lastMessageAt: 'desc' },
  })

  if (matches.length === 0) return NextResponse.json({ matches: [] })

  const matchIds = matches.map((m) => m.id)

  // ── Batch query 1: all quicky messages for all matches (for streak calc) ──
  const allQuickies = await db.message.findMany({
    where: { matchId: { in: matchIds }, type: 'quicky' },
    select: { matchId: true, senderId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })

  // ── Batch query 2: unread counts per match ────────────────────────────────
  const unreadGroups = await db.message.groupBy({
    by: ['matchId'],
    where: { matchId: { in: matchIds }, senderId: { not: me.id }, readAt: null },
    _count: { id: true },
  })
  const unreadByMatch = new Map(unreadGroups.map((g) => [g.matchId, g._count.id]))

  // Group quickies by matchId for streak calc
  const quickiesByMatch = new Map<string, { senderId: string; createdAt: Date }[]>()
  for (const q of allQuickies) {
    if (!quickiesByMatch.has(q.matchId)) quickiesByMatch.set(q.matchId, [])
    quickiesByMatch.get(q.matchId)!.push(q)
  }

  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)

  const result = matches.map((m) => {
    const partner = m.userAId === me.id ? m.userB : m.userA
    const lastMsg = m.messages[0]

    // ── Streak calculation (pure JS, no extra queries) ──────────────────────
    const matchQuickies = quickiesByMatch.get(m.id) ?? []
    const dayMap = new Map<string, Set<string>>()
    for (const q of matchQuickies) {
      const day = q.createdAt.toISOString().slice(0, 10)
      if (!dayMap.has(day)) dayMap.set(day, new Set())
      dayMap.get(day)!.add(q.senderId)
    }
    const validDays = [...dayMap.entries()]
      .filter(([, s]) => s.has(m.userAId) && s.has(m.userBId))
      .map(([d]) => d)
      .sort()

    let streak = 0
    if (validDays.length > 0) {
      const last = validDays[validDays.length - 1]
      if (last === today || last === yesterday) {
        let cursor = new Date(last + 'T00:00:00Z')
        for (let i = validDays.length - 1; i >= 0; i--) {
          const d = new Date(validDays[i] + 'T00:00:00Z')
          if (Math.round((cursor.getTime() - d.getTime()) / 86400000) === 0) {
            streak++
            cursor = new Date(cursor.getTime() - 86400000)
          } else break
        }
      }
    }

    // ── Preview text ────────────────────────────────────────────────────────
    let preview = 'Say hi \u{1F44B}'
    if (lastMsg) {
      if (lastMsg.type === 'system') preview = lastMsg.text ?? 'Matched!'
      else if (lastMsg.type === 'quicky') preview = '\u{1F4F7} Quicky'
      else if (lastMsg.type === 'image') preview = '\u{1F4F7} Photo'
      else if (lastMsg.type === 'video') preview = '\u{1F3AC} Video'
      else preview = lastMsg.text ?? ''
    }

    const unread = !!(lastMsg && lastMsg.senderId !== me.id)
    const unreadCount = unreadByMatch.get(m.id) ?? 0

    return {
      id: m.id,
      partner: {
        id: partner.id,
        name: partner.name,
        age: partner.age,
        isPremium: partner.isPremium,
        isVerified: partner.isVerified,
        quickyScore: partner.quickyScore,
        photo: partner.photos[0]?.url ?? null,
        lastActiveAt: partner.lastActiveAt,
        hideOnline: !!partner.settings?.privacyHideOnline,
      },
      streak,
      preview,
      unread,
      unreadCount,
      lastMessageAt: m.lastMessageAt ?? m.createdAt,
    }
  })

  return NextResponse.json({ matches: result })
}
