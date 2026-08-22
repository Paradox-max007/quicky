// Quicky — Email add/change flow (OTP to new email → verify → update)
// POST /api/quicky/settings/email
//   action: 'request_otp'  { email }  -> sends OTP to email (demo: returns code)
//   action: 'verify'        { email, code }  -> verifies OTP and updates user.email
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

function generateOtp() {
  return String(Math.floor(1000 + Math.random() * 9000))
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const action = String(body.action ?? '')

  if (action === 'request_otp') {
    const email = String(body.email ?? '').trim().toLowerCase()
    if (!isValidEmail(email)) {
      return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 })
    }
    if (email === me.email) {
      return NextResponse.json({ error: 'This is already your email' }, { status: 400 })
    }
    const existing = await db.user.findUnique({ where: { email } })
    if (existing && existing.id !== me.id) {
      return NextResponse.json({ error: 'This email is already in use' }, { status: 409 })
    }

    const code = generateOtp()
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000)

    await db.emailOtpCode.updateMany({
      where: { email, consumed: false },
      data: { consumed: true },
    })
    await db.emailOtpCode.create({
      data: { email, code, expiresAt, consumed: false },
    })

    return NextResponse.json({
      ok: true,
      email,
      demoCode: code,
      expiresInSeconds: 300,
    })
  }

  if (action === 'verify') {
    const email = String(body.email ?? '').trim().toLowerCase()
    const code = String(body.code ?? '').trim()
    if (!/^\d{4}$/.test(code)) {
      return NextResponse.json({ error: 'Enter the 4-digit code' }, { status: 400 })
    }

    const otp = await db.emailOtpCode.findFirst({
      where: { email, code, consumed: false, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    })
    if (!otp) {
      return NextResponse.json({ error: 'Invalid or expired code' }, { status: 401 })
    }
    await db.emailOtpCode.update({ where: { id: otp.id }, data: { consumed: true } })

    // Update the user's email
    await db.user.update({ where: { id: me.id }, data: { email } })
    return NextResponse.json({ ok: true, email })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
