// Quicky — BLOCKS (refactor PRD §55/§80)
// POST   /api/quicky/blocks            { userId } -> block a user
// DELETE /api/quicky/blocks?userId=...  -> unblock
//
// Blocking is server-side (§55): after a block, new DMs are refused (the
// matching + dm routes already enforce this), friendship is dissolved, and
// the UI synchronizes via the relationship endpoint. Chat history follows
// the retention policy — a block never silently destroys history (§55).
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const userId = String(body.userId ?? '')
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
  if (userId === me.id) return NextResponse.json({ error: 'Cannot block yourself' }, { status: 400 })

  const target = await db.user.findUnique({ where: { id: userId }, select: { id: true } })
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await db.$transaction([
    // idempotent block
    db.block.upsert({
      where: { blockerId_blockedId: { blockerId: me.id, blockedId: userId } },
      update: {},
      create: { blockerId: me.id, blockedId: userId },
    }),
    // a block dissolves any friendship between the two users (§55)
    db.friendship.deleteMany({
      where: {
        OR: [
          { requesterId: me.id, addresseeId: userId },
          { requesterId: userId, addresseeId: me.id },
        ],
      },
    }),
  ])

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = req.nextUrl.searchParams.get('userId') ?? ''
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

  await db.block.deleteMany({ where: { blockerId: me.id, blockedId: userId } })
  return NextResponse.json({ ok: true })
}
