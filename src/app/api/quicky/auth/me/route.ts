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

  // Fetch full profile (photos, interests, prompts, settings)
  const full = await db.user.findUnique({
    where: { id: u.id },
    include: {
      photos: { orderBy: { position: 'asc' } },
      settings: true,
    },
  })
  if (!full) return NextResponse.json({ user: null }, { status: 200 })

  // Posts grid (own + mutual game posts)
  const posts = await db.communityPost.findMany({
    where: { OR: [{ userId: full.id }, { coOwnerId: full.id }] },
    orderBy: { createdAt: 'desc' },
    take: 24,
    select: { id: true, mediaUrl: true, mediaType: true, caption: true, gameType: true, gameTitle: true, emoji: true, createdAt: true },
  })

  // Auto-create settings if missing
  let settings = full.settings
  if (!settings) {
    settings = await db.userSettings.create({
      data: { userId: full.id },
    })
  }

  return NextResponse.json({
    user: {
      id: full.id,
      phone: full.phone,
      email: full.email,
      name: full.name,
      age: full.age,
      dateOfBirth: full.dateOfBirth,
      gender: full.gender,
      lookingFor: full.lookingFor,
      bio: full.bio,
      city: full.city,
      interests: full.interests ? JSON.parse(full.interests) : [],
      prompts: full.prompts ? JSON.parse(full.prompts) : [],
      photos: full.photos.map((p) => ({ id: p.id, url: p.url, isPrimary: p.isPrimary, isPrivate: p.isPrivate, position: p.position, displayHeight: p.displayHeight })),
      isPremium: full.isPremium,
      premiumUntil: full.premiumUntil,
      isVerified: full.isVerified,
      quickyScore: full.quickyScore,
      // v3 economy + admin fields (PRD §15/§62) — real DB values, never placeholders
      isAdmin: full.isAdmin,
      coinBalance: full.coinBalance,
      kissPoints: full.kissPoints,
      // DUAL PROFILE (profile revision) — the GAME profile side: lifetime
      // game stats for the Game tab on my own profile page.
      gamesPlayed: full.gamesPlayed,
      kissesGiven: full.kissesGiven,
      ludoWins: full.ludoWins,
      ludoTokensFinished: full.ludoTokensFinished,
      ludoCaptures: full.ludoCaptures,
      giftsSentCount: full.giftsSentCount,
      giftsReceivedCount: full.giftsReceivedCount,
      posts,
      postCount: posts.length,
      onboardedAt: full.onboardedAt,
      // Discovery preferences
      discoveryAgeMin: full.discoveryAgeMin,
      discoveryAgeMax: full.discoveryAgeMax,
      discoveryDistanceKm: full.discoveryDistanceKm,
      discoveryShowVerifiedOnly: full.discoveryShowVerifiedOnly,
      discoveryRecentlyActive: full.discoveryRecentlyActive,
      discoveryHeightMin: full.discoveryHeightMin,
      discoveryHeightMax: full.discoveryHeightMax,
      discoveryEducations: full.discoveryEducations ? JSON.parse(full.discoveryEducations) : [],
      discoveryLifestyles: full.discoveryLifestyles ? JSON.parse(full.discoveryLifestyles) : [],
      // Profile details
      heightCm: full.heightCm,
      education: full.education,
      lifestyle: full.lifestyle,
      lastActiveAt: full.lastActiveAt,
      // Settings
      settings: settings,
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

    if (body.heightCm !== undefined) {
      const h = Number(body.heightCm)
      if (!Number.isFinite(h) || h < 120 || h > 230) {
        return NextResponse.json({ error: 'Height must be 120–230 cm' }, { status: 400 })
      }
      data.heightCm = Math.round(h)
    }
    if (body.education !== undefined) {
      data.education = body.education ? String(body.education).slice(0, 60) : null
    }
    if (body.lifestyle !== undefined) {
      data.lifestyle = body.lifestyle ? String(body.lifestyle).slice(0, 60) : null
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

    // Discovery preferences (premium gates: distance, filters, wider age range)
    // Free users: age 35–45, distance ≤ 50km, no verified-only / recently-active filters
    if (body.discoveryAgeMin !== undefined) {
      const min = Number(body.discoveryAgeMin)
      if (!me.isPremium && (min < 35 || min > 45)) {
        return NextResponse.json({ error: 'premium_required', paywall: 'discovery_filters' }, { status: 402 })
      }
      data.discoveryAgeMin = min
    }
    if (body.discoveryAgeMax !== undefined) {
      const max = Number(body.discoveryAgeMax)
      if (!me.isPremium && (max < 35 || max > 45)) {
        return NextResponse.json({ error: 'premium_required', paywall: 'discovery_filters' }, { status: 402 })
      }
      data.discoveryAgeMax = max
    }
    if (body.discoveryDistanceKm !== undefined) {
      const dist = Number(body.discoveryDistanceKm)
      // Free users limited to 50km
      if (!me.isPremium && dist > 50) {
        return NextResponse.json({ error: 'premium_required', paywall: 'discovery_filters' }, { status: 402 })
      }
      data.discoveryDistanceKm = dist
    }
    if (body.discoveryShowVerifiedOnly !== undefined) {
      if (!me.isPremium && body.discoveryShowVerifiedOnly === true) {
        return NextResponse.json({ error: 'premium_required', paywall: 'discovery_filters' }, { status: 402 })
      }
      data.discoveryShowVerifiedOnly = Boolean(body.discoveryShowVerifiedOnly)
    }
    if (body.discoveryRecentlyActive !== undefined) {
      if (!me.isPremium && body.discoveryRecentlyActive === true) {
        return NextResponse.json({ error: 'premium_required', paywall: 'discovery_filters' }, { status: 402 })
      }
      data.discoveryRecentlyActive = Boolean(body.discoveryRecentlyActive)
    }
    if (body.discoveryHeightMin !== undefined) {
      if (!me.isPremium) {
        return NextResponse.json({ error: 'premium_required', paywall: 'discovery_filters' }, { status: 402 })
      }
      const v = Number(body.discoveryHeightMin)
      data.discoveryHeightMin = Number.isFinite(v) ? Math.round(v) : null
    }
    if (body.discoveryHeightMax !== undefined) {
      if (!me.isPremium) {
        return NextResponse.json({ error: 'premium_required', paywall: 'discovery_filters' }, { status: 402 })
      }
      const v = Number(body.discoveryHeightMax)
      data.discoveryHeightMax = Number.isFinite(v) ? Math.round(v) : null
    }
    if (body.discoveryEducations !== undefined) {
      if (!me.isPremium) {
        return NextResponse.json({ error: 'premium_required', paywall: 'discovery_filters' }, { status: 402 })
      }
      if (!Array.isArray(body.discoveryEducations)) {
        return NextResponse.json({ error: 'discoveryEducations must be an array' }, { status: 400 })
      }
      data.discoveryEducations = JSON.stringify(body.discoveryEducations.slice(0, 6))
    }
    if (body.discoveryLifestyles !== undefined) {
      if (!me.isPremium) {
        return NextResponse.json({ error: 'premium_required', paywall: 'discovery_filters' }, { status: 402 })
      }
      if (!Array.isArray(body.discoveryLifestyles)) {
        return NextResponse.json({ error: 'discoveryLifestyles must be an array' }, { status: 400 })
      }
      data.discoveryLifestyles = JSON.stringify(body.discoveryLifestyles.slice(0, 6))
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
        discoveryAgeMin: updated.discoveryAgeMin,
        discoveryAgeMax: updated.discoveryAgeMax,
        discoveryDistanceKm: updated.discoveryDistanceKm,
        discoveryShowVerifiedOnly: updated.discoveryShowVerifiedOnly,
        discoveryRecentlyActive: updated.discoveryRecentlyActive,
        discoveryHeightMin: updated.discoveryHeightMin,
        discoveryHeightMax: updated.discoveryHeightMax,
        discoveryEducations: updated.discoveryEducations ? JSON.parse(updated.discoveryEducations) : [],
        discoveryLifestyles: updated.discoveryLifestyles ? JSON.parse(updated.discoveryLifestyles) : [],
        heightCm: updated.heightCm,
        education: updated.education,
        lifestyle: updated.lifestyle,
      },
    })
  } catch (e: any) {
    console.error('Edit profile error', e)
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
  }
}
