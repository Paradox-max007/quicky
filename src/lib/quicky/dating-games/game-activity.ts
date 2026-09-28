// Dating Chat Games — Game Activity writer (PRD §29, §31-§37, §56, §57)
//
// Called by the game-completion path (LudoGame PATCH /matches/[matchId]/game
// on win) to insert a SINGLE shared game_activity message into the dating
// chat conversation. Both participants render the same beautiful card —
// it is NOT a per-user message, it is a conversation-level event.
//
// Server-authoritative (PRD §30, §42): durationSeconds is computed from the
// server's view of startedAt/finishedAt, never the client's clock.

import { db } from '@/lib/db'
import { completeInvitation } from './invitations'
import { getDatingGame } from './registry'

export type GameActivityPayload = {
  gameType: 'ludo' | 'never_have_i_ever' | 'truth_or_dare'
  gameName: string
  // The GameSession.id (Ludo legacy) or whatever room id the game used.
  sessionId: string
  // The two participants (for historical rendering / future "play again").
  playerAId: string
  playerBId: string
  winnerId: string | null
  startedAt: string   // ISO
  finishedAt: string  // ISO
  durationSeconds: number
}

// ── Duration formatting (PRD §32) ───────────────────────────────────────────
//
// "for 8m", "for 42m", "for 1h 12m", "for 2h 05m", "for 2h 45m"
// Avoid "92 minutes" unless appropriate for very short durations.
export function formatGameDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) {
    // 1h 12m, 2h 05m, 2h 45m — always zero-pad minutes when there are hours
    // so the layout stays stable.
    return `${h}h ${m.toString().padStart(2, '0')}m`
  }
  // Under an hour: "8m", "42m"
  return `${m}m`
}

// ── Insert the shared game_activity message + close the invitation ──────────
//
// Steps:
//   1. Load the GameSession to get authoritative startedAt/finishedAt/winner.
//      For Ludo, the session.state JSON contains ludoState.startedAt +
//      ludoState.endedAt (epoch ms); for the legacy 2-player LudoGame the
//      session.updatedAt is the closest thing to finishedAt.
//   2. Compute durationSeconds = (finishedAt - startedAt) / 1000.
//   3. Insert ONE Message row of type='game_activity' with the payload in
//      `metadata`. The senderId is the winner (or userA if a draw) — purely
//      cosmetic, since the card is rendered identically for both sides
//      (PRD §33 — same card for both users; PRD §57 — one conversation-level
//      event, not two).
//   4. Update the GameInvitation row to COMPLETED (PRD §61) — idempotent.
//
// Re-running this for the same sessionId is idempotent: a unique marker in
// `metadata` (the sessionId) is checked first via a findFirst — if a
// game_activity row already exists for this sessionId, return it instead of
// inserting a duplicate (PRD §57 — "Do Not Create Two Messages").
export async function writeGameActivityForSession(opts: {
  sessionId: string
  winnerColor?: string | null  // 'A' | 'B' for Ludo, null for draws/cancellations
}): Promise<{ message: any | null; invitation: any | null; error?: string }> {
  const { sessionId, winnerColor } = opts

  const session = await db.gameSession.findUnique({ where: { id: sessionId } })
  if (!session) return { message: null, invitation: null, error: 'session_not_found' }
  if (session.status !== 'ended') {
    // Don't write the card for a still-active game — the caller (the PATCH
    // route) must have already set status='ended' for the win path.
    return { message: null, invitation: null, error: 'session_not_ended' }
  }

  const match = await db.match.findUnique({ where: { id: session.matchId } })
  if (!match) return { message: null, invitation: null, error: 'match_not_found' }

  // Authoritative timestamps (PRD §30). For the legacy 2P LudoGame the
  // session.state JSON contains `startedAt` and `endedAt` (epoch ms).
  let startedAtMs: number | null = null
  let endedAtMs: number | null = null
  try {
    if (session.state) {
      const parsed = JSON.parse(session.state)
      if (typeof parsed?.startedAt === 'number') startedAtMs = parsed.startedAt
      if (typeof parsed?.endedAt === 'number') endedAtMs = parsed.endedAt
    }
  } catch {}
  // Fall back to the session row timestamps if the state blob doesn't carry them.
  const startedAt = startedAtMs ? new Date(startedAtMs) : session.createdAt
  const finishedAt = endedAtMs ? new Date(endedAtMs) : session.updatedAt
  const durationSeconds = Math.max(0, Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000))

  // Winner resolution — for Ludo, winnerColor is 'A' (userA) or 'B' (userB).
  let winnerId: string | null = null
  if (winnerColor === 'A') winnerId = match.userAId
  else if (winnerColor === 'B') winnerId = match.userBId
  // If the caller passed a user id directly, prefer that.
  if (winnerColor && winnerColor !== 'A' && winnerColor !== 'B') {
    if (winnerColor === match.userAId || winnerColor === match.userBId) winnerId = winnerColor
  }

  const game = getDatingGame(session.gameType)
  const payload: GameActivityPayload = {
    gameType: session.gameType as any,
    gameName: game?.name ?? session.gameType,
    sessionId: session.id,
    playerAId: match.userAId,
    playerBId: match.userBId,
    winnerId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationSeconds,
  }

  // Idempotency (PRD §57): is there already a game_activity row for this
  // sessionId? Metadata is a JSON string — match it via LIKE on the sessionId
  // field. Cheap because there's at most one game_activity row per session.
  const existing = await db.message.findFirst({
    where: {
      matchId: match.id,
      type: 'game_activity',
      // The metadata column stores JSON; the sessionId is a stable cuid
      // so a substring match is safe.
      metadata: { contains: session.id },
    },
  })
  if (existing) {
    // Already written — just ensure the invitation is COMPLETED.
    const inv = await completeInvitationForSession(session.matchId, session.gameType, session.id)
    return { message: existing, invitation: inv }
  }

  // Insert the single shared message. senderId is the winner (cosmetic —
  // the card renders identically for both sides per PRD §33/§57).
  const message = await db.message.create({
    data: {
      matchId: match.id,
      // Cosmetic: winner first, fall back to userA. The chat renders the
      // card centered (not as a left/right bubble), so senderId does not
      // affect the visual outcome.
      senderId: winnerId ?? match.userAId,
      type: 'game_activity',
      text: null,
      mediaUrl: null,
      metadata: JSON.stringify(payload),
    },
  })
  // Bump lastMessageAt so the conversation jumps to the top of the matches list.
  await db.match.update({ where: { id: match.id }, data: { lastMessageAt: new Date() } })

  const inv = await completeInvitationForSession(session.matchId, session.gameType, session.id)
  return { message, invitation: inv }
}

// Helper — mark the ACCEPTED invitation for this match+game COMPLETED.
async function completeInvitationForSession(matchId: string, gameType: string, sessionId: string) {
  // Find the ACCEPTED invitation for this match+game.
  let inv: any = null
  try {
    inv = await db.gameInvitation.findFirst({
      where: { matchId, gameType, status: 'ACCEPTED' },
    })
  } catch {
    // GameInvitation table may not exist yet on a fresh clone before the
    // first `prisma db push` — silently skip.
    return null
  }
  if (!inv) return null
  const result = await completeInvitation({ invitationId: inv.id, roomId: sessionId })
  return result.invitation
}
