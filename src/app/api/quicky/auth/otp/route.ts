// Quicky — OTP request API (mock OTP, code returned on screen for demo)
// POST /api/quicky/auth/otp  { phone }
// Returns: { ok, demoCode }  (demoCode is the OTP shown to the user; do NOT do this in prod)

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { generateOtp, normalizePhone } from '@/lib/quicky/auth'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const phone = normalizePhone(String(body.phone ?? ''))
    if (!phone || phone.length < 10) {
      return NextResponse.json({ error: 'Enter a valid phone number' }, { status: 400 })
    }
    const code = generateOtp()
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000) // 5 min

    // Invalidate older unconsumed codes for this phone
    await db.otpCode.updateMany({
      where: { phone, consumed: false },
      data: { consumed: true },
    })

    await db.otpCode.create({
      data: { phone, code, expiresAt, consumed: false },
    })

    return NextResponse.json({
      ok: true,
      phone,
      // Demo: surface the code so the test user can paste it in. Real app would SMS.
      demoCode: code,
      expiresInSeconds: 300,
    })
  } catch (e: any) {
    console.error('OTP request error', e)
    return NextResponse.json({ error: 'Failed to send code' }, { status: 500 })
  }
}
