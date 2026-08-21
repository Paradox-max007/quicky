// Quicky — manage individual photo
// PATCH   /api/quicky/auth/me/photos/[photoId]  { position?, isPrimary?, isPrivate? }
// DELETE  /api/quicky/auth/me/photos/[photoId]
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import fs from 'fs'
import path from 'path'

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ photoId: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { photoId } = await ctx.params

  const photo = await db.photo.findUnique({ where: { id: photoId } })
  if (!photo || photo.userId !== me.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await req.json()
  const updated = await db.photo.update({
    where: { id: photoId },
    data: {
      position: body.position ?? photo.position,
      isPrimary: body.isPrimary ?? photo.isPrimary,
      isPrivate: body.isPrivate !== undefined ? Boolean(body.isPrivate) : photo.isPrivate,
    },
  })

  if (body.isPrimary) {
    await db.photo.updateMany({
      where: { userId: me.id, id: { not: photoId } },
      data: { isPrimary: false },
    })
  }

  return NextResponse.json({ ok: true, photo: updated })
}


export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ photoId: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { photoId } = await ctx.params

  const photo = await db.photo.findUnique({ where: { id: photoId } })
  if (!photo || photo.userId !== me.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Try to delete the file too
  if (photo.url?.startsWith('/uploads/')) {
    const fullPath = path.join(process.cwd(), 'public', photo.url)
    try { fs.unlinkSync(fullPath) } catch {}
  }

  await db.photo.delete({ where: { id: photoId } })

  // If this was primary, promote the next photo
  const remaining = await db.photo.findMany({
    where: { userId: me.id },
    orderBy: { position: 'asc' },
  })
  if (remaining.length > 0 && !remaining.some((p) => p.isPrimary)) {
    await db.photo.update({ where: { id: remaining[0].id }, data: { isPrimary: true } })
  }

  return NextResponse.json({ ok: true })
}
