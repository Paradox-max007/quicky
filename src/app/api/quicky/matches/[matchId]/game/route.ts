// Quicky — Truth or Dare (free) + Never Have I Ever (Premium×2)
// POST  /api/quicky/matches/[matchId]/game  { gameType } -> start session
// GET   /api/quicky/matches/[matchId]/game  -> current session state
// PATCH /api/quicky/matches/[matchId]/game  -> actions (per game type)
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { TOD_DECKS, NHIE_STATEMENTS } from '@/lib/quicky/constants'

const GAME_TYPES = ['truth_or_dare', 'never_have_i_ever']

export async function GET(req: NextRequest, ctx: { params: Promise<{ matchId: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { matchId } = await ctx.params

  const match = await db.match.findUnique({ where: { id: matchId } })
  if (!match || (match.userAId !== me.id && match.userBId !== me.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const session = await db.gameSession.findFirst({
    where: { matchId, status: 'active', gameType: { in: GAME_TYPES } },
    include: { turns: { orderBy: { createdAt: 'asc' } } },
  })

  if (!session) {
    return NextResponse.json({ session: null })
  }

  const partnerId = match.userAId === me.id ? match.userBId : match.userAId

  const base = {
    id: session.id,
    gameType: session.gameType,
    currentTurn: session.currentTurn,
    currentPlayerId: session.currentPlayerId,
    isMyTurn: session.currentPlayerId === me.id,
    partnerId,
    turns: session.turns.map((t) => ({
      id: t.id,
      playerId: t.playerId,
      promptDeck: t.promptDeck,
      promptText: t.promptText,
      choice: t.choice,
      answerText: t.answerText,
      answerMediaUrl: t.answerMediaUrl,
      skipped: t.skipped,
      createdAt: t.createdAt,
    })),
  }

  // For NHIE include the deterministic statement of the active round
  if (session.gameType === 'never_have_i_ever') {
    return NextResponse.json({
      session: {
        ...base,
        roundStatement: nhieStatement(session.id, session.currentTurn),
        iAnswered: session.turns.some((t) => t.playerId === me.id && t.promptDeck === `round:${session.currentTurn}`),
        partnerAnswered: session.turns.some((t) => t.playerId !== me.id && t.promptDeck === `round:${session.currentTurn}`),
      },
    })
  }

  return NextResponse.json({ session: base })
}

// Deterministic statement for a given session + round so both clients always
// draw the exact same prompt without extra server round-trips.
function nhieStatement(sessionId: string, round: number): string {
  let h = round * 2654435761
  for (let i = 0; i < sessionId.length; i++) {
    h = (h ^ sessionId.charCodeAt(i)) >>> 0
    h = Math.imul(h, 16777619) >>> 0
  }
  h += (round * 97531 + 7) % 100003
  const idx = ((h % NHIE_STATEMENTS.length) + NHIE_STATEMENTS.length) % NHIE_STATEMENTS.length
  return NHIE_STATEMENTS[idx]
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ matchId: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { matchId } = await ctx.params

  const match = await db.match.findUnique({ where: { id: matchId } })
  if (!match || (match.userAId !== me.id && match.userBId !== me.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (match.status !== 'active') return NextResponse.json({ error: 'Unmatched' }, { status: 410 })

  const body = await req.json()
  const gameType = String(body.gameType ?? 'truth_or_dare')
  if (!GAME_TYPES.includes(gameType)) {
    return NextResponse.json({ error: 'Unknown game type' }, { status: 400 })
  }

  // Premium gate for Never Have I Ever (PRD §8: both players must have active Premium)
  if (gameType === 'never_have_i_ever') {
    if (!me.isPremium) {
      return NextResponse.json({ error: 'premium_required', paywall: 'games' }, { status: 402 })
    }
    const partnerId = match.userAId === me.id ? match.userBId : match.userAId
    const partner = await db.user.findUnique({
      where: { id: partnerId },
      select: { isPremium: true, premiumUntil: true },
    })
    if (!partner?.isPremium || (partner.premiumUntil && partner.premiumUntil < new Date())) {
      return NextResponse.json(
        { error: 'partner_premium_required', message: 'They need Premium too to play Never Have I Ever.' },
        { status: 402 }
      )
    }
  }

  // Check if there's already an active session
  const existing = await db.gameSession.findFirst({
    where: { matchId, status: 'active', gameType },
  })
  if (existing) {
    return NextResponse.json({ ok: true, session: { id: existing.id, alreadyActive: true } })
  }

  const partnerId = match.userAId === me.id ? match.userBId : match.userAId

  // Start session — current player is me (I initiated)
  const session = await db.gameSession.create({
    data: {
      matchId,
      userAId: match.userAId,
      userBId: match.userBId,
      gameType,
      status: 'active',
      currentTurn: 1,
      currentPlayerId: me.id,
    },
  })

  if (gameType === 'never_have_i_ever') {
    return NextResponse.json({
      ok: true,
      session: {
        id: session.id,
        gameType,
        currentTurn: session.currentTurn,
        currentPlayerId: session.currentPlayerId,
        partnerId,
        roundStatement: nhieStatement(session.id, session.currentTurn),
        iAnswered: false,
        partnerAnswered: false,
        turns: [],
      },
    })
  }

  return NextResponse.json({
    ok: true,
    session: {
      id: session.id,
      gameType: session.gameType,
      currentTurn: session.currentTurn,
      currentPlayerId: session.currentPlayerId,
      isMyTurn: true,
      partnerId,
      // The current player picks Truth or Dare for themselves
      step: 'pick_truth_or_dare',
      turns: [],
    },
  })
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ matchId: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { matchId } = await ctx.params

  const match = await db.match.findUnique({ where: { id: matchId } })
  if (!match || (match.userAId !== me.id && match.userBId !== me.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await req.json()
  const sessionId = String(body.sessionId ?? '')
  const action = String(body.action ?? '') as 'truth' | 'dare' | 'skip' | 'answer' | 'next_round'
  const answerText = body.answerText ? String(body.answerText) : null
  const answerMediaUrl = body.answerMediaUrl ? String(body.answerMediaUrl) : null

  const session = await db.gameSession.findUnique({
    where: { id: sessionId },
    include: { turns: true },
  })
  if (!session || session.matchId !== matchId || session.status !== 'active') {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  // ── Never Have I Ever actions — both players act every round, no turn owner
  if (session.gameType === 'never_have_i_ever') {
    const round = session.currentTurn
    const partnerId = match.userAId === me.id ? match.userBId : match.userAId

    if (action === 'answer') {
      const choice = String((body as any).choice ?? '') as 'yes' | 'no'
      if (!['yes', 'no'].includes(choice)) {
        return NextResponse.json({ error: 'choice must be yes|no' }, { status: 400 })
      }
      const existing = await db.gameTurn.findFirst({
        where: { sessionId: session.id, playerId: me.id, promptDeck: `round:${round}` },
      })
      if (existing) return NextResponse.json({ error: 'Already answered this round' }, { status: 400 })
      const turn = await db.gameTurn.create({
        data: { sessionId: session.id, playerId: me.id, promptDeck: `round:${round}`, promptText: nhieStatement(session.id, round), choice },
      })
      const partnerTurn = await db.gameTurn.findFirst({
        where: { sessionId: session.id, playerId: partnerId, promptDeck: `round:${round}` },
      })
      // Simultaneous reveal: partner's answer only appears once they locked in
      return NextResponse.json({
        ok: true,
        answered: true,
        reveal: !!partnerTurn,
        myChoice: choice,
        partnerChoice: partnerTurn?.choice ?? null,
      })
    }

    if (action === 'next_round') {
      const mine = await db.gameTurn.findFirst({
        where: { sessionId: session.id, playerId: me.id, promptDeck: `round:${round}` },
      })
      const theirs = await db.gameTurn.findFirst({
        where: { sessionId: session.id, playerId: partnerId, promptDeck: `round:${round}` },
      })
      if (!mine || !theirs) return NextResponse.json({ error: 'Both players must answer first' }, { status: 400 })
      const updated = await db.gameSession.updateMany({
        where: { id: session.id, currentTurn: round }, // guard against double-advance race
        data: { currentTurn: round + 1, currentPlayerId: match.userAId },
      })
      if (updated.count === 0) {
        // Someone else already advanced — just return fresh state
      }
      return NextResponse.json({
        ok: true,
        round: round + 1,
        roundStatement: nhieStatement(session.id, round + 1),
        iAnswered: false,
        partnerAnswered: false,
      })
    }

    return NextResponse.json({ error: 'Invalid action for never_have_i_ever' }, { status: 400 })
  }

  // ── Truth or Dare actions (turn-based) ──────────────────────────────────

  // Validate current player
  if (session.currentPlayerId !== me.id) {
    return NextResponse.json({ error: 'Not your turn' }, { status: 400 })
  }

  const partnerId = match.userAId === me.id ? match.userBId : match.userAId
  const lastTurn = session.turns[session.turns.length - 1]

  if (action === 'truth' || action === 'dare') {
    // Pick a random prompt from the deck
    const deck = TOD_DECKS[action]
    const used = new Set(session.turns.filter((t) => t.choice === action).map((t) => t.promptText))
    const available = deck.filter((p) => !used.has(p.text))
    const pool = available.length > 0 ? available : deck
    const pick = pool[Math.floor(Math.random() * pool.length)]

    const turn = await db.gameTurn.create({
      data: {
        sessionId: session.id,
        playerId: me.id,
        promptDeck: pick.deck,
        promptText: pick.text,
        choice: action,
      },
    })

    return NextResponse.json({
      ok: true,
      turn: {
        id: turn.id,
        playerId: turn.playerId,
        promptDeck: turn.promptDeck,
        promptText: turn.promptText,
        choice: turn.choice,
      },
      step: 'answer',
    })
  }

  if (action === 'skip') {
    if (!lastTurn) return NextResponse.json({ error: 'No turn to skip' }, { status: 400 })
    await db.gameTurn.update({
      where: { id: lastTurn.id },
      data: { skipped: true },
    })
    // Pass turn to partner
    const updated = await db.gameSession.update({
      where: { id: session.id },
      data: {
        currentTurn: session.currentTurn + 1,
        currentPlayerId: partnerId,
      },
    })
    return NextResponse.json({
      ok: true,
      skipped: true,
      session: { id: updated.id, currentTurn: updated.currentTurn, currentPlayerId: updated.currentPlayerId, isMyTurn: false, step: 'pick_truth_or_dare' },
    })
  }

  if (action === 'answer') {
    if (!lastTurn) return NextResponse.json({ error: 'No turn to answer' }, { status: 400 })
    await db.gameTurn.update({
      where: { id: lastTurn.id },
      data: { answerText, answerMediaUrl },
    })
    // Pass turn to partner
    const updated = await db.gameSession.update({
      where: { id: session.id },
      data: {
        currentTurn: session.currentTurn + 1,
        currentPlayerId: partnerId,
      },
    })
    return NextResponse.json({
      ok: true,
      answered: true,
      session: {
        id: updated.id,
        currentTurn: updated.currentTurn,
        currentPlayerId: updated.currentPlayerId,
        isMyTurn: false,
        step: 'pick_truth_or_dare',
      },
    })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
