// Dating Chat Games — Game Invitation API (PRD §53)
//
//   POST  /api/quicky/games/invitations          — create (sender invites)
//   GET   /api/quicky/games/invitations/active   — list my active invitations
//
// Accept / decline / cancel / complete live under /api/quicky/games/invitations/[id]/...
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import {
  createInvitation,
  getActiveInvitationsForUser,
  getActiveInvitation,
  sweepExpiredInvitations,
} from '@/lib/quicky/dating-games/invitations'
import { notifyGameInvite } from '@/lib/quicky/game-invites'

// ── POST /api/quicky/games/invitations — create (PRD §53) ───────────────
//
// Body: { conversationId: string, recipientId: string, gameType: 'ludo' }
//   `conversationId` is the dating Match.id (PRD §8 — the private room is
//   scoped to a Match, not a separate Conversation entity).
//   `recipientId` is the chat partner's user id.
//
// Response:
//   200/201 { ok, invitation, created }
//   400     { error: 'game_not_available' | 'game_coming_soon' }
//   404     { error: 'not_found' }
//   410     { error: 'unmatched' }
//   500     { error: 'migration_required' }   ← run `prisma db push` first
export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const conversationId = String(body.conversationId ?? '')
  const recipientId = String(body.recipientId ?? '')
  const gameType = String(body.gameType ?? '')

  if (!conversationId || !recipientId || !gameType) {
    return NextResponse.json(
      { error: 'conversationId, recipientId, gameType required' },
      { status: 400 }
    )
  }
  if (recipientId === me.id) {
    return NextResponse.json({ error: 'cannot_invite_self' }, { status: 400 })
  }

  // The recipient must be the OTHER participant of the match (PRD §9).
  const match = await db.match.findUnique({ where: { id: conversationId } })
  if (!match || (match.userAId !== me.id && match.userBId !== me.id)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const expectedRecipient = match.userAId === me.id ? match.userBId : match.userAId
  if (expectedRecipient !== recipientId) {
    return NextResponse.json({ error: 'recipient_not_in_match' }, { status: 400 })
  }

  // Create the invitation (idempotent — PRD §25, §54).
  const result = await createInvitation({ matchId: conversationId, gameType, senderId: me.id })
  if (result.error || !result.invitation) {
    return NextResponse.json(
      { error: result.error ?? 'create_failed' },
      { status: result.status ?? 500 }
    )
  }

  // Realtime notify the recipient (PRD §10, §11, §28). Fire-and-forget —
  // the persisted row is the source of truth; this broadcast just wakes up
  // the popup immediately. The popup also fetches /active on mount so a
  // missed broadcast self-heals (PRD §13).
  notifyGameInvite(recipientId, {
    matchId: conversationId,
    gameType: gameType as any,
    fromId: me.id,
    fromName: me.name ?? 'Someone',
    invitationId: result.invitation.id,
  } as any)

  return NextResponse.json({
    ok: true,
    invitation: serializeInvitation(result.invitation),
    created: result.created,
  })
}

// ── GET /api/quicky/games/invitations — list active invitations (PRD §53) ─
//
// Query params:
//   ?matchId=<id>            → return the active invitation for this match
//   ?matchId=<id>&gameType=ludo  → narrow to a specific game
//   (no params)              → return ALL PENDING invitations where I am the
//                             recipient (used by the global popup on app
//                             load — PRD §13 persistence)
export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await sweepExpiredInvitations()

  const url = new URL(req.url)
  const matchId = url.searchParams.get('matchId')

  if (matchId) {
    const gameType = url.searchParams.get('gameType') ?? undefined
    const { invitation } = await getActiveInvitation({
      matchId,
      gameType: gameType ?? undefined,
      userId: me.id,
    })
    return NextResponse.json({ invitation: invitation ? serializeInvitation(invitation) : null })
  }

  // No matchId → return all my pending inbound invitations.
  const { invitations } = await getActiveInvitationsForUser({ userId: me.id })
  return NextResponse.json({
    invitations: invitations.map(serializeInvitation),
  })
}

// ── Serializer ─────────────────────────────────────────────────────────────
//
// GameInvitation rows carry Prisma Date objects; the client wants ISO
// strings + a snake-case-ish shape for the realtime payload parity.
function serializeInvitation(inv: any) {
  return {
    id: inv.id,
    matchId: inv.matchId,
    gameType: inv.gameType,
    senderId: inv.senderId,
    recipientId: inv.recipientId,
    roomId: inv.roomId,
    status: inv.status,
    respondedAt: inv.respondedAt ? inv.respondedAt.toISOString() : null,
    responderId: inv.responderId,
    expiresAt: inv.expiresAt ? inv.expiresAt.toISOString() : null,
    closeReason: inv.closeReason,
    createdAt: inv.createdAt ? inv.createdAt.toISOString() : null,
    updatedAt: inv.updatedAt ? inv.updatedAt.toISOString() : null,
  }
}
