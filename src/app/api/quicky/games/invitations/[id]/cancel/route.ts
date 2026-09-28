// Dating Chat Games — CANCEL invitation (PRD §14 CANCELLED state, §45)
//
//   POST /api/quicky/games/invitations/[id]/cancel
//
// Sender-initiated cancel: while PENDING, the sender can pull the invitation
// back. Idempotent — already-terminal states are returned as-is.
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { cancelInvitation, sweepExpiredInvitations } from '@/lib/quicky/dating-games/invitations'
import { respondToGameInvite } from '@/lib/quicky/game-invites'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  await sweepExpiredInvitations()
  const result = await cancelInvitation({ invitationId: id, userId: me.id })

  if (result.error && !result.invitation) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 })
  }

  // If we actually cancelled, notify the recipient so their popup closes
  // (PRD §28 — the recipient's popup was waiting for PLAY_NOW / NOT_NOW;
  // a sender-cancel is a third terminal outcome the popup should also
  // honor).
  const inv = result.invitation
  if (inv && inv.status === 'CANCELLED' && result.error !== 'already_accepted') {
    respondToGameInvite(inv.recipientId, {
      accepted: false,
      matchId: inv.matchId,
      gameType: inv.gameType,
      fromId: me.id,
      fromName: me.name ?? 'Someone',
      invitationId: inv.id,
      cancelled: true,
    } as any)
  }

  return NextResponse.json(
    result.error
      ? { error: result.error, invitation: inv ? serialize(inv) : null }
      : { ok: true, invitation: inv ? serialize(inv) : null },
    { status: result.status ?? 200 }
  )
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
