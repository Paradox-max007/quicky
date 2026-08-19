// Quicky — OTP verify + login/signup
// POST /api/quicky/auth/verify { phone, code }
// Creates user if not exists, sets session cookie.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { computeAge, createSession, normalizePhone, setSessionCookie } from '@/lib/quicky/auth'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const phone = normalizePhone(String(body.phone ?? ''))
    const code = String(body.code ?? '').trim()

    if (!phone || !/^\d{4}$/.test(code)) {
      return NextResponse.json({ error: 'Enter the 4-digit code' }, { status: 400 })
    }

    // Find an unconsumed, non-expired code
    const otp = await db.otpCode.findFirst({
      where: {
        phone,
        code,
        consumed: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    })
    if (!otp) {
      return NextResponse.json({ error: 'Invalid or expired code' }, { status: 401 })
    }
    await db.otpCode.update({ where: { id: otp.id }, data: { consumed: true } })

    // Find or create user
    let user = await db.user.findUnique({ where: { phone } })
    if (!user) {
      user = await db.user.create({
        data: {
          phone,
          // Give every new user a "New & Boosted" 24-48h window per PRD §7
          // We track this via createdAt automatically.
          quickyScore: 0,
          isPremium: false,
          isVerified: false,
          lastActiveAt: new Date(),
        },
      })
    } else {
      await db.user.update({
        where: { id: user.id },
        data: { lastActiveAt: new Date() },
      })
    }

    const token = await createSession(user.id)
    await setSessionCookie(token)

    const age = user.dateOfBirth ? computeAge(user.dateOfBirth) : user.age
    return NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        phone: user.phone,
        name: user.name,
        age,
        gender: user.gender,
        lookingFor: user.lookingFor,
        isPremium: user.isPremium,
        isVerified: user.isVerified,
        quickyScore: user.quickyScore,
        onboardedAt: user.onboardedAt,
      },
      onboarded: !!user.onboardedAt,
    })
  } catch (e: any) {
    console.error('Verify error', e)
    return NextResponse.json({ error: 'Failed to verify code' }, { status: 500 })
  }
}
