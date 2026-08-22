// Quicky — Blocked Users management
// GET    /api/quicky/settings/blocked              -> list of users the current user has blocked
// DELETE /api/quicky/settings/blocked?blockId=...    -> unblock a user
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const blocks = await db.block.findMany({
    where: { blockerId: me.id },
    include: {
      blocked: { include: { photos: { orderBy: { position: 'asc' } } } },
    },
    orderBy: { createdAt: 'desc' },
  })

  const blocked = blocks.map((b) => {
    const u = b.blocked
    return {
      blockId: b.id,
      blockedAt: b.createdAt,
      user: {
        id: u.id,
        name: u.name,
        age: u.age,
        city: u.city,
        isPremium: u.isPremium,
        isVerified: u.isVerified,
        photo: u.photos[0]?.url ?? null,
      },
    }
  })

  return NextResponse.json({ blocked })
}

export async function DELETE(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const blockId = searchParams.get('blockId')
  if (!blockId) return NextResponse.json({ error: 'blockId required' }, { status: 400 })

  const block = await db.block.findUnique({ where: { id: blockId } })
  if (!block || block.blockerId !== me.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await db.block.delete({ where: { id: blockId } })
  return NextResponse.json({ ok: true })
}
