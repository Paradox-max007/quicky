// Quicky — current user
// GET   /api/quicky/auth/me                          -> fetch current user profile
// PATCH /api/quicky/auth/me  { name?, dateOfBirth?, gender?, lookingFor?, bio?, city?, interests?, prompts? }
//   -> partial update (does NOT touch onboardedAt; use /api/quicky/onboarding for that)
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, computeAge } from '@/lib/quicky/auth'
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
      dateOfBirth: full.dateOfBirth,
      gender: full.gender,
      lookingFor: full.lookingFor,
      bio: full.bio,
      city: full.city,
      interests: full.interests ? JSON.parse(full.interests) : [],
      prompts: full.prompts ? JSON.parse(full.prompts) : [],
      photos: full.photos.map((p) => ({ id: p.id, url: p.url, isPrimary: p.isPrimary, isPrivate: p.isPrivate, position: p.position })),
      isPremium: full.isPremium,
      isVerified: full.isVerified,
      quickyScore: full.quickyScore,
      onboardedAt: full.onboardedAt,
    },
  })
}

export async function PATCH(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()

    // Build update payload from provided fields only (partial update)
    const data: any = { lastActiveAt: new Date() }

    if (body.name !== undefined) {
      const name = String(body.name).trim()
      if (!name) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
      data.name = name
    }

    if (body.dateOfBirth !== undefined) {
      const dob = body.dateOfBirth ? new Date(body.dateOfBirth) : null
      if (dob) {
        const age = computeAge(dob)
        if (age < 18) return NextResponse.json({ error: 'Must be 18+' }, { status: 400 })
        data.dateOfBirth = dob
        data.age = age
      }
    }

    if (body.gender !== undefined) {
      const g = String(body.gender)
      if (!['male', 'female', 'nonbinary', 'other'].includes(g)) {
        return NextResponse.json({ error: 'Invalid gender' }, { status: 400 })
      }
      data.gender = g
    }

    if (body.lookingFor !== undefined) {
      const lf = String(body.lookingFor)
      if (!['men', 'women', 'everyone'].includes(lf)) {
        return NextResponse.json({ error: 'Invalid lookingFor' }, { status: 400 })
      }
      data.lookingFor = lf
    }

    if (body.bio !== undefined) {
      const bio = String(body.bio).slice(0, 300)
      data.bio = bio || null
    }

    if (body.city !== undefined) {
      const city = String(body.city).slice(0, 100)
      data.city = city || null
    }

    if (body.interests !== undefined) {
      if (!Array.isArray(body.interests)) {
        return NextResponse.json({ error: 'interests must be an array' }, { status: 400 })
      }
      const interests = body.interests.slice(0, 8)
      data.interests = JSON.stringify(interests)
    }

    if (body.prompts !== undefined) {
      if (!Array.isArray(body.prompts)) {
        return NextResponse.json({ error: 'prompts must be an array' }, { status: 400 })
      }
      const prompts = body.prompts.slice(0, 3).map((p: any) => ({
        prompt: String(p.prompt ?? '').slice(0, 200),
        answer: String(p.answer ?? '').slice(0, 500),
      })).filter((p: any) => p.prompt && p.answer)
      data.prompts = JSON.stringify(prompts)
    }

    const updated = await db.user.update({
      where: { id: me.id },
      data,
    })

    return NextResponse.json({
      ok: true,
      user: {
        id: updated.id,
        name: updated.name,
        age: updated.age,
        dateOfBirth: updated.dateOfBirth,
        gender: updated.gender,
        lookingFor: updated.lookingFor,
        bio: updated.bio,
        city: updated.city,
        interests: updated.interests ? JSON.parse(updated.interests) : [],
        prompts: updated.prompts ? JSON.parse(updated.prompts) : [],
      },
    })
  } catch (e: any) {
    console.error('Edit profile error', e)
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
  }
}
