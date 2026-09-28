// Dating Chat Games — Server-side Invitation State Machine (PRD §14, §39, §54, §61)
//
// This is the SINGLE source of truth for dating-chat game invitations.
// The realtime broadcast in src/lib/quicky/game-invites.ts is fire-and-forget
// and is NOT trusted — every state transition goes through this module.
//
// State machine (PRD §14, §61):
//
//   PENDING ──PLAY_NOW──▶ ACCEPTED ──▶ (game completes) ──▶ COMPLETED
//   PENDING ──NOT_NOW──▶ DECLINED ──▶ CLOSED
//   PENDING ──timeout──▶ EXPIRED  ──▶ CLOSED
//   PENDING ──sender-cancel──▶ CANCELLED ──▶ CLOSED
//
// All operations are idempotent (PRD §54): double-tapping PLAY_NOW resolves
// to a single ACCEPTED row; double-tapping NOT_NOW resolves to a single
// DECLINED row. The Prisma unique constraint on (matchId, gameType, status)
// prevents duplicate PENDING rows for the same (match, game) pair (PRD §25).
//
// Realtime: callers are expected to also broadcast via notifyGameInvite /
// respondToGameInvite (src/lib/quicky/game-invites.ts) so the peer's UI
// updates instantly. This module is the source of truth; the realtime is
// the notification.

import { db } from '@/lib/db'
import { getDatingGame } from './registry'

// PRD §27 — invitation timeout. Configurable later via admin settings if
// needed; for now it's a constant.
export const INVITATION_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

export type InvitationStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'DECLINED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'COMPLETED'
  | 'CLOSED'

export const INVITATION_STATUSES: InvitationStatus[] = [
  'PENDING',
  'ACCEPTED',
  'DECLINED',
  'EXPIRED',
  'CANCELLED',
  'COMPLETED',
  'CLOSED',
]

export type GameInvitationRow = {
  id: string
  matchId: string
  gameType: string
  senderId: string
  recipientId: string
  roomId: string | null
  status: InvitationStatus
  respondedAt: Date | null
  responderId: string | null
  expiresAt: Date
  closeReason: string | null
  createdAt: Date
  updatedAt: Date
}

// ── Helpers ────────────────────────────────────────────────────────────────

function isPlayerOfMatch(match: { userAId: string; userBId: string }, userId: string): boolean {
  return match.userAId === userId || match.userBId === userId
}

function partnerOf(match: { userAId: string; userBId: string }, userId: string): string {
  return match.userAId === userId ? match.userBId : match.userAId
}

// ── Sweep expired PENDING invitations (PRD §27) ────────────────────────────
//
// Called from every read/write path. Cheap: one UPDATE … WHERE status='PENDING'
// AND expiresAt < now. Marks expired rows EXPIRED so subsequent reads see the
// final state. Could be promoted to a cron later, but lazy sweep is sufficient
// for now because the recipient's accept/decline path also guards against
// accepting an already-expired invitation.
export async function sweepExpiredInvitations(): Promise<void> {
  try {
    await db.gameInvitation.updateMany({
      where: { status: 'PENDING', expiresAt: { lt: new Date() } },
      data: { status: 'EXPIRED', closeReason: 'timeout', updatedAt: new Date() },
    })
  } catch {
    // The GameInvitation table may not exist yet on a fresh clone before the
    // first `prisma db push`. Silently no-op — the routes that depend on it
    // will fall back gracefully.
  }
}

// ── CREATE — sender invites a chat partner to a game (PRD §8, §10) ──────────
//
// Idempotent (PRD §25, §54):
//   - If a PENDING invitation already exists for (matchId, gameType, PENDING),
//     return it (no duplicate row, no new room created).
//   - If an ACCEPTED invitation exists for (matchId, gameType, ACCEPTED),
//     return it (the game is already in progress — caller routes to it).
//   - Otherwise create a new PENDING invitation with expiresAt = now + 5min.
//
// Returns the invitation row (existing or new) or throws on auth/validation.
export async function createInvitation(opts: {
  matchId: string
  gameType: string
  senderId: string
}): Promise<{ invitation: GameInvitationRow | null; created: boolean; error?: string; status?: number }> {
  const { matchId, gameType, senderId } = opts

  // Validate gameType against the registry — HIDDEN games cannot be invited
  // (programmatic invites are blocked so stale clients cannot resurrect a
  // game that's been removed from the menu). Currently no game is HIDDEN —
  // Ludo + Truth or Dare are AVAILABLE, Never Have I Ever is COMING_SOON.
  const game = getDatingGame(gameType)
  if (!game || game.status === 'HIDDEN') {
    return { invitation: null, created: false, error: 'game_not_available', status: 400 }
  }
  if (game.status === 'COMING_SOON') {
    // PRD §51 — Coming Soon games never create a room / invitation / session.
    return { invitation: null, created: false, error: 'game_coming_soon', status: 400 }
  }

  // Verify the match exists + the sender is a participant (PRD §9 — only
  // the two match users can access the conversation's invitations).
  const match = await db.match.findUnique({ where: { id: matchId } })
  if (!match || !isPlayerOfMatch(match, senderId)) {
    return { invitation: null, created: false, error: 'not_found', status: 404 }
  }
  if (match.status !== 'active') {
    return { invitation: null, created: false, error: 'unmatched', status: 410 }
  }

  const recipientId = partnerOf(match, senderId)

  // Sweep expired invitations BEFORE looking for an existing PENDING —
  // a stale PENDING for this slot would have just become EXPIRED.
  await sweepExpiredInvitations()

  // Idempotent path (PRD §25): is there an existing PENDING or ACCEPTED
  // invitation for this (matchId, gameType)? If so, return it.
  const existing = await db.gameInvitation.findFirst({
    where: {
      matchId,
      gameType,
      status: { in: ['PENDING', 'ACCEPTED'] },
    },
  })
  if (existing) {
    // The recipient can change over time? No — for a given Match the two
    // participants are fixed. Verify the existing row's sender matches the
    // current caller (the only other valid case is the original recipient
    // re-inviting the original sender — but in a 2P match, the recipient of
    // an existing PENDING is the current sender, so they cannot create a
    // new one. They must wait for the existing PENDING to be resolved.)
    return { invitation: existing as GameInvitationRow, created: false }
  }

  // Create a new PENDING invitation. The (matchId, gameType, status) unique
  // constraint enforces single-PENDING-per-(match, game) — a race between
  // two callers will fail one of them with P2002, in which case we re-read.
  try {
    const invitation = await db.gameInvitation.create({
      data: {
        matchId,
        gameType,
        senderId,
        recipientId,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + INVITATION_TIMEOUT_MS),
      },
    })
    return { invitation: invitation as GameInvitationRow, created: true }
  } catch (e: any) {
    // P2002 = unique constraint violation — another caller just created the
    // same PENDING. Re-read and return it.
    if (e?.code === 'P2002') {
      const again = await db.gameInvitation.findFirst({
        where: { matchId, gameType, status: 'PENDING' },
      })
      if (again) return { invitation: again as GameInvitationRow, created: false }
    }
    // The GameInvitation table may not exist yet (fresh clone before the
    // first `prisma db push`). Return a soft error so the UI shows a toast
    // rather than crashing the page.
    if (e?.code === 'P2021' || e?.message?.includes('does not exist')) {
      return { invitation: null, created: false, error: 'migration_required', status: 500 }
    }
    throw e
  }
}

// ── ACCEPT — recipient taps PLAY NOW (PRD §17) ──────────────────────────────
//
// Idempotent (PRD §54):
//   - If the invitation is already ACCEPTED, return it (no second room join).
//   - If the invitation is in any terminal state (DECLINED/EXPIRED/CANCELLED/
//     COMPLETED/CLOSED), return an error — the caller shows the right toast.
//   - Otherwise atomically flip PENDING → ACCEPTED and record the responder.
//
// The room itself is created lazily by the existing /matches/[matchId]/game
// POST route when both clients navigate to the game. The invitation's
// `roomId` field is left null until the game starts — the LudoGame overlay
// calls api.game.start(matchId, 'ludo') which creates the GameSession.
export async function acceptInvitation(opts: {
  invitationId: string
  userId: string
}): Promise<{ invitation: GameInvitationRow | null; error?: string; status?: number }> {
  const { invitationId, userId } = opts
  await sweepExpiredInvitations()

  const inv = await db.gameInvitation.findUnique({ where: { id: invitationId } })
  if (!inv) return { invitation: null, error: 'not_found', status: 404 }

  // Security (PRD §9): only the recipient can accept.
  if (inv.recipientId !== userId) return { invitation: null, error: 'access_denied', status: 403 }

  // Already accepted (PRD §54 — idempotent). Return the same row.
  if (inv.status === 'ACCEPTED') return { invitation: inv as GameInvitationRow }

  // Terminal states cannot be accepted.
  if (inv.status !== 'PENDING') {
    return {
      invitation: null,
      error:
        inv.status === 'EXPIRED' ? 'expired' :
        inv.status === 'DECLINED' ? 'declined' :
        inv.status === 'CANCELLED' ? 'cancelled' :
        inv.status === 'COMPLETED' ? 'completed' : 'closed',
      status: 410,
    }
  }

  // Race-safe flip: updateMany with a where clause that requires PENDING —
  // if another tap raced us, count=0 and we re-read the final state.
  const updated = await db.gameInvitation.updateMany({
    where: { id: invitationId, status: 'PENDING' },
    data: {
      status: 'ACCEPTED',
      respondedAt: new Date(),
      responderId: userId,
      updatedAt: new Date(),
    },
  })
  if (updated.count === 0) {
    const fresh = await db.gameInvitation.findUnique({ where: { id: invitationId } })
    return {
      invitation: (fresh as GameInvitationRow) ?? null,
      error: fresh?.status === 'ACCEPTED' ? undefined : fresh?.status.toLowerCase(),
      status: fresh?.status === 'ACCEPTED' ? 200 : 410,
    }
  }

  const result = await db.gameInvitation.findUnique({ where: { id: invitationId } })
  return { invitation: (result as GameInvitationRow) ?? null }
}

// ── DECLINE — recipient taps NOT NOW (PRD §21) ──────────────────────────────
//
// Idempotent (PRD §54):
//   - If already DECLINED, return it.
//   - If PENDING, atomically flip to DECLINED. The room cleanup is the
//     caller's responsibility (the existing /matches/[matchId]/game PATCH
//     'end' route handles closing any GameSession that may have been
//     optimistically created).
//   - Other states are non-declinable (return their status as error).
export async function declineInvitation(opts: {
  invitationId: string
  userId: string
}): Promise<{ invitation: GameInvitationRow | null; error?: string; status?: number }> {
  const { invitationId, userId } = opts
  await sweepExpiredInvitations()

  const inv = await db.gameInvitation.findUnique({ where: { id: invitationId } })
  if (!inv) return { invitation: null, error: 'not_found', status: 404 }
  if (inv.recipientId !== userId) return { invitation: null, error: 'access_denied', status: 403 }
  if (inv.status === 'DECLINED') return { invitation: inv as GameInvitationRow }

  if (inv.status !== 'PENDING') {
    return {
      invitation: null,
      error:
        inv.status === 'EXPIRED' ? 'expired' :
        inv.status === 'ACCEPTED' ? 'accepted' :
        inv.status === 'CANCELLED' ? 'cancelled' :
        inv.status === 'COMPLETED' ? 'completed' : 'closed',
      status: 410,
    }
  }

  const updated = await db.gameInvitation.updateMany({
    where: { id: invitationId, status: 'PENDING' },
    data: {
      status: 'DECLINED',
      respondedAt: new Date(),
      responderId: userId,
      closeReason: 'user_declined',
      updatedAt: new Date(),
    },
  })
  if (updated.count === 0) {
    const fresh = await db.gameInvitation.findUnique({ where: { id: invitationId } })
    return {
      invitation: (fresh as GameInvitationRow) ?? null,
      error: fresh?.status === 'DECLINED' ? undefined : fresh?.status.toLowerCase(),
      status: fresh?.status === 'DECLINED' ? 200 : 410,
    }
  }

  const result = await db.gameInvitation.findUnique({ where: { id: invitationId } })
  return { invitation: (result as GameInvitationRow) ?? null }
}

// ── CANCEL — sender cancels a PENDING invitation (PRD §14 CANCELLED state) ──
//
// Used when the sender taps "Cancel" on the waiting screen. Idempotent —
// already-CANCELLED returns the same row.
export async function cancelInvitation(opts: {
  invitationId: string
  userId: string
}): Promise<{ invitation: GameInvitationRow | null; error?: string; status?: number }> {
  const { invitationId, userId } = opts
  await sweepExpiredInvitations()

  const inv = await db.gameInvitation.findUnique({ where: { id: invitationId } })
  if (!inv) return { invitation: null, error: 'not_found', status: 404 }
  // Only the sender can cancel.
  if (inv.senderId !== userId) return { invitation: null, error: 'access_denied', status: 403 }
  if (inv.status === 'CANCELLED') return { invitation: inv as GameInvitationRow }
  if (inv.status === 'DECLINED' || inv.status === 'EXPIRED' || inv.status === 'COMPLETED' || inv.status === 'CLOSED') {
    return { invitation: inv as GameInvitationRow }
  }
  // ACCEPTED invitations cannot be cancelled — the game is already in progress;
  // the sender should use the game's own leave/exit flow (PRD §45).
  if (inv.status === 'ACCEPTED') {
    return { invitation: inv as GameInvitationRow, error: 'already_accepted', status: 410 }
  }

  await db.gameInvitation.updateMany({
    where: { id: invitationId, status: 'PENDING' },
    data: {
      status: 'CANCELLED',
      respondedAt: new Date(),
      responderId: userId,
      closeReason: 'sender_cancelled',
      updatedAt: new Date(),
    },
  })
  const result = await db.gameInvitation.findUnique({ where: { id: invitationId } })
  return { invitation: (result as GameInvitationRow) ?? null }
}

// ── COMPLETE — game finished; mark the invitation COMPLETED (PRD §29, §61) ──
//
// Called from the game-completion path (the LudoGame PATCH /matches/[matchId]/game
// route on win, or the GameActivityCard writer). Idempotent.
export async function completeInvitation(opts: {
  invitationId: string
  roomId?: string | null
}): Promise<{ invitation: GameInvitationRow | null; error?: string; status?: number }> {
  const { invitationId, roomId } = opts
  await sweepExpiredInvitations()

  const inv = await db.gameInvitation.findUnique({ where: { id: invitationId } })
  if (!inv) return { invitation: null, error: 'not_found', status: 404 }
  if (inv.status === 'COMPLETED') return { invitation: inv as GameInvitationRow }
  if (inv.status !== 'ACCEPTED') {
    return {
      invitation: inv as GameInvitationRow,
      error: inv.status.toLowerCase(),
      status: 410,
    }
  }

  await db.gameInvitation.update({
    where: { id: invitationId },
    data: {
      status: 'COMPLETED',
      roomId: roomId ?? inv.roomId,
      closeReason: 'game_completed',
      updatedAt: new Date(),
    },
  })
  const result = await db.gameInvitation.findUnique({ where: { id: invitationId } })
  return { invitation: (result as GameInvitationRow) ?? null }
}

// ── READ — get the active invitation for a match+gameType (PRD §25) ────────
//
// Returns the most recent PENDING or ACCEPTED invitation for this match+game,
// or null if there is none. Used by the chat to render the "Waiting for
// response…" banner and the "Reconnect to game" affordance.
export async function getActiveInvitation(opts: {
  matchId: string
  gameType?: string
  userId: string
}): Promise<{ invitation: GameInvitationRow | null }> {
  const { matchId, gameType, userId } = opts
  await sweepExpiredInvitations()

  const match = await db.match.findUnique({ where: { id: matchId } })
  if (!match || !isPlayerOfMatch(match, userId)) {
    return { invitation: null }
  }

  const invitation = await db.gameInvitation.findFirst({
    where: {
      matchId,
      ...(gameType ? { gameType } : {}),
      status: { in: ['PENDING', 'ACCEPTED'] },
    },
    orderBy: { updatedAt: 'desc' },
  })
  return { invitation: (invitation as GameInvitationRow) ?? null }
}

// ── READ ALL — all active invitations involving this user (PRD §53) ──────────
//
// Used by the global DatingGameInvitePopup: on app load it fetches any
// PENDING invitation where I am the recipient (so the popup re-arms if the
// user closed the app mid-invite — PRD §13 persistence).
export async function getActiveInvitationsForUser(opts: {
  userId: string
}): Promise<{ invitations: GameInvitationRow[] }> {
  const { userId } = opts
  await sweepExpiredInvitations()

  try {
    const invitations = await db.gameInvitation.findMany({
      where: {
        recipientId: userId,
        status: 'PENDING',
      },
      orderBy: { updatedAt: 'desc' },
    })
    return { invitations: invitations as GameInvitationRow[] }
  } catch {
    return { invitations: [] }
  }
}
