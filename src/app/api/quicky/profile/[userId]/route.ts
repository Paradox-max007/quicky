// Quicky — public profile view
// GET /api/quicky/profile/[userId]
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ userId: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { userId } = await ctx.params

  const u = await db.user.findUnique({
    where: { id: userId },
    include: { photos: { orderBy: { position: 'asc' } } },
  })
  if (!u) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    profile: {
      id: u.id,
      name: u.name,
      age: u.age,
      gender: u.gender,
      lookingFor: u.lookingFor,
      bio: u.bio,
      city: u.city,
      interests: u.interests ? JSON.parse(u.interests) : [],
      prompts: u.prompts ? JSON.parse(u.prompts) : [],
      photos: u.photos.map((p) => ({ id: p.id, url: p.url, isPrimary: p.isPrimary })),
      isPremium: u.isPremium,
      isVerified: u.isVerified,
      quickyScore: u.quickyScore,
    },
    isMe: me.id === u.id,
  })
}
