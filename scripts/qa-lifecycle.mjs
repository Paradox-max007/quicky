// Quicky — Room LIFECYCLE + RULES + ADMIN QA (lifecycle PRD §61-§66)
// Usage: BASE=http://localhost:3000 bun scripts/qa-lifecycle.mjs
//
// Covers: Test A/B/C/D/E (§61), round-safety (§62), chat cleanup (§63),
// admin tests (§64), rules tests (§65). Thresholds are env-tunable — run the
// dev server with CLEANUP_* envs shortened for a fast pass.
import { PrismaClient } from '@prisma/client'

const BASE = process.env.BASE ?? 'http://localhost:3000'
const db = new PrismaClient()

let passed = 0
let failed = 0
const ok = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ FAIL: ${name} ${extra}`) }
}

async function login(phone) {
  const otpRes = await fetch(`${BASE}/api/quicky/auth/otp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone }),
  })
  const otp = await otpRes.json()
  if (!otp?.demoCode) throw new Error(`otp failed for ${phone}: ${JSON.stringify(otp)}`)
  const verifyRes = await fetch(`${BASE}/api/quicky/auth/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, code: otp.demoCode }),
  })
  const cookie = verifyRes.headers.getSetCookie?.().map((c) => c.split(';')[0]).join('; ')
      ?? (verifyRes.headers.get('set-cookie') ?? '').split(';')[0]
  const body = await verifyRes.json()
  return { cookie, userId: body?.user?.id }
}

const api = (cookie) => async (path, init = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) },
  })
  let body = null
  try { body = await res.json() } catch {}
  return { status: res.status, body }
}

// ── Test A (§61): new room → 1 active player, singleton timer starts ────────
console.log('\nTest A — new room starts singleton timer')
const A = await login('+15555550101')
const Aa = api(A.cookie)
const joinA = await Aa('/api/quicky/games/spin-bottle/join', { method: 'POST' })
ok('join ok', joinA.body?.ok === true && !!joinA.body?.roomId)
const roomId = joinA.body.roomId
let room = await db.spinRoom.findUnique({ where: { id: roomId } })
ok('room created', !!room)
ok('1 active player', (await db.spinRoomPlayer.count({ where: { roomId, isActive: true, leftAt: null } })) === 1)
ok('singletonStartedAt set (DB timestamp, not a React timer)', !!room?.singletonStartedAt)

// ── Test B (§61): second player joins → timer cancelled, room survives ──────
console.log('\nTest B — second player cancels the singleton timer')
const B = await login('+15555550107')
const Bb = api(B.cookie)
const joinB = await Bb('/api/quicky/games/spin-bottle/join', { method: 'POST' })
ok('B joined', joinB.body?.ok === true)
ok('B landed in A\'s room', joinB.body?.roomId === roomId, `got ${joinB.body?.roomId} want ${roomId}`)
room = await db.spinRoom.findUnique({ where: { id: roomId } })
ok('singletonStartedAt CLEARED (timer cancelled, §7)', room?.singletonStartedAt === null)

// ── Round safety (§62): B is targeted → B leaves mid-round is refused, ──────
console.log('\nRound safety — leave is refused mid-round, forfeit path resolves it')
// wait for a spin that targets B (B is male; spinner may be A female — target pool is opposite gender of spinner)
let targeted = false
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 700))
  const snap = await Bb(`/api/quicky/games/spin-bottle/room?roomId=${roomId}`)
  const spin = snap.body?.snapshot?.currentSpin
  if (spin && spin.spinnerId && spin.targetId) {
    targeted = spin.targetId === B.userId || spin.spinnerId === B.userId
    if (spin.status === 'awaiting') break
  }
}
ok('round reached awaiting with B as participant', targeted)
const leaveMid = await Bb('/api/quicky/games/spin-bottle/leave', { method: 'POST', body: JSON.stringify({ roomId }) })
ok('mid-round leave refused with 409 (room lock)', leaveMid.status === 409, `got ${leaveMid.status}`)

// B answers (valid activity + completes the round)
const snapNow = await Bb(`/api/quicky/games/spin-bottle/room?roomId=${roomId}`)
const spinNow = snapNow.body?.snapshot?.currentSpin
if (spinNow?.status === 'awaiting') {
  const resp = await Bb('/api/quicky/games/spin-bottle/respond', { method: 'POST', body: JSON.stringify({ roomId, choice: 'yes' }) })
  ok('response accepted', resp.body?.ok === true, JSON.stringify(resp.body))
} else {
  console.log('  (round already resolved — skipping live respond)')
}

// A answers too (second answer resolves). Get the spin fresh.
const snapA = await Aa(`/api/quicky/games/spin-bottle/room?roomId=${roomId}`)
const spinA = snapA.body?.snapshot?.currentSpin
if (spinA?.status === 'awaiting') {
  const respA = await Aa('/api/quicky/games/spin-bottle/respond', { method: 'POST', body: JSON.stringify({ roomId, choice: 'yes' }) })
  ok('A response accepted', respA.body?.ok === true, JSON.stringify(respA.body))
}

// permanent counters (§20): both took part in a completed round
await new Promise((r) => setTimeout(r, 1500))
const uA = await db.user.findUnique({ where: { id: A.userId } })
const uB = await db.user.findUnique({ where: { id: B.userId } })
ok('gamesPlayed incremented for A', (uA?.gamesPlayed ?? 0) >= 1)
ok('gamesPlayed incremented for B', (uB?.gamesPlayed ?? 0) >= 1)
ok('kissesGiven incremented (mutual kiss)', (uA?.kissesGiven ?? 0) >= 1 && (uB?.kissesGiven ?? 0) >= 1)

// ── Test C (§61): everyone leaves → room + chat deleted immediately ─────────
console.log('\nTest C/D — empty room deleted, chat deleted with it')
const msgCountBefore = await db.spinRoomMessage.count({ where: { roomId } })
ok('chat exists before deletion', msgCountBefore > 0)
await Aa('/api/quicky/games/spin-bottle/leave', { method: 'POST', body: JSON.stringify({ roomId }) })
room = await db.spinRoom.findUnique({ where: { id: roomId } })
ok('room survives with 1 player (B still there)', !!room)
const leaveB = await Bb('/api/quicky/games/spin-bottle/leave', { method: 'POST', body: JSON.stringify({ roomId }) })
ok('B leave ok', leaveB.body?.ok === true)
room = await db.spinRoom.findUnique({ where: { id: roomId } })
ok('room DELETED when last player left (§17)', room === null)
const spinCount = await db.spinBottleSpin.count({ where: { roomId } })
const msgCount = await db.spinRoomMessage.count({ where: { roomId } })
const giftCount = await db.spinRoomGift.count({ where: { roomId } })
ok('rounds cascaded away (§19)', spinCount === 0)
ok('chat deleted with room (§18/§63)', msgCount === 0)
ok('gifts cascaded away', giftCount === 0)
ok('B gamesPlayed counter SURVIVED room deletion (§20/§21)', (await db.user.findUnique({ where: { id: B.userId } }))?.gamesPlayed >= 1)

// ── Test E (§61): inactivity auto-leave, round-safe ─────────────────────────
console.log('\nTest E — inactivity auto-leave (server-authoritative)')
const join2A = await Aa('/api/quicky/games/spin-bottle/join', { method: 'POST' })
const room2 = join2A.body.roomId
const join2B = await Bb('/api/quicky/games/spin-bottle/join', { method: 'POST' })
ok('both in fresh room', join2B.body.roomId === room2)
// Backdate A's activity → the worker must remove A (B keeps playing).
const stale = new Date(Date.now() - 11 * 60_000)
await db.spinRoomPlayer.updateMany({ where: { roomId: room2, userId: A.userId }, data: { lastActivityAt: stale } })
const res2B = await db.spinRoomPlayer.updateMany({ where: { roomId: room2, userId: B.userId }, data: { lastActivityAt: new Date() } })
// fire a lazy sweep via a third join from a fresh user (debounced 20s) OR wait for the worker tick
await new Promise((r) => setTimeout(r, Number(process.env.CLEANUP_INTERVAL_S ?? 30) * 1000 + 4000))
const aMember = await db.spinRoomPlayer.findFirst({ where: { roomId: room2, userId: A.userId, leftAt: null, isActive: true } })
ok('inactive A auto-left (≥10min stale)', aMember === null)
const bMember = await db.spinRoomPlayer.findFirst({ where: { roomId: room2, userId: B.userId, leftAt: null, isActive: true } })
ok('active B untouched', !!bMember)
const closureA = await db.spinRoomClosure.findFirst({ where: { roomId: room2, userId: A.userId }, orderBy: { createdAt: 'desc' } })
ok('inactivity closure receipt written (§29)', closureA?.reason === 'inactivity')
// room-status API for A now
const statusA = await Aa(`/api/quicky/games/spin-bottle/room-status?roomId=${room2}`)
ok('room-status: A closed with inactivity reason', statusA.body?.closed === true && statusA.body?.reason === 'inactivity', JSON.stringify(statusA.body))

// ── Singleton closure (§5/§6/§10/§28): solo room past 5 min ─────────────────
console.log('\nSingleton rule — alone ≥ 5min → removed + room deleted')
// First drain the leftover room from Test E so the solo join CREATES a room.
const drainB = await Bb('/api/quicky/games/spin-bottle/leave', { method: 'POST', body: JSON.stringify({ roomId: room2 }) })
ok('leftover room drained (B left)', drainB.body?.ok === true)
const solo = await login('+15555550103')
const soloApi = api(solo.cookie)
const joinS = await soloApi('/api/quicky/games/spin-bottle/join', { method: 'POST' })
const soloRoomId = joinS.body.roomId
const soloRoom = await db.spinRoom.findUnique({ where: { id: soloRoomId } })
ok('solo room has singletonStartedAt', !!soloRoom?.singletonStartedAt)
await db.spinRoom.update({ where: { id: soloRoomId }, data: { singletonStartedAt: new Date(Date.now() - 6 * 60_000) } })
await new Promise((r) => setTimeout(r, Number(process.env.CLEANUP_INTERVAL_S ?? 30) * 1000 + 4000))
const soloRoomAfter = await db.spinRoom.findUnique({ where: { id: soloRoomId } })
ok('solo room DELETED after 5min singleton (§6/§9)', soloRoomAfter === null)
const soloClosure = await db.spinRoomClosure.findFirst({ where: { roomId: soloRoomId, userId: solo.userId }, orderBy: { createdAt: 'desc' } })
ok('singleton closure receipt (§28)', soloClosure?.reason === 'singleton')
const statusS = await soloApi(`/api/quicky/games/spin-bottle/room-status?roomId=${soloRoomId}`)
ok('room-status: singleton reason', statusS.body?.closed === true && statusS.body?.reason === 'singleton', JSON.stringify(statusS.body))

// ── Rules (§50/§65): public endpoint returns seeded order ───────────────────
console.log('\nRules — public endpoint + rotation source')
const rulesRes = await api(null)('/api/quicky/games/spin-bottle/rules')
ok('rules endpoint public + seeded', (rulesRes.body?.rules?.length ?? 0) >= 3)
const orders = rulesRes.body.rules.map((r) => r.sortOrder)
ok('rules sorted by sort_order (§49)', JSON.stringify(orders) === JSON.stringify([...orders].sort((a, b) => a - b)))

// ── Admin (§64): role enforcement ────────────────────────────────────────────
console.log('\nAdmin — server-side authorization')
const nonAdmin = await api(A.cookie)('/api/quicky/admin/game-rules')
ok('non-admin blocked from rule management (403)', nonAdmin.status === 403, `got ${nonAdmin.status}`)
const nonAdminGifts = await api(A.cookie)('/api/quicky/admin/gifts')
ok('non-admin blocked from gift management (403)', nonAdminGifts.status === 403, `got ${nonAdminGifts.status}`)
const admin = await login('+15555550000')
const adminApi = api(admin.cookie)
const adminRules = await adminApi('/api/quicky/admin/game-rules')
ok('admin can list rules', adminRules.status === 200)
const created = await adminApi('/api/quicky/admin/game-rules', { method: 'POST', body: JSON.stringify({ title: 'QA Rule', description: 'Temporary QA rule', icon: '🧪', sortOrder: 50 }) })
ok('admin can create a rule', created.body?.ok === true)
const patched = await adminApi('/api/quicky/admin/game-rules', { method: 'PATCH', body: JSON.stringify({ id: created.body.rule.id, data: { isActive: false } }) })
ok('admin can deactivate a rule', patched.body?.ok === true)
const publicAfterHide = await api(null)('/api/quicky/games/spin-bottle/rules')
ok('hidden rule vanished from the public endpoint', !publicAfterHide.body.rules.some((r) => r.id === created.body.rule.id))
const deleted = await adminApi('/api/quicky/admin/game-rules', { method: 'DELETE', body: JSON.stringify({ id: created.body.rule.id }) })
ok('admin can delete a rule', deleted.body?.ok === true)

console.log(`\n═══ RESULT: ${passed} passed, ${failed} failed ═══`)
await db.$disconnect()
process.exit(failed > 0 ? 1 : 0)
