// Quicky — REWARD SESSION STATUS (Monetization PRD §7)
// GET    /api/quicky/rewards/session/[id] → verification status (poll target)
// DELETE /api/quicky/rewards/session/[id] → client cancelled before completion
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { getRewardSession, cancelRewardSession } from '@/lib/quicky/rewards/sessions'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const session = await getRewardSession(id, me.id)
  if (!session) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ session })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const cancelled = await cancelRewardSession(id, me.id)
  return NextResponse.json({ ok: true, cancelled })
}
