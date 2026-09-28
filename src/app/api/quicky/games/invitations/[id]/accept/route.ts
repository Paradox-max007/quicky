// Dating Chat Games — ACCEPT invitation (PRD §17, §53, §54)
//
//   POST /api/quicky/games/invitations/[id]/accept
//
// Idempotent (PRD §54): double-tapping PLAY NOW resolves to one ACCEPTED row.
// Realtime-notifies the sender so their waiting screen transitions.
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { acceptInvitation, sweepExpiredInvitations } from '@/lib/quicky/dating-games/invitations'
import { respondToGameInvite } from '@/lib/quicky/game-invites'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  await sweepExpiredInvitations()
  const result = await acceptInvitation({ invitationId: id, userId: me.id })

  if (result.error && !result.invitation) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 })
  }
  if (result.error && result.invitation) {
    // The invitation exists but is in a non-PENDING state — return the
    // current state so the client can render the right toast (e.g. "expired").
    return NextResponse.json(
      { error: result.error, invitation: serialize(result.invitation) },
      { status: result.status ?? 200 }
    )
  }

  // Realtime-notify the sender: PLAY_NOW (PRD §17, §28). The sender's waiting
  // screen listens via watchGameInvites and transitions to the game.
  const inv = result.invitation!
  respondToGameInvite(inv.senderId, {
    accepted: true,
    matchId: inv.matchId,
    gameType: inv.gameType,
    fromId: me.id,
    fromName: me.name ?? 'Someone',
    invitationId: inv.id,
  } as any)

  // The recipient side opens the game by setting a sessionStorage flag that
  // ChatView reads on mount (same handshake as the legacy popup). The popup
  // itself handles this — no action here.

  return NextResponse.json({ ok: true, invitation: serialize(inv) })
}

function serialize(inv: any) {
  return {
    id: inv.id,
    matchId: inv.matchId,
    gameType: inv.gameType,
    senderId: inv.senderId,
    recipientId: inv.recipientId,
    roomId: inv.roomId,
    status: inv.status,
    respondedAt: inv.respondedAt ? (inv.respondedAt instanceof Date ? inv.respondedAt.toISOString() : inv.respondedAt) : null,
    responderId: inv.responderId,
    expiresAt: inv.expiresAt ? (inv.expiresAt instanceof Date ? inv.expiresAt.toISOString() : inv.expiresAt) : null,
    closeReason: inv.closeReason,
    createdAt: inv.createdAt ? (inv.createdAt instanceof Date ? inv.createdAt.toISOString() : inv.createdAt) : null,
    updatedAt: inv.updatedAt ? (inv.updatedAt instanceof Date ? inv.updatedAt.toISOString() : inv.updatedAt) : null,
  }
}
