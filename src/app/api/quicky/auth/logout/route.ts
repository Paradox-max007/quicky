// Quicky — logout
// POST /api/quicky/auth/logout
import { NextResponse } from 'next/server'
import { logout } from '@/lib/quicky/auth'

export async function POST() {
  await logout()
  return NextResponse.json({ ok: true })
}
