// Quicky — list matches for current user
// GET /api/quicky/matches
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { QUICKY } from '@/lib/quicky/constants'

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const matches = await db.match.findMany({
    where: {
      OR: [{ userAId: me.id }, { userBId: me.id }],
      status: 'active',
    },
    include: {
      userA: { include: { photos: { orderBy: { position: 'asc' } } } },
      userB: { include: { photos: { orderBy: { position: 'asc' } } } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
    orderBy: { lastMessageAt: 'desc' },
  })

  const result = await Promise.all(
    matches.map(async (m) => {
      const partner = m.userAId === me.id ? m.userB : m.userA
      const lastMsg = m.messages[0]
      // Compute streak count for this match
      const allQuicky = await db.message.findMany({
        where: { matchId: m.id, type: 'quicky' },
        orderBy: { createdAt: 'asc' },
      })
      const dayMap = new Map<string, Set<string>>()
      for (const q of allQuicky) {
        const day = q.createdAt.toISOString().slice(0, 10)
        if (!dayMap.has(day)) dayMap.set(day, new Set())
        dayMap.get(day)!.add(q.senderId)
      }
      const validDays = [...dayMap.entries()].filter(([, s]) => s.has(m.userAId) && s.has(m.userBId)).map(([d]) => d)
      validDays.sort()
      let streak = 0
      if (validDays.length > 0) {
        const last = validDays[validDays.length - 1]
        const today = new Date().toISOString().slice(0, 10)
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
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

      // Preview text for the chat list
      let preview = 'Say hi \u{1F44B}'
      if (lastMsg) {
        if (lastMsg.type === 'system') preview = lastMsg.text ?? 'Matched!'
        else if (lastMsg.type === 'quicky') preview = '\u{1F4F7} Quicky'
        else if (lastMsg.type === 'image') preview = '\u{1F4F7} Photo'
        else if (lastMsg.type === 'video') preview = '\u{1F3AC} Video'
        else preview = lastMsg.text ?? ''
      }
      const unread = lastMsg && lastMsg.senderId !== me.id ? true : false

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
        },
        streak,
        preview,
        unread,
        lastMessageAt: m.lastMessageAt ?? m.createdAt,
      }
    })
  )

  return NextResponse.json({ matches: result })
}
