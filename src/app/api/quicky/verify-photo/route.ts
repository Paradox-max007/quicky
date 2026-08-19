// Quicky — photo verification (PRD §5.5)
// POST /api/quicky/verify-photo  { action: 'request_challenge' | 'submit' }
//   request_challenge -> returns a random challenge (e.g. "Look left + smile")
//   submit            -> marks user as verified, returns badge
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

const CHALLENGES = [
  { id: 'look_left', text: 'Turn your head left and smile', emoji: '\u{1F917}' },
  { id: 'peace_sign', text: 'Hold up two fingers (peace sign)', emoji: '\u270C\uFE0F' },
  { id: 'thumb_up', text: 'Give a thumbs up', emoji: '\u{1F44D}' },
  { id: 'look_up', text: 'Look up and to the right', emoji: '\u{1F447}' },
  { id: 'smile_big', text: 'Show a big smile with teeth', emoji: '\u{1F604}' },
]

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const action = String(body.action ?? 'request_challenge')

  if (action === 'request_challenge') {
    const challenge = CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)]
    return NextResponse.json({ challenge })
  }

  if (action === 'submit') {
    // For demo: accept any submission (we're not actually running face match)
    const updated = await db.user.update({
      where: { id: me.id },
      data: { isVerified: true },
    })
    return NextResponse.json({ ok: true, isVerified: updated.isVerified })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
