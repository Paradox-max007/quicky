// Quicky — ADMIN GIFT MULTIPLIER EVENTS (realm PRD §10/§13/§51/§75-§77)
// GET    /api/quicky/admin/multiplier-events          — full history (table)
// POST   /api/quicky/admin/multiplier-events          — create (validated:
//        integer 2-100, 1h-7d, NO overlap §13; audit-logged §76)
// PATCH  /api/quicky/admin/multiplier-events          — cancel (live/scheduled)
// DELETE /api/quicky/admin/multiplier-events?id=      — remove cancelled/
//        expired rows only (history otherwise kept for reporting §51)
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, logAdminAction } from '@/lib/quicky/admin'
import {
  listGiftMultiplierEvents,
  createGiftMultiplierEvent,
  cancelGiftMultiplierEvent,
  deleteGiftMultiplierEvent,
} from '@/lib/quicky/realm/gift-multiplier'

export async function GET(_req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const events = await listGiftMultiplierEvents()
  return NextResponse.json({ events })
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const body = await req.json().catch(() => null)
  const name = String(body?.name ?? '')
  const multiplier = Number(body?.multiplier)
  const durationMs = Number(body?.durationMs)
  // Start: now (default) or a supplied ISO/scheduled time (§10 Start).
  const startsAt = body?.startsAt ? new Date(String(body.startsAt)) : new Date()

  const res = await createGiftMultiplierEvent({ name, multiplier, startsAt, durationMs, createdBy: gate.me.id })
  if (!res.ok) return NextResponse.json({ error: res.error, message: res.message }, { status: 400 })

  await logAdminAction(gate.me.id, 'multiplier_event_created', 'GiftMultiplierEvent', res.event.id, {
    name: res.event.name,
    multiplier: res.event.multiplier,
    startsAt: res.event.startsAt,
    expiresAt: res.event.expiresAt,
  })
  return NextResponse.json({ ok: true, event: res.event })
}

export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const body = await req.json().catch(() => null)
  const id = String(body?.id ?? '')
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 })

  const ok = await cancelGiftMultiplierEvent(id)
  if (!ok) return NextResponse.json({ error: 'not_cancellable' }, { status: 400 })
  await logAdminAction(gate.me.id, 'multiplier_event_cancelled', 'GiftMultiplierEvent', id)
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 })

  const ok = await deleteGiftMultiplierEvent(id)
  if (!ok) return NextResponse.json({ error: 'not_deletable' }, { status: 400 })
  await logAdminAction(gate.me.id, 'multiplier_event_deleted', 'GiftMultiplierEvent', id)
  return NextResponse.json({ ok: true })
}
