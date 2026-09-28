// Dating Chat Games — DECLINE invitation (PRD §21, §53, §54)
//
//   POST /api/quicky/games/invitations/[id]/decline
//
// Idempotent (PRD §54): double-tapping NOT NOW resolves to one DECLINED row.
// Realtime-notifies the sender so their waiting screen shows the decline
// message ("X isn't in the mood for a game right now. Invite later.")
// and returns to chat.
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { declineInvitation, sweepExpiredInvitations } from '@/lib/quicky/dating-games/invitations'
import { respondToGameInvite } from '@/lib/quicky/game-invites'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  await sweepExpiredInvitations()
  const result = await declineInvitation({ invitationId: id, userId: me.id })

  if (result.error && !result.invitation) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 })
  }
  if (result.error && result.invitation) {
    return NextResponse.json(
      { error: result.error, invitation: serialize(result.invitation) },
      { status: result.status ?? 200 }
    )
  }

  // Realtime-notify the sender: NOT_NOW (PRD §21, §22, §28). The sender's
  // waiting screen listens via watchGameInvites and shows the decline
  // message before returning to chat.
  const inv = result.invitation!
  respondToGameInvite(inv.senderId, {
    accepted: false,
    matchId: inv.matchId,
    gameType: inv.gameType,
    fromId: me.id,
    fromName: me.name ?? 'Someone',
    invitationId: inv.id,
  } as any)

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
