// Quicky — current user
// GET /api/quicky/auth/me
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

export async function GET() {
  const u = await getCurrentUser()
  if (!u) return NextResponse.json({ user: null }, { status: 200 })

  // Fetch full profile (photos, interests, prompts)
  const full = await db.user.findUnique({
    where: { id: u.id },
    include: { photos: { orderBy: { position: 'asc' } } },
  })
  if (!full) return NextResponse.json({ user: null }, { status: 200 })

  return NextResponse.json({
    user: {
      id: full.id,
      phone: full.phone,
      name: full.name,
      age: full.age,
      gender: full.gender,
      lookingFor: full.lookingFor,
      bio: full.bio,
      city: full.city,
      interests: full.interests ? JSON.parse(full.interests) : [],
      prompts: full.prompts ? JSON.parse(full.prompts) : [],
      photos: full.photos.map((p) => ({ id: p.id, url: p.url, isPrimary: p.isPrimary })),
      isPremium: full.isPremium,
      isVerified: full.isVerified,
      quickyScore: full.quickyScore,
      onboardedAt: full.onboardedAt,
    },
  })
}
