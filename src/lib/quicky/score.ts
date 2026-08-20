// Quicky — score & streak logic (PRD §8.2)
import { db } from '@/lib/db'
import { QUICKY } from './constants'

/**
 * Award Quicky Score points to a user.
 * Idempotent-ish: also records a QuickyEvent so we can dedupe later if needed.
 */
export async function awardQuickyScore(opts: {
  senderId: string
  recipientId: string
  eventType: 'sent' | 'opened' | 'replay' | 'screenshot' | 'streak_milestone'
  messageId?: string
}): Promise<{ points: number; newScore: number }> {
  const pointsMap = {
    sent: QUICKY.score.sent,
    opened: QUICKY.score.opened,
    replay: 0,
    screenshot: 0,
    streak_milestone: 0, // handled separately
  } as const
  const points = pointsMap[opts.eventType] ?? 0

  // Create the event record
  await db.quickyEvent.create({
    data: {
      senderId: opts.senderId,
      recipientId: opts.recipientId,
      messageId: opts.messageId,
      eventType: opts.eventType,
      pointsAwarded: points,
    },
  })

  if (points > 0) {
    // Update recipient (opened) or sender (sent) — convention: the user whose score changes
    // For 'sent' it's the sender's score; for 'opened' it's the recipient's score
    const userId = opts.eventType === 'sent' ? opts.senderId : opts.recipientId
    const updated = await db.user.update({
      where: { id: userId },
      data: { quickyScore: { increment: points } },
    })
    return { points, newScore: updated.quickyScore }
  }
  const u = await db.user.findUnique({ where: { id: opts.senderId } })
  return { points: 0, newScore: u?.quickyScore ?? 0 }
}

/**
 * Compute Quicky streak between two matched users.
 * A "Quicky streak" = consecutive days where both users sent at least one
 * Quicky to each other (PRD §8.2 — "3-day Quicky streak with the same match").
 *
 * Returns: { streakDays: number, brokeStreakToday: boolean, milestoneAwarded: number | null }
 */
export async function computeStreak(matchId: string, userAId: string, userBId: string): Promise<{
  streakDays: number
  brokeStreakToday: boolean
  milestoneAwarded: number | null
}> {
  // Find all quicky messages in this match, grouped by UTC day for each sender
  const messages = await db.message.findMany({
    where: {
      matchId,
      type: 'quicky',
    },
    orderBy: { createdAt: 'asc' },
  })

  // Build a map: day-string -> set of senderIds who sent
  const dayMap = new Map<string, Set<string>>()
  for (const m of messages) {
    const day = m.createdAt.toISOString().slice(0, 10)
    if (!dayMap.has(day)) dayMap.set(day, new Set())
    dayMap.get(day)!.add(m.senderId)
  }

  // A "valid" streak day = both users sent at least once
  const validDays: string[] = []
  for (const [day, senders] of dayMap) {
    if (senders.has(userAId) && senders.has(userBId)) {
      validDays.push(day)
    }
  }
  validDays.sort()

  // Compute consecutive days ending today or yesterday
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  let streak = 0
  let brokeStreakToday = false

  if (validDays.length === 0) {
    return { streakDays: 0, brokeStreakToday: false, milestoneAwarded: null }
  }

  const last = validDays[validDays.length - 1]
  if (last === today || last === yesterday) {
    // Walk backwards through validDays
    let cursor = new Date(last + 'T00:00:00Z')
    for (let i = validDays.length - 1; i >= 0; i--) {
      const day = validDays[i]
      const dayDate = new Date(day + 'T00:00:00Z')
      const diff = Math.round((cursor.getTime() - dayDate.getTime()) / 86400000)
      if (diff === 0) {
        streak++
        cursor = new Date(cursor.getTime() - 86400000)
      } else {
        break
      }
    }
    // If today is not a valid day but yesterday is, today didn't break the streak yet
    brokeStreakToday = !dayMap.get(today)?.has(userAId) || !dayMap.get(today)?.has(userBId)
    // ^ only true if at least one quicky was sent today but not by both
    if (!dayMap.has(today)) brokeStreakToday = false
  }

  // Award milestone points
  let milestoneAwarded: number | null = null
  if (streak === 3) milestoneAwarded = QUICKY.score.streak3Day
  else if (streak === 7) milestoneAwarded = QUICKY.score.streak7Day
  // Also check 14, 21, 30 (every 7 days after the first 7)
  else if (streak > 7 && streak % 7 === 0) milestoneAwarded = QUICKY.score.streak7Day

  if (milestoneAwarded) {
    // Award to BOTH users
    await db.user.updateMany({
      where: { id: { in: [userAId, userBId] } },
      data: { quickyScore: { increment: milestoneAwarded } },
    })
    // Record events for both
    await db.quickyEvent.create({
      data: {
        senderId: userAId,
        recipientId: userBId,
        eventType: 'streak_milestone',
        pointsAwarded: milestoneAwarded,
      },
    })
  }

  return { streakDays: streak, brokeStreakToday, milestoneAwarded }
}
