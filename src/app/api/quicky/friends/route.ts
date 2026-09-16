// Quicky — FRIENDS (refactor PRD §25/§26/§27/§80)
// GET    /api/quicky/friends            -> my friends (with photo + presence info)
// POST   /api/quicky/friends            { userId } -> create friendship
// DELETE /api/quicky/friends?userId=...  -> remove friendship (either direction)
//
// Server validates (§25): authenticated user, target exists, not self,
// not blocked (either direction), not already friends. Historical data is
// never touched — removing a friend only deletes the friendship row (§40).
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

const userSelect = {
  id: true,
  name: true,
  age: true,
  city: true,
  isPremium: true,
  isVerified: true,
  lastActiveAt: true,
  photos: { orderBy: { position: 'asc' as const }, take: 1 },
} as const

function shape(u: {
  id: string
  name: string | null
  age: number | null
  city: string | null
  isPremium: boolean
  isVerified: boolean
  lastActiveAt?: Date | null
  photos: { url: string }[]
}) {
  return {
    id: u.id,
    name: u.name,
    age: u.age,
    city: u.city,
    isPremium: u.isPremium,
    isVerified: u.isVerified,
    lastActiveAt: u.lastActiveAt ?? null,
    photo: u.photos[0]?.url ?? null,
  }
}

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rows = await db.friendship.findMany({
    where: { OR: [{ requesterId: me.id }, { addresseeId: me.id }] },
    include: {
      requester: { select: userSelect },
      addressee: { select: userSelect },
    },
    orderBy: { createdAt: 'desc' },
  })

  const friends = rows.map((r) => shape(r.requesterId === me.id ? r.addressee : r.requester))
  return NextResponse.json({ friends })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const userId = String(body.userId ?? '')
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
  if (userId === me.id) return NextResponse.json({ error: 'Cannot add yourself' }, { status: 400 })

  const target = await db.user.findUnique({ where: { id: userId }, select: { id: true } })
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Blocked either way? No friendship (§55: block prevents friend relationship).
  const block = await db.block.findFirst({
    where: {
      OR: [
        { blockerId: me.id, blockedId: userId },
        { blockerId: userId, blockedId: me.id },
      ],
    },
  })
  if (block) return NextResponse.json({ error: 'Not available' }, { status: 403 })

  // Already friends (either direction)?
  const existing = await db.friendship.findFirst({
    where: {
      OR: [
        { requesterId: me.id, addresseeId: userId },
        { requesterId: userId, addresseeId: me.id },
      ],
    },
  })
  if (existing) return NextResponse.json({ error: 'already_friends' }, { status: 409 })

  const friendship = await db.friendship.create({
    data: { requesterId: me.id, addresseeId: userId },
  })
  return NextResponse.json({ ok: true, friendshipId: friendship.id }, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = req.nextUrl.searchParams.get('userId') ?? ''
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

  await db.friendship.deleteMany({
    where: {
      OR: [
        { requesterId: me.id, addresseeId: userId },
        { requesterId: userId, addresseeId: me.id },
      ],
    },
  })
  return NextResponse.json({ ok: true })
}
