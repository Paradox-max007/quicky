// Quicky — desktop dashboard (Desktop UI concept §11/§17/§18/§22/§44)
// GET /api/quicky/dashboard
//
// ONE read-only endpoint feeds the desktop command center: My Quicky
// progression stats, recent social activity and the "What's Happening Now"
// live-world numbers. Every value is a REAL database read — the concept doc
// forbids fake precision (§9) and empty stat cards (§48), so anything without
// a backend source is simply omitted and the UI turns 0s into actions.
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { computeOverallChemistry } from '@/lib/quicky/chemistry'

const ONLINE_WINDOW_MS = 5 * 60 * 1000

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const uid = me.id
  // Economy fields live on the full User row (AuthUser stays a narrow type)
  const econ = await db.user.findUnique({
    where: { id: uid },
    select: { quickyScore: true, coinBalance: true, kissPoints: true },
  })
  const now = new Date()
  const onlineSince = new Date(now.getTime() - ONLINE_WINDOW_MS)
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  const [
    streak,
    likesReceived,
    likesSent,
    matchesCount,
    gamesPlayed,
    giftsSent,
    giftsReceived,
    leagues,
    onlineNow,
    postsToday,
    roomsActive,
    roomPlayers,
    activeGames,
    likeRows,
    matchRows,
    giftRows,
    kissRows,
    myMatchIds,
  ] = await Promise.all([
    db.gameQuickyStreak.findUnique({ where: { userId: uid } }),
    db.swipe.count({ where: { toUserId: uid, type: { in: ['like', 'superlike'] } } }),
    db.swipe.count({ where: { fromUserId: uid, type: { in: ['like', 'superlike'] } } }),
    db.match.count({ where: { OR: [{ userAId: uid }, { userBId: uid }], status: 'active' } }),
    db.gameSession.count({ where: { OR: [{ userAId: uid }, { userBId: uid }] } }),
    db.spinRoomGift.count({ where: { senderId: uid } }),
    db.spinRoomGift.count({ where: { recipientId: uid } }),
    db.gameLeague.findMany({ where: { isActive: true }, orderBy: { minimumPoints: 'asc' } }),
    db.user.count({ where: { lastActiveAt: { gte: onlineSince } } }),
    db.communityPost.count({ where: { createdAt: { gte: dayAgo } } }),
    db.spinRoom.count({ where: { status: { in: ['WAITING', 'STARTING', 'PLAYING'] } } }),
    db.spinRoomPlayer.count({
      where: { isActive: true, leftAt: null, room: { status: { in: ['WAITING', 'STARTING', 'PLAYING'] } } },
    }),
    db.gameSession.count({ where: { status: 'active', OR: [{ userAId: uid }, { userBId: uid }] } }),
    // ─── Recent activity candidates (latest 5/3/3/3 per kind) ───────────────
    db.swipe.findMany({
      where: { toUserId: uid, type: { in: ['like', 'superlike'] } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: {
        fromUser: { select: { id: true, name: true, photos: { orderBy: { position: 'asc' }, take: 1, select: { url: true } } } },
      },
    }),
    db.match.findMany({
      where: { OR: [{ userAId: uid }, { userBId: uid }], status: 'active' },
      orderBy: { createdAt: 'desc' },
      take: 3,
      include: {
        userA: { select: { id: true, name: true, photos: { orderBy: { position: 'asc' }, take: 1, select: { url: true } } } },
        userB: { select: { id: true, name: true, photos: { orderBy: { position: 'asc' }, take: 1, select: { url: true } } } },
      },
    }),
    db.spinRoomGift.findMany({
      where: { recipientId: uid },
      orderBy: { createdAt: 'desc' },
      take: 3,
      include: {
        sender: { select: { id: true, name: true, photos: { orderBy: { position: 'asc' }, take: 1, select: { url: true } } } },
        item: { select: { name: true, emoji: true } },
      },
    }),
    db.kissPointTransaction.findMany({
      where: { toUserId: uid },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { id: true, fromUserId: true, points: true, createdAt: true },
    }),
    db.match.findMany({
      where: { OR: [{ userAId: uid }, { userBId: uid }], status: 'active' },
      select: { id: true },
    }),
  ])

  // Latest incoming dating messages (recent-message activity rows)
  const messageRows = myMatchIds.length
    ? await db.message.findMany({
        where: { matchId: { in: myMatchIds.map((m) => m.id) }, senderId: { not: uid }, type: { in: ['text', 'image', 'video', 'quicky'] } },
        orderBy: { createdAt: 'desc' },
        take: 3,
        include: { sender: { select: { id: true, name: true, photos: { orderBy: { position: 'asc' }, take: 1, select: { url: true } } } } },
      })
    : []

  // Kiss transactions have no fromUser relation — resolve actor names manually
  const kissFromIds = kissRows.map((k) => k.fromUserId).filter((v): v is string => !!v)
  const kissActors = kissFromIds.length
    ? await db.user.findMany({
        where: { id: { in: kissFromIds } },
        select: { id: true, name: true, photos: { orderBy: { position: 'asc' }, take: 1, select: { url: true } } },
      })
    : []
  const actorById = new Map(kissActors.map((u) => [u.id, u]))

  // ─── Merge into one feed (newest first, cap 8) ────────────────────────────
  type ActivityItem = {
    id: string
    kind: 'like' | 'match' | 'kiss' | 'gift' | 'message'
    text: string
    actorName: string | null
    actorPhoto: string | null
    createdAt: string
  }
  const activity: ActivityItem[] = []

  for (const s of likeRows) {
    activity.push({
      id: `like-${s.id}`,
      kind: 'like',
      text: s.type === 'superlike' ? `${s.fromUser.name ?? 'Someone'} super-liked you` : `${s.fromUser.name ?? 'Someone'} liked you`,
      actorName: s.fromUser.name ?? null,
      actorPhoto: s.fromUser.photos[0]?.url ?? null,
      createdAt: s.createdAt.toISOString(),
    })
  }
  for (const m of matchRows) {
    const partner = m.userAId === uid ? m.userB : m.userA
    activity.push({
      id: `match-${m.id}`,
      kind: 'match',
      text: `You matched with ${partner.name ?? 'someone'}`,
      actorName: partner.name ?? null,
      actorPhoto: partner.photos[0]?.url ?? null,
      createdAt: m.createdAt.toISOString(),
    })
  }
  for (const g of giftRows) {
    activity.push({
      id: `gift-${g.id}`,
      kind: 'gift',
      text: `${g.sender.name ?? 'Someone'} sent you a ${g.item.emoji ?? '🎁'} ${g.item.name}`.trim(),
      actorName: g.sender.name ?? null,
      actorPhoto: g.sender.photos[0]?.url ?? null,
      createdAt: g.createdAt.toISOString(),
    })
  }
  for (const k of kissRows) {
    const actor = k.fromUserId ? actorById.get(k.fromUserId) : null
    activity.push({
      id: `kiss-${k.id}`,
      kind: 'kiss',
      text: actor ? `${actor.name ?? 'Someone'} gave you a Game Point` : `You received ${k.points} Game Point${k.points === 1 ? '' : 's'}`,
      actorName: actor?.name ?? null,
      actorPhoto: actor?.photos[0]?.url ?? null,
      createdAt: k.createdAt.toISOString(),
    })
  }
  for (const msg of messageRows) {
    activity.push({
      id: `message-${msg.id}`,
      kind: 'message',
      text: `New message from ${msg.sender.name ?? 'someone'}`,
      actorName: msg.sender.name ?? null,
      actorPhoto: msg.sender.photos[0]?.url ?? null,
      createdAt: msg.createdAt.toISOString(),
    })
  }
  activity.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  const recentActivity = activity.slice(0, 8)

  // Chemistry: the CENTRAL engine (Game Hub PRD §16/§20) — one server-side
  // 0-100 score from dating + game signals (30-day window). Never fabricated
  // client-side (§20).
  let chemistryOverall = 0
  let chemistryBreakdown: {
    dating: { score: number; activityCount: number }
    games: { score: number; activityCount: number }
    social: { score: number; activityCount: number }
  } | null = null
  try {
    const chem = await computeOverallChemistry(uid)
    chemistryOverall = chem.overall
    chemistryBreakdown = { dating: chem.dating, games: chem.games, social: chem.social }
  } catch {
    chemistryOverall = 0
  }

  // ─── League from real GameLeague tiers (no fabricated names, §9) ─────────
  let league: { name: string; minimumPoints: number; nextName: string | null; nextMinimumPoints: number | null } | null = null
  if (leagues.length > 0) {
    const score = econ?.quickyScore ?? 0
    const current = [...leagues].reverse().find((l) => l.minimumPoints <= score) ?? null
    const next = leagues.find((l) => l.minimumPoints > score) ?? null
    if (current || next) {
      league = {
        name: current?.name ?? next!.name,
        minimumPoints: current?.minimumPoints ?? next!.minimumPoints,
        nextName: next?.name ?? null,
        nextMinimumPoints: next?.minimumPoints ?? null,
      }
    }
  }

  return NextResponse.json({
    stats: {
      points: econ?.quickyScore ?? 0,
      coins: econ?.coinBalance ?? 0,
      kisses: econ?.kissPoints ?? 0,
      likesReceived,
      likesSent,
      matches: matchesCount,
      gamesPlayed,
      giftsSent,
      giftsReceived,
      streak: streak ? { current: streak.currentStreak, longest: streak.longestStreak } : null,
      league,
      chemistry: chemistryOverall,
      chemistryBreakdown,
    },
    activity: recentActivity,
    live: {
      rooms: roomsActive,
      players: roomPlayers,
      activeGames,
      online: onlineNow,
      postsToday,
    },
  })
}
