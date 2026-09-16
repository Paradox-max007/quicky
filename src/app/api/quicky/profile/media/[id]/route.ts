// Quicky — PROFILE MEDIA (refactor PRD §9/§10/§80)
// PATCH /api/quicky/profile/media/:id   { displayHeight }
//
// Persists the canonical display height of a profile photo (§9: "Do not
// store the visual height only in React/Zustand/local state"). The owner can
// only patch their own photos. All surfaces that render the owner's carousel
// read this value after cache invalidation (§10/§82).
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))

  const data: { displayHeight?: number | null } = {}
  if ('displayHeight' in body) {
    if (body.displayHeight === null) data.displayHeight = null
    else {
      const h = Number(body.displayHeight)
      if (!Number.isFinite(h) || h < 160 || h > 800)
        return NextResponse.json({ error: 'displayHeight must be 160-800' }, { status: 400 })
      data.displayHeight = Math.round(h)
    }
  } else {
    return NextResponse.json({ error: 'displayHeight required' }, { status: 400 })
  }

  // Ownership enforced: the photo must belong to the caller.
  const existing = await db.photo.findUnique({ where: { id }, select: { userId: true } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.userId !== me.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const photo = await db.photo.update({ where: { id }, data })
  return NextResponse.json({
    ok: true,
    photo: { id: photo.id, displayHeight: photo.displayHeight },
  })
}
