// Quicky — CENTRAL CHEMISTRY SERVICE (Game Hub PRD §16-§23/§73)
//
// Chemistry is calculated ONLY here — never in the frontend (§20 forbids
// frontend-only fake calculations). It combines DATING activity and GAME
// activity (§16: "must not be based only on dating interactions"):
//
//   Dating Activity  +  Game Activity
//          ↓
//   Activity Signals  →  Chemistry Engine  →  Chemistry Score (0-100)
//
// The weights live in ONE config object so they can be tuned later without
// touching call sites (§20). The frontend only ever receives the resulting
// score (+ optional contribution breakdown, §73).
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
    gamesPlayed: { weight: 16, cap: 25 },
    gameMessages: { weight: 8, cap: 80 },
    gifts: { weight: 10, cap: 15 },
    kissPoints: { weight: 10, cap: 100 },
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

export type ChemistryResult = {
  overall: number
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
    gamesPlayed,
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
  const datingContribution =
    contribute(d.likesReceived, likesReceived) +
    contribute(d.likesSent, likesSent) +
    contribute(d.matches, matches) +
    contribute(d.datingMessages, datingMessages)
  const gameContribution =
    contribute(g.gamesPlayed, gamesPlayed?.gamesPlayed ?? 0) +
    contribute(g.gameMessages, gameMessages) +
    contribute(g.gifts, giftsSent + giftsReceived) +
    contribute(g.kissPoints, gamesPlayed?.kissPoints ?? 0) +
    contribute(g.quickyImages, lifetimeImages) +
    contribute(g.streak, streak?.currentStreak ?? 0)

  const overall = Math.min(
    chemistryConfig.maximumScore,
    Math.round(datingContribution + gameContribution),
  )
  return {
    overall,
    datingContribution: Math.round(datingContribution),
    gameContribution: Math.round(gameContribution),
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
