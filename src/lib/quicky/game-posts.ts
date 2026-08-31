// Quicky — game-result post generation
// When a game session ends, a catchy shareable post is generated for BOTH
// players (GamePost rows). Each copy is written from that player's point of
// view. Publishing to the Community happens via the share endpoint; when
// both players share, the two CommunityPosts become mutual (coOwnerId).
import { db } from '@/lib/db'

export type GamePostDraft = {
  userId: string
  gameType: string
  title: string
  body: string
  emoji: string
}

export async function createGamePostsForSession(session: {
  id: string
  matchId: string
  userAId: string
  userBId: string
  gameType: string
  currentTurn: number
  state?: string | null
}, winnerColor: string | null): Promise<Record<string, GamePostDraft>> {
  const names = await db.user.findMany({
    where: { id: { in: [session.userAId, session.userBId] } },
    select: { id: true, name: true },
  })
  const nameOf = (id: string) => names.find((n) => n.id === id)?.name ?? 'Someone'
  const nameA = nameOf(session.userAId)
  const nameB = nameOf(session.userBId)

  const drafts: GamePostDraft[] = []

  if (session.gameType === 'ludo') {
    // Ludo: winner crowns themselves, loser calls for a rematch. A session
    // that ended without a winner (someone left) gets a neutral tease.
    const winnerId = winnerColor === 'A' ? session.userAId : winnerColor === 'B' ? session.userBId : null
    const loserId = winnerId ? (winnerId === session.userAId ? session.userBId : session.userAId) : null
    for (const p of [session.userAId, session.userBId]) {
      if (winnerId && p === winnerId) {
        drafts.push({
          userId: p,
          gameType: 'ludo',
          emoji: '👑',
          title: 'Ludo Legend!',
          body: `Just wiped the board with ${nameOf(loserId!)} on Quicky 🎲 Four tokens home, zero mercy. Rematch if you dare!`,
        })
      } else if (winnerId) {
        drafts.push({
          userId: p,
          gameType: 'ludo',
          emoji: '🎲',
          title: 'So Close…',
          body: `${nameOf(winnerId)} snatched this Ludo match from me at the very last token 😤 The rematch is already loading…`,
        })
      } else {
        drafts.push({
          userId: p,
          gameType: 'ludo',
          emoji: '🎲',
          title: 'Ludo Showdown',
          body: `${nameA} vs ${nameB} — the board is still hot 🔥 Who takes the crown on Quicky?`,
        })
      }
    }
  } else if (session.gameType === 'truth_or_dare') {
    const rounds = Math.max(1, session.currentTurn)
    for (const p of [session.userAId, session.userBId]) {
      const other = p === session.userAId ? nameB : nameA
      drafts.push({
        userId: p,
        gameType: 'truth_or_dare',
        emoji: '🔥',
        title: 'Truth or Dare: No Secrets Left',
        body: `${rounds} round${rounds === 1 ? '' : 's'} of truths & dares with ${other} on Quicky — we said things we can't un-say 😳 Dare us to do it again?`,
      })
    }
  } else if (session.gameType === 'never_have_i_ever') {
    // Count "yes" confessions across the whole session for the hook
    const turns = await db.gameTurn.findMany({
      where: { sessionId: session.id, choice: { not: null } },
      select: { choice: true },
    })
    const yesCount = turns.filter((t) => t.choice === 'yes').length
    for (const p of [session.userAId, session.userBId]) {
      const other = p === session.userAId ? nameB : nameA
      drafts.push({
        userId: p,
        gameType: 'never_have_i_ever',
        emoji: '👀',
        title: 'Never Have I Ever… Behaved',
        body: `${yesCount} guilty confession${yesCount === 1 ? '' : 's'} between me & ${other} this game of Never Have I Ever 😅 Lock up your secrets!`,
      })
    }
  } else {
    return {}
  }

  const out: Record<string, GamePostDraft> = {}
  await Promise.all(
    drafts.map(async (d) => {
      await db.gamePost.upsert({
        where: { sessionId_userId: { sessionId: session.id, userId: d.userId } },
        create: {
          sessionId: session.id,
          userId: d.userId,
          matchId: session.matchId,
          gameType: d.gameType,
          title: d.title,
          body: d.body,
          emoji: d.emoji,
        },
        update: { title: d.title, body: d.body, emoji: d.emoji },
      })
      out[d.userId] = d
    })
  )
  return out
}
