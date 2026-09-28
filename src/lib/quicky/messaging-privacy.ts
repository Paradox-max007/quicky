// Quicky — Messaging Permission Service (Premium Party Games PRD §18-§21)
//
// Central, server-side authority for "is sender A allowed to send a NEW
// message to recipient B?". All three messaging surfaces (dating-chat
// `matches/[matchId]/messages`, `dm`, game-chat `game-chat/messages`) call
// into `canMessage()` so the rule is enforced from one place (PRD §21 —
// "Do not duplicate these rules across chat UI, API, notification,
// search results, profile, realtime messaging").
//
// Rules (PRD §18, §19, §20):
//   1. Authentication — both users must exist + be the authenticated
//      principal (sender = the caller).
//   2. Block status — either direction blocked → DENY.
//   3. Recipient's `allowAnyoneMessage` setting:
//        • TRUE  → anyone with a Match can message. (Default.)
//        • FALSE → only Friends OR Connections (mutual Match) may message.
//      Existing conversations are NOT disrupted — the gate fires only when
//      there is no prior Message row in the conversation. (PRD §20.)
//   4. Premium status does NOT bypass the recipient's privacy setting
//      (PRD §19). A Premium user who turned off `allowAnyoneMessage` is
//      unreachable by non-friends/non-matches, full stop.
//
// Return shape: `{ allowed: boolean; reason?: string }`. `reason` is set
// when `allowed === false` so the caller can map it to a precise error
// response (403 + the right code).

import { db } from '@/lib/db'

export type CanMessageResult = {
  allowed: boolean
  reason?:
    | 'blocked'              // either side blocked the other
    | 'recipient_privacy'    // recipient's allowAnyoneMessage = false + no friendship/match
    | 'no_match'             // dm route only — no Match row exists between the two
    | 'unauthenticated'
}

// ── Relationship primitives (PRD §21 — DRY helpers) ────────────────────────
//
// The codebase inlined these queries in 5+ places; centralizing them here
// keeps the messaging gate and the existing callers (community-server.ts,
// relationship route, friends route) consistent. Each helper is a single
// cheap Prisma query.

export async function areBlockedEitherDirection(a: string, b: string): Promise<boolean> {
  const row = await db.block.findFirst({
    where: {
      OR: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    },
    select: { id: true },
  })
  return !!row
}

export async function areFriends(a: string, b: string): Promise<boolean> {
  if (a === b) return true // defensive — self is trivially a "friend" of self
  const row = await db.friendship.findFirst({
    where: {
      OR: [
        { requesterId: a, addresseeId: b },
        { requesterId: b, addresseeId: a },
      ],
    },
    select: { id: true },
  })
  return !!row
}

export async function haveMatch(a: string, b: string): Promise<boolean> {
  if (a === b) return false
  const row = await db.match.findFirst({
    where: {
      status: 'active',
      OR: [
        { userAId: a, userBId: b },
        { userAId: b, userBId: a },
      ],
    },
    select: { id: true },
  })
  return !!row
}

// ── Existing conversation check (PRD §20) ────────────────────────────────────
//
// "Existing" = there is at least one Message row in the match conversation
// already. The gate is on INITIATING a new conversation, not on continuing
// an existing one. (The dm route has no match-conversation concept — every
// dm IS an initiation, so this check is match-scoped only.)
export async function hasExistingConversation(matchId: string): Promise<boolean> {
  const count = await db.message.count({
    where: { matchId },
    take: 1, // we only need to know if any row exists; capped at 1 for speed
  })
  return count > 0
}

// ── The single entry point: canMessage() (PRD §21) ─────────────────────────
//
// Callers pass the matchId (for dating-chat) OR the two user ids (for dm).
// The function loads the recipient's UserSettings (defaulted to
// allowAnyoneMessage=true if the settings row doesn't exist yet) and
// applies the rules in order.
//
// `opts.conversationKey`:
//   • 'match' — the conversation is the dating Match. Existing-conversation
//     check applies (PRD §20).
//   • 'dm'    — the dm flow. There is no Match required for DMs in this
//     app; if you want dm to require a Match, set `requireMatch: true`.
export async function canMessage(opts: {
  senderId: string
  recipientId: string
  matchId?: string
  conversationKey?: 'match' | 'dm'
  requireMatch?: boolean
}): Promise<CanMessageResult> {
  const { senderId, recipientId, matchId, conversationKey = 'match', requireMatch = false } = opts
  if (!senderId || !recipientId) {
    return { allowed: false, reason: 'unauthenticated' }
  }
  if (senderId === recipientId) {
    // Self-message — allow (defensive; UI normally prevents this).
    return { allowed: true }
  }

  // 1. Block check (both directions).
  if (await areBlockedEitherDirection(senderId, recipientId)) {
    return { allowed: false, reason: 'blocked' }
  }

  // 2. DM route — optionally require a Match to exist (PRD §18 talks about
  //    messaging in general; the dm route is the cold-start path).
  if (conversationKey === 'dm' && requireMatch) {
    if (!(await haveMatch(senderId, recipientId))) {
      return { allowed: false, reason: 'no_match' }
    }
  }

  // 3. Recipient's privacy setting. Default to `true` (anyone) if the
  //    UserSettings row is missing — the column default is `true`.
  const recipientSettings = await db.userSettings.findUnique({
    where: { userId: recipientId },
    select: { allowAnyoneMessage: true },
  })
  const allowAnyone = recipientSettings?.allowAnyoneMessage ?? true

  if (allowAnyone) {
    // Anyone with a Match can message — but for the dating-chat surface,
    // the matchId already proves both users are matched (the route
    // verifies that earlier). For dm, the Match requirement is opt-in.
    return { allowed: true }
  }

  // 4. Recipient has `allowAnyoneMessage = false` — only Friends OR
  //    Connections (mutual Match) may message. PRD §18.
  //
  // Existing conversations are NOT disrupted (PRD §20) — if there is at
  // least one Message row already in this match, the conversation is
  // grandfathered in and the gate is skipped.
  if (matchId && (await hasExistingConversation(matchId))) {
    return { allowed: true }
  }

  if (await areFriends(senderId, recipientId)) {
    return { allowed: true }
  }
  if (await haveMatch(senderId, recipientId)) {
    return { allowed: true }
  }

  return { allowed: false, reason: 'recipient_privacy' }
}
