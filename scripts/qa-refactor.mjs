// Quicky — REFACTOR PRD QA (Task 9: friends / blocks / complaints /
// clear chat / relationship / games presence / photo height / admin games)
// Usage: BASE=http://localhost:3000 DATABASE_URL=file:/tmp/my-project/db/custom.db bun scripts/qa-refactor.mjs
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
  if (!otp?.demoCode) throw new Error(`otp failed for ${phone}`)
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

// ─── Setup: three fresh users ────────────────────────────────────────────────
const A = await login('+15555550101')
const B = await login('+15555550114')
const C = await login('+15555550117')
const Aa = api(A.cookie)
const Ba = api(B.cookie)
const Ca = api(C.cookie)
ok('logins', !!A.userId && !!B.userId && !!C.userId)

// ─── Test 1: friends (§25) ───────────────────────────────────────────────────
console.log('\nTest 1 — friendships (§25/§80)')
const dup = await Ba('/api/quicky/friends', { method: 'POST', body: JSON.stringify({ userId: B.userId }) })
ok('cannot friend yourself', dup.status === 400)

const add1 = await Aa('/api/quicky/friends', { method: 'POST', body: JSON.stringify({ userId: B.userId }) })
ok('A adds B', add1.status === 201 || add1.body?.error === 'already_friends')

const add2 = await Aa('/api/quicky/friends', { method: 'POST', body: JSON.stringify({ userId: B.userId }) })
ok('duplicate friend rejected', add2.status === 409)

const listA = await Aa('/api/quicky/friends')
ok('A lists B as friend', listA.body?.friends?.some((f) => f.id === B.userId))

const relB = await Ba(`/api/quicky/relationship?userId=${A.userId}`)
ok('relationship shows isFriend both ways', relB.body?.isFriend === true)

// ─── Test 2: blocks dissolve friendship + prevent re-friending (§55) ────────
console.log('\nTest 2 — blocks (§55/§80)')
const blk = await Ba('/api/quicky/blocks', { method: 'POST', body: JSON.stringify({ userId: A.userId }) })
ok('B blocks A', blk.body?.ok === true)

const relAfterBlock = await Aa(`/api/quicky/relationship?userId=${B.userId}`)
ok('friendship dissolved by block', relAfterBlock.body?.isFriend === false && relAfterBlock.body?.theyBlockedMe === true)

const refriend = await Aa('/api/quicky/friends', { method: 'POST', body: JSON.stringify({ userId: B.userId }) })
ok('blocked pair cannot re-friend', refriend.status === 403)

const dmBlocked = await Aa('/api/quicky/game-chat/messages', { method: 'POST', body: JSON.stringify({ peerUserId: B.userId, messageType: 'text', text: 'hello?' }) })
ok('blocked game DM refused (§55)', dmBlocked.status === 403)

const unblk = await Ba('/api/quicky/blocks?userId=' + A.userId, { method: 'DELETE' })
ok('B unblocks A', unblk.body?.ok === true)

// re-friend for later tests
await Aa('/api/quicky/friends', { method: 'POST', body: JSON.stringify({ userId: B.userId }) })

// ─── Test 3: complaints (§57-§60) ────────────────────────────────────────────
console.log('\nTest 3 — complaints (§57/§58/§60)')
const selfComplaint = await Aa('/api/quicky/complaints', { method: 'POST', body: JSON.stringify({ reportedUserId: A.userId, reason: 'spam' }) })
ok('cannot complain about yourself', selfComplaint.status === 400)

const badReason = await Aa('/api/quicky/complaints', { method: 'POST', body: JSON.stringify({ reportedUserId: B.userId, reason: 'nonsense' }) })
ok('invalid reason rejected', badReason.status === 400)

const comp = await Ca('/api/quicky/complaints', { method: 'POST', body: JSON.stringify({ reportedUserId: A.userId, reason: 'spam', description: 'QA complaint', conversationId: 'qa-conv' }) })
ok('C files complaint', comp.status === 201 && !!comp.body?.complaintId)

const compRow = await db.report.findUnique({ where: { id: comp.body.complaintId } })
ok('name snapshot stored (§59)', !!compRow?.reportedNameSnapshot)

// admin gate: C is not admin → forbidden
const adminListForbidden = await Ca('/api/quicky/admin/complaints')
ok('admin list forbidden for non-admin', adminListForbidden.status === 403)

// admin (seeded via make-admin +15555550000)
const AD = await login('+15555550000')
const ADa = api(AD.cookie)
const adminList = await ADa('/api/quicky/admin/complaints')
ok('admin sees complaints', adminList.status === 200 && adminList.body?.complaints?.some((c) => c.id === comp.body.complaintId))
ok('admin record shows reporter + reported ids (§59)',
  !!adminList.body?.complaints?.find((c) => c.id === comp.body.complaintId)?.reporter?.id &&
  !!adminList.body?.complaints?.find((c) => c.id === comp.body.complaintId)?.reported?.id)

const patchStatus = await ADa('/api/quicky/admin/complaints', { method: 'PATCH', body: JSON.stringify({ id: comp.body.complaintId, status: 'REVIEWING' }) })
ok('admin updates status (§60)', patchStatus.body?.ok === true)
const patched = await db.report.findUnique({ where: { id: comp.body.complaintId } })
ok('status persisted', patched?.status === 'REVIEWING')

// ─── Test 4: games catalog with activePlayers (§16/§17) ─────────────────────
console.log('\nTest 4 — games catalog presence (§16)')
const games = await Aa('/api/quicky/games')
ok('catalog lists games', games.status === 200 && (games.body?.games?.length ?? 0) > 0)
const spin = games.body?.games?.find((g) => g.slug === 'spin-the-bottle')
ok('spin-the-bottle has activePlayers field', spin && typeof spin.activePlayers === 'number')

// ─── Test 5: photo displayHeight persistence (§9/§10) ───────────────────────
console.log('\nTest 5 — photo display height (§9/§10)')
const me = await Aa('/api/quicky/auth/me')
const photo = me.body?.user?.photos?.[0]
ok('user has a photo to patch', !!photo?.id)
if (photo?.id) {
  const patchH = await Aa(`/api/quicky/profile/media/${photo.id}`, { method: 'PATCH', body: JSON.stringify({ displayHeight: 504 }) })
  ok('PATCH persists displayHeight', patchH.body?.photo?.displayHeight === 504)

  const me2 = await Aa('/api/quicky/auth/me')
  const again = me2.body?.user?.photos?.find((p) => p.id === photo.id)
  ok('me route returns displayHeight (§10 restore)', again?.displayHeight === 504)

  const badH = await Aa(`/api/quicky/profile/media/${photo.id}`, { method: 'PATCH', body: JSON.stringify({ displayHeight: 50 }) })
  ok('out-of-range height rejected', badH.status === 400)

  const foreign = await Ba(`/api/quicky/profile/media/${photo.id}`, { method: 'PATCH', body: JSON.stringify({ displayHeight: 500 }) })
  ok('only the owner can patch (§9)', foreign.status === 403)

  await Aa(`/api/quicky/profile/media/${photo.id}`, { method: 'PATCH', body: JSON.stringify({ displayHeight: null }) })
}

// ─── Test 6: dating Clear Chat is per-user (§56) ─────────────────────────────
console.log('\nTest 6 — per-user clear chat (§56)')
// A↔C: A sends two messages; A clears; A sees 0, C still sees 2.
for (const st of await db.conversationState.findMany({ where: { matchId: { not: null } } }))
  await db.conversationState.delete({ where: { id: st.id } })
const matchRow = await db.match.findFirst({
  where: { status: 'active', OR: [
    { userAId: A.userId, userBId: C.userId },
    { userAId: C.userId, userBId: A.userId },
  ] },
})
if (matchRow) {
  const mid = matchRow.id
  await Aa(`/api/quicky/matches/${mid}/messages`, { method: 'POST', body: JSON.stringify({ type: 'text', text: 'clear-chat QA one' }) })
  await Aa(`/api/quicky/matches/${mid}/messages`, { method: 'POST', body: JSON.stringify({ type: 'text', text: 'clear-chat QA two' }) })
  const beforeA = await Aa(`/api/quicky/matches/${mid}/messages`)
  ok('A sees 2 messages before clear', (beforeA.body?.messages?.length ?? 0) >= 2)
  const clear = await Aa(`/api/quicky/matches/${mid}/messages`, { method: 'DELETE' })
  ok('clear accepted', clear.body?.ok === true)
  const afterA = await Aa(`/api/quicky/matches/${mid}/messages`)
  ok('A sees 0 after clear', (afterA.body?.messages?.length ?? 0) === 0)
  const afterC = await Ca(`/api/quicky/matches/${mid}/messages`)
  ok('C still sees the history (§56: partner history preserved)', (afterC.body?.messages?.length ?? 0) >= 2)
  // reset so repeat runs stay deterministic
  await Ca(`/api/quicky/matches/${mid}/messages`, { method: 'DELETE' })
} else {
  ok('(skipped) no A↔C active match fixture', true, ' — fixture-dependent')
}

// ─── Test 7: admin games configuration (§19/§20) ─────────────────────────────
console.log('\nTest 7 — admin game config (§19/§84)')
const adminGames = await ADa('/api/quicky/admin/games')
ok('admin list includes ALL games + description items', adminGames.status === 200 && (adminGames.body?.games?.length ?? 0) >= 8)

const forbiddenUpdate = await Aa('/api/quicky/admin/games', { method: 'PATCH', body: JSON.stringify({ kind: 'game', id: spin.id, data: { name: 'HACKED' } }) })
ok('non-admin cannot edit games', forbiddenUpdate.status === 403)

const descItems = adminGames.body?.descriptionItems?.filter((i) => i.gameId === spin.id) ?? []
ok('spin-the-bottle has seeded rotating texts (§20)', descItems.length >= 5)

const reorderItem = descItems[0]
if (reorderItem) {
  const up = await ADa('/api/quicky/admin/games', { method: 'PATCH', body: JSON.stringify({ kind: 'description', id: reorderItem.id, data: { sortOrder: 99 } }) })
  ok('description reorder persisted (§86)', up.body?.ok === true)
  await ADa('/api/quicky/admin/games', { method: 'PATCH', body: JSON.stringify({ kind: 'description', id: reorderItem.id, data: { sortOrder: reorderItem.sortOrder } }) })
}

const landing = await Aa('/api/quicky/games/spin-bottle/landing-stats')
ok('landing-stats serves admin rotatingTexts (§20)', Array.isArray(landing.body?.rotatingTexts) && landing.body.rotatingTexts.length >= 5)
ok('landing-stats chemistry is the central engine result', !!landing.body?.chemistry && 'overall' in landing.body.chemistry)

const dash = await Aa('/api/quicky/dashboard')
ok('dashboard exposes chemistryBreakdown (§4)', !!dash.body?.stats?.chemistryBreakdown && typeof dash.body.stats.chemistryBreakdown.dating?.score === 'number')

// cleanup: remove A↔B friendship so repeat runs are deterministic
await Aa(`/api/quicky/friends?userId=${B.userId}`, { method: 'DELETE' })

console.log(`\n=== qa-refactor: ${passed} passed, ${failed} failed ===`)
process.exit(failed === 0 ? 0 : 1)
