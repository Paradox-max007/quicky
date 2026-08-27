// Quicky — auth helpers (mock OTP, session token via cookie)
// Per MVP scope: OTP is shown on screen (no real SMS). Sessions stored in DB.

import { db } from '@/lib/db'
import { cookies } from 'next/headers'
import crypto from 'crypto'

export const SESSION_COOKIE = 'quicky_session'
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30 // 30 days

export type AuthUser = {
  id: string
  phone: string
  email: string | null
  name: string | null
  age: number | null
  gender: string | null
  lookingFor: string | null
  isPremium: boolean
  isVerified: boolean
  quickyScore: number
  onboardedAt: Date | null
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (!token) return null
  const session = await db.session.findUnique({
    where: { token },
    include: { user: true },
  })
  if (!session || !session.user) return null
  if (session.expiresAt.getTime() < Date.now()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {})
    return null
  }
  const u = session.user

  // Lazy premium expiry: once premiumUntil passes, downgrade and disable
  // premium-only discovery filters the user had enabled.
  let isPremium = u.isPremium
  if (isPremium && u.premiumUntil && u.premiumUntil.getTime() < Date.now()) {
    isPremium = false
    await db.user
      .update({
        where: { id: u.id },
        data: {
          isPremium: false,
          premiumTier: null,
          premiumUntil: null,
          discoveryShowVerifiedOnly: false,
          discoveryRecentlyActive: false,
          // Snap free users back into the free age window
          ...(u.discoveryAgeMin !== null && u.discoveryAgeMin < 35 ? { discoveryAgeMin: 35 } : {}),
          ...(u.discoveryAgeMax !== null && u.discoveryAgeMax > 45 ? { discoveryAgeMax: 45 } : {}),
        },
      })
      .catch(() => {})
  }

  const age = u.dateOfBirth ? computeAge(u.dateOfBirth) : u.age
  return {
    id: u.id,
    phone: u.phone,
    email: u.email,
    name: u.name,
    age,
    gender: u.gender,
    lookingFor: u.lookingFor,
    isPremium,
    isVerified: u.isVerified,
    quickyScore: u.quickyScore,
    onboardedAt: u.onboardedAt,
  }
}

export async function requireUser(): Promise<AuthUser> {
  const u = await getCurrentUser()
  if (!u) throw new Error('Unauthorized')
  return u
}

export async function createSession(userId: string): Promise<string> {
  // Clean expired sessions for this user
  await db.session.deleteMany({ where: { userId, expiresAt: { lt: new Date() } } }).catch(() => {})
  const token = crypto.randomBytes(32).toString('hex')
  await db.session.create({
    data: {
      userId,
      token,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  })
  return token
}

export async function setSessionCookie(token: string) {
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS / 1000,
    path: '/',
  })
}

export async function clearSessionCookie() {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE)
}

export async function logout(): Promise<void> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (token) {
    await db.session.deleteMany({ where: { token } }).catch(() => {})
  }
  await clearSessionCookie()
}

// Compute age from DOB
export function computeAge(dob: Date): number {
  const now = new Date()
  let age = now.getFullYear() - dob.getFullYear()
  const m = now.getMonth() - dob.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--
  return age
}

// Generate a deterministic-ish 4-digit OTP for demo. Always shows on screen.
export function generateOtp(): string {
  return String(Math.floor(1000 + Math.random() * 9000))
}

// Sanitize phone to E.164-ish: +1XXXXXXXXXX
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return `+${digits}`
}
