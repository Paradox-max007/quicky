// Quicky — server-authoritative member activity tracking (lifecycle PRD §12-§14)
//
// Every meaningful in-room interaction refreshes the member's
// lastActivityAt (and the room's lastActivityAt). The cleanup worker uses
// that column to auto-leave members idle ≥ 10 minutes — a killed/crashed
// client simply stops refreshing and is swept server-side.
//
// §13 (avoid excessive writes): the write is throttled per member — if the
// row was refreshed less than ACTIVITY_THROTTLE_MS ago the write is skipped.
// Callers never need their own throttle.

import { db } from '@/lib/db'

const ACTIVITY_THROTTLE_MS = 20_000

/**
 * Refresh a member's presence row + the room's activity stamp.
 * Throttled: at most one write per member per ACTIVITY_THROTTLE_MS.
 * Returns true when a write actually happened.
 */
export async function touchMemberActivity(roomId: string, userId: string): Promise<boolean> {
  const member = await db.spinRoomPlayer.findFirst({
    where: { roomId, userId, leftAt: null, isActive: true },
    select: { id: true, lastActivityAt: true },
  })
  if (!member) return false // not an active member — nothing to refresh
  if (Date.now() - member.lastActivityAt.getTime() < ACTIVITY_THROTTLE_MS) {
    return false // §13: recent enough already — skip the write
  }
  const now = new Date()
  await db.spinRoomPlayer
    .update({ where: { id: member.id }, data: { lastActivityAt: now } })
    .catch(() => {})
  await db.spinRoom
    .update({ where: { id: roomId }, data: { lastActivityAt: now } })
    .catch(() => {})
  return true
}
