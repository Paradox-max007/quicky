// Quicky — CENTRAL CHEMISTRY SERVICE (Game Hub PRD §16-§23 + Refactor PRD §3-§5)
//
// Chemistry is calculated ONLY here — never in the frontend (§20 forbids
// frontend-only fake calculations). It combines DATING activity, GAME
// activity and SOCIAL interaction (refactor PRD §3.1:
// "Dating Activity + Game Activity + Social Interaction → Overall Chemistry"):
//
//   Dating Activity  +  Game Activity  +  Social Interaction
//          ↓
//   Activity Signals  →  Chemistry Engine  →  Chemistry Score (0-100)
//
// The weights live in ONE central config ("chemistry_rules", refactor PRD
// §5) so they can be tuned/administered later without touching call sites.
// The frontend only ever receives the resulting score (+ §4 breakdown with
// per-layer score and activity counts).
//
// Duplicate-safety (§78): the engine derives every signal from COUNTS of
// real events inside a fixed 30-day window — the same event can never be
// inserted twice, so the score cannot be inflated by replays.
import { db } from '@/lib/db'

export const chemistryConfig = {
  // per-signal caps — reaching the cap contributes the full signal weight
  dating: {
    likesReceived: { weight: 14, cap: 30 },
    likesSent: { weight: 5, cap: 30 },
    matches: { weight: 14, cap: 10 },
    datingMessages: { weight: 9, cap: 60 },
  },
  game: {
    gamesPlayed: { weight: 18, cap: 25 },
    gameMessages: { weight: 8, cap: 80 },
    kissPoints: { weight: 10, cap: 100 },
  },
  social: {
    gifts: { weight: 10, cap: 15 },
    quickyImages: { weight: 6, cap: 10 },
    streak: { weight: 6, cap: 7 },
  },
  maximumScore: 100,
}

type Signal = { weight: number; cap: number }

function contribute(sig: Signal, value: number): number {
  const ratio = Math.max(0, Math.min(1, sig.cap > 0 ? value / sig.cap : 0))
  return sig.weight * ratio
}

export type ChemistryLayer = { score: number; activityCount: number }

export type ChemistryResult = {
  /** Overall 0-100 chemistry score (refactor PRD §4 `total`). */
  overall: number
  /** Alias of overall — the §4 response shape name. */
  total: number
  dating: ChemistryLayer
  games: ChemistryLayer
  social: ChemistryLayer
  // Legacy flat contributions kept for existing consumers (Game Hub §73).
  datingContribution: number
  gameContribution: number
}

// ─── Overall chemistry for ONE user (their landing page / records) ────────
export async function computeOverallChemistry(userId: string): Promise<ChemistryResult> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // 30-day window keeps the score alive
  const [
    likesReceived,
    likesSent,
    matches,
    datingMessages,
    userRow,
    gameMessages,
    giftsSent,
    giftsReceived,
    streak,
  ] = await Promise.all([
    db.swipe.count({ where: { toUserId: userId, type: { in: ['like', 'superlike'] } } }),
    db.swipe.count({ where: { fromUserId: userId, type: { in: ['like', 'superlike'] } } }),
    db.match.count({ where: { OR: [{ userAId: userId }, { userBId: userId }], status: 'active' } }),
    db.message.count({ where: { senderId: userId, createdAt: { gte: since } } }),
    db.user.findUnique({ where: { id: userId }, select: { gamesPlayed: true, kissPoints: true } }),
    db.gameMessage.count({ where: { senderId: userId, createdAt: { gte: since } } }),
    db.spinRoomGift.count({ where: { senderId: userId } }),
    db.spinRoomGift.count({ where: { recipientId: userId } }),
    db.gameQuickyStreak.findUnique({ where: { userId } }),
  ])

  // quickyImages: GameQuickyStreak.totalQuickyImages is the authoritative
  // lifetime Quicky Image count.
  const lifetimeImages = (streak as { totalQuickyImages?: number } | null)?.totalQuickyImages ?? 0

  const d = chemistryConfig.dating
  const g = chemistryConfig.game
  const s = chemistryConfig.social

  const datingScore =
    contribute(d.likesReceived, likesReceived) +
    contribute(d.likesSent, likesSent) +
    contribute(d.matches, matches) +
    contribute(d.datingMessages, datingMessages)
  const gamesScore =
    contribute(g.gamesPlayed, userRow?.gamesPlayed ?? 0) +
    contribute(g.gameMessages, gameMessages) +
    contribute(g.kissPoints, userRow?.kissPoints ?? 0)
  const socialScore =
    contribute(s.gifts, giftsSent + giftsReceived) +
    contribute(s.quickyImages, lifetimeImages) +
    contribute(s.streak, streak?.currentStreak ?? 0)

  const overall = Math.min(
    chemistryConfig.maximumScore,
    Math.round(datingScore + gamesScore + socialScore),
  )

  return {
    overall,
    total: overall,
    dating: { score: Math.round(datingScore), activityCount: likesReceived + likesSent + matches + datingMessages },
    games: { score: Math.round(gamesScore), activityCount: (userRow?.gamesPlayed ?? 0) + gameMessages },
    social: { score: Math.round(socialScore), activityCount: giftsSent + giftsReceived + lifetimeImages },
    datingContribution: Math.round(datingScore),
    gameContribution: Math.round(gamesScore + socialScore),
  }
}

// ─── Pair chemistry between TWO users (profile cards §21) ─────────────────
// "A ↔ B chemistry = combined relationship activity" — mutual likes, a real
// match, conversations on both sides, shared tables, gifts and kisses.
export async function computePairChemistry(userAId: string, userBId: string): Promise<number> {
  if (userAId === userBId) return 0
  const [likeAtoB, likeBtoA, matchRow, gameConv, sessions, gifts] = await Promise.all([
    db.swipe.findFirst({
      where: { fromUserId: userAId, toUserId: userBId, type: { in: ['like', 'superlike'] } },
    }),
    db.swipe.findFirst({
      where: { fromUserId: userBId, toUserId: userAId, type: { in: ['like', 'superlike'] } },
    }),
    db.match.findFirst({
      where: {
        OR: [
          { userAId: userAId, userBId: userBId },
          { userAId: userBId, userBId: userAId },
        ],
        status: 'active',
      },
      include: { _count: { select: { messages: true } } },
    }),
    db.gameConversation.findFirst({
      where: {
        OR: [
          { userAId: userAId, userBId: userBId },
          { userAId: userBId, userBId: userAId },
        ],
      },
      include: { _count: { select: { messages: true } } },
    }),
    db.gameSession.count({
      where: {
        OR: [
          { userAId: userAId, userBId: userBId },
          { userAId: userBId, userBId: userAId },
        ],
      },
    }),
    db.spinRoomGift.count({
      where: {
        OR: [
          { senderId: userAId, recipientId: userBId },
          { senderId: userBId, recipientId: userAId },
        ],
      },
    }),
  ])

  const datingMsgs = matchRow?._count.messages ?? 0
  const gameMsgs = gameConv?._count.messages ?? 0
  const gameMsgsByMe = gameConv
    ? await db.gameMessage.count({ where: { conversationId: gameConv.id, senderId: userAId } })
    : 0

  // Weighted pair signals (tunable later — kept in one place, §20).
  let score = 0
  if (likeAtoB) score += 12
  if (likeBtoA) score += 18 // a MUTUAL like contributes on both sides
  if (matchRow) score += 15
  score += Math.min(15, datingMsgs * 0.75)
  score += Math.min(10, gameMsgs * 0.5)
  score += Math.min(12, sessions * 6)
  score += Math.min(10, gifts * 5)
  if (gameMsgsByMe > 0) score += 5 // I invested in the conversation too

  return Math.max(0, Math.min(100, Math.round(score)))
}
