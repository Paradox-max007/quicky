// Quicky — RELATIONSHIP (refactor PRD §54/§55/§96)
// GET /api/quicky/relationship?userId=...
//   -> { isFriend, iBlockedThem, theyBlockedMe, userId }
//
// One cheap endpoint the profile toolbox (§96), profile ••• menu (§54) and
// chat ••• menu (§53) use to generate the correct relationship-aware actions.
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = req.nextUrl.searchParams.get('userId') ?? ''
  if (!userId || userId === me.id)
    return NextResponse.json({ error: 'userId required' }, { status: 400 })

  const [friendship, myBlock, theirBlock] = await Promise.all([
    db.friendship.findFirst({
      where: {
        OR: [
          { requesterId: me.id, addresseeId: userId },
          { requesterId: userId, addresseeId: me.id },
        ],
      },
    }),
    db.block.findUnique({
      where: { blockerId_blockedId: { blockerId: me.id, blockedId: userId } },
    }),
    db.block.findUnique({
      where: { blockerId_blockedId: { blockerId: userId, blockedId: me.id } },
    }),
  ])

  return NextResponse.json({
    userId,
    isFriend: !!friendship,
    iBlockedThem: !!myBlock,
    theyBlockedMe: !!theirBlock,
  })
}
