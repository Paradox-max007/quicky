// Quicky — Phone Number change flow (OTP to new number → verify → update)
// POST /api/quicky/settings/phone
//   action: 'request_otp'  { newPhone }  -> sends OTP to new phone (demo: returns code)
//   action: 'verify'        { newPhone, code }  -> verifies OTP and updates user.phone
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, generateOtp, normalizePhone } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const action = String(body.action ?? '')

  if (action === 'request_otp') {
    const newPhone = normalizePhone(String(body.newPhone ?? ''))
    if (!newPhone || newPhone.length < 10) {
      return NextResponse.json({ error: 'Enter a valid phone number' }, { status: 400 })
    }
    if (newPhone === me.phone) {
      return NextResponse.json({ error: 'This is already your phone number' }, { status: 400 })
    }
    const existing = await db.user.findUnique({ where: { phone: newPhone } })
    if (existing && existing.id !== me.id) {
      return NextResponse.json({ error: 'This phone number is already in use' }, { status: 409 })
    }

    const code = generateOtp()
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000)

    await db.otpCode.updateMany({
      where: { phone: newPhone, consumed: false },
      data: { consumed: true },
    })
    await db.otpCode.create({
      data: { phone: newPhone, code, expiresAt, consumed: false },
    })

    return NextResponse.json({
      ok: true,
      phone: newPhone,
      demoCode: code,
      expiresInSeconds: 300,
    })
  }

  if (action === 'verify') {
    const newPhone = normalizePhone(String(body.newPhone ?? ''))
    const code = String(body.code ?? '').trim()
    if (!/^\d{4}$/.test(code)) {
      return NextResponse.json({ error: 'Enter the 4-digit code' }, { status: 400 })
    }

    const otp = await db.otpCode.findFirst({
      where: { phone: newPhone, code, consumed: false, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    })
    if (!otp) {
      return NextResponse.json({ error: 'Invalid or expired code' }, { status: 401 })
    }
    await db.otpCode.update({ where: { id: otp.id }, data: { consumed: true } })

    // Update the user's phone
    await db.user.update({ where: { id: me.id }, data: { phone: newPhone } })
    return NextResponse.json({ ok: true, phone: newPhone })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
