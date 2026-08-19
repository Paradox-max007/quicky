// Quicky — manage user photos
// POST   /api/quicky/auth/me/photos      { url, position?, isPrimary? }
// DELETE /api/quicky/auth/me/photos/[id]
// PATCH  /api/quicky/auth/me/photos/[id] { position?, isPrimary? }
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const url = String(body.url ?? '')
  if (!url) return NextResponse.json({ error: 'URL required' }, { status: 400 })

  const count = await db.photo.count({ where: { userId: me.id } })
  if (count >= 6) return NextResponse.json({ error: 'Max 6 photos' }, { status: 400 })

  const position = body.position ?? count
  const photo = await db.photo.create({
    data: {
      userId: me.id,
      url,
      position,
      isPrimary: body.isPrimary ?? count === 0,
    },
  })

  if (photo.isPrimary) {
    await db.photo.updateMany({
      where: { userId: me.id, id: { not: photo.id } },
      data: { isPrimary: false },
    })
  }

  return NextResponse.json({ ok: true, photo })
}
