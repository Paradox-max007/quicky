// Quicky — Truth or Dare (Premium only) per PRD §9.1
// POST  /api/quicky/matches/[matchId]/game  { gameType: 'truth_or_dare' } -> start session, return first prompt
// GET   /api/quicky/matches/[matchId]/game  -> current session state
// PATCH /api/quicky/matches/[matchId]/game  { action: 'truth' | 'dare' | 'skip' | 'answer', answerText?, answerMediaUrl? }
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { TOD_DECKS } from '@/lib/quicky/constants'

export async function GET(req: NextRequest, ctx: { params: Promise<{ matchId: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { matchId } = await ctx.params

  const match = await db.match.findUnique({ where: { id: matchId } })
  if (!match || (match.userAId !== me.id && match.userBId !== me.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const session = await db.gameSession.findFirst({
    where: { matchId, status: 'active', gameType: 'truth_or_dare' },
    include: { turns: { orderBy: { createdAt: 'asc' } } },
  })

  if (!session) {
    return NextResponse.json({ session: null })
  }

  const partnerId = match.userAId === me.id ? match.userBId : match.userAId

  return NextResponse.json({
    session: {
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
    },
  })
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
  if (gameType !== 'truth_or_dare') {
    return NextResponse.json({ error: 'Only truth_or_dare is supported in MVP' }, { status: 400 })
  }

  // Premium gate
  if (!me.isPremium) {
    return NextResponse.json({ error: 'premium_required', paywall: 'games' }, { status: 402 })
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

  // First turn: I pick 'truth' or 'dare' for my partner. But really the flow is:
  // - Session starts with currentPlayer = me. The UI shows "Your turn: choose Truth or Dare for {partner}".
  // - Then partner picks the prompt for me? No actually the standard flow:
  //   I (current player) choose truth or dare FOR MYSELF, then I get a prompt for that category, then I answer.
  // Let's go with: current player chooses 'truth' or 'dare' for themselves, then a random prompt from that deck.

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
  const action = String(body.action ?? '') as 'truth' | 'dare' | 'skip' | 'answer'
  const answerText = body.answerText ? String(body.answerText) : null
  const answerMediaUrl = body.answerMediaUrl ? String(body.answerMediaUrl) : null

  const session = await db.gameSession.findUnique({
    where: { id: sessionId },
    include: { turns: true },
  })
  if (!session || session.matchId !== matchId || session.status !== 'active') {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

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
