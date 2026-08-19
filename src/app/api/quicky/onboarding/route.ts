// Quicky — complete onboarding (PATCH)
// Body: { name, dateOfBirth, gender, lookingFor, bio, city, interests, prompts }
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, computeAge } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

export async function PATCH(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const name = String(body.name ?? '').trim()
    const dateOfBirth = body.dateOfBirth ? new Date(body.dateOfBirth) : null
    const age = dateOfBirth ? computeAge(dateOfBirth) : null
    if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 })
    if (age !== null && age < 18) return NextResponse.json({ error: 'Must be 18+' }, { status: 400 })

    const gender = body.gender ?? null
    const lookingFor = body.lookingFor ?? null
    const bio = body.bio ?? null
    const city = body.city ?? null
    const interests = Array.isArray(body.interests) ? body.interests.slice(0, 8) : []
    const prompts = Array.isArray(body.prompts) ? body.prompts.slice(0, 3) : []

    const updated = await db.user.update({
      where: { id: me.id },
      data: {
        name,
        dateOfBirth: dateOfBirth ?? undefined,
        age: age ?? undefined,
        gender,
        lookingFor,
        bio,
        city,
        interests: JSON.stringify(interests),
        prompts: JSON.stringify(prompts),
        onboardedAt: new Date(),
        lastActiveAt: new Date(),
      },
    })

    return NextResponse.json({
      ok: true,
      user: {
        id: updated.id,
        name: updated.name,
        age: updated.age,
        gender: updated.gender,
        lookingFor: updated.lookingFor,
        onboardedAt: updated.onboardedAt,
      },
    })
  } catch (e: any) {
    console.error('Onboarding error', e)
    return NextResponse.json({ error: 'Failed to save profile' }, { status: 500 })
  }
}
