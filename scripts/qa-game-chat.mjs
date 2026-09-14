// Quicky — GAME CHAT + OFF-SCREEN DECISION QA (game-chat PRD §134-§146)
// Usage: BASE=http://localhost:3000 bun scripts/qa-game-chat.mjs
//
// Covers: conversation get-or-create (§10/§11), list contents (§9), realtime
// stream push (§19/§134 Test 3), read receipts (§16/§17/§134 Test 4),
// reactions (§31/§136), reply validation (§27), clientMessageId dedup
// (§92/§93), cursor pagination (§24), sticker ownership enforcement (§75),
// sticker purchase (§64/§76), admin sticker CRUD + 403s (§127/§146),
// audit rows (§120), and the game decision response path (§107/§108/§143).
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

// ── Setup: three users + one admin ──────────────────────────────────────────
const A = await login('+15555550201')
const B = await login('+15555550202')
const C = await login('+15555550203')
const admin = await login('+15555550000')

// Idempotency: wipe THIS QA trio's game-chat state so re-runs start clean
// (conversations are keyed by the canonical user pair, so leftover rows from
// a previous run would otherwise pollute counts).
{
  const ids = [A.userId, B.userId, C.userId]
  const convos = await db.gameConversation.findMany({
    where: { OR: [{ userAId: { in: ids } }, { userBId: { in: ids } }] },
    select: { id: true },
  })
  await db.gameConversation.deleteMany({ where: { id: { in: convos.map((c) => c.id) } } })
  await db.gameConversationMember.deleteMany({ where: { userId: { in: ids } } })
  await db.gameStickerBundle.deleteMany({ where: { name: { startsWith: 'QA ' } } })
  // previous-run purchases would make the "un-owned sticker" test pass falsely
  await db.userGameStickerBundle.deleteMany({ where: { userId: { in: ids } } })
}
const Aa = api(A.cookie)
const Bb = api(B.cookie)
const Cc = api(C.cookie)
const adminApi = api(admin.cookie)

// ── Test 1 (§134/§94): profile → Message opens a conversation on first send
console.log('\nTest 1 — first send creates ONE canonical conversation')
const cmi1 = `qa_${Date.now()}_a1`
const send1 = await Aa('/api/quicky/game-chat/messages', {
  method: 'POST',
  body: JSON.stringify({ peerUserId: B.userId, messageType: 'text', text: 'Hey 👋', clientMessageId: cmi1 }),
})
ok('A→B send ok', send1.body?.ok === true, JSON.stringify(send1.body))
const convId = send1.body?.conversationId
ok('conversation id returned', !!convId)

// §11: the SAME conversation resolves for the reverse direction
const sendBack = await Bb('/api/quicky/game-chat/messages', {
  method: 'POST',
  body: JSON.stringify({ peerUserId: A.userId, messageType: 'text', text: 'Hey back!', clientMessageId: `qa_${Date.now()}_b1` }),
})
ok('B→A lands in the SAME conversation (§11)', sendBack.body?.conversationId === convId, `${sendBack.body?.conversationId} vs ${convId}`)

// §92/§93: retrying with the same clientMessageId does NOT duplicate
const retry = await Aa('/api/quicky/game-chat/messages', {
  method: 'POST',
  body: JSON.stringify({ peerUserId: B.userId, messageType: 'text', text: 'Hey 👋', clientMessageId: cmi1 }),
})
ok('clientMessageId retry is idempotent (§92)', retry.body?.message?.id === send1.body?.message?.id)
const msgCount = await db.gameMessage.count({ where: { conversationId: convId } })
ok('no duplicate rows after retry', msgCount === 2)

// ── Test 2 (§134/§9): list shows only real conversations ────────────────────
console.log('\nTest 2 — conversation list contents + unread')
const listA = await Aa('/api/quicky/game-chat/conversations')
const rowB = (listA.body?.conversations ?? []).find((c) => c.peer.id === B.userId)
ok('A sees a row for B', !!rowB)
ok('row has last-message preview', !!rowB?.lastMessage?.preview && rowB.lastMessage.fromMe === false, JSON.stringify(rowB?.lastMessage))
ok('unread count 1 for A (B replied)', rowB?.unread === 1)
const stranger = (listA.body?.conversations ?? []).find((c) => c.peer.id === C.userId)
ok('C never auto-appears (no conversation, §9)', !stranger)

// ── Test 3 (§134 Test 3): realtime push ─────────────────────────────────────
console.log('\nTest 3 — realtime SSE push to the peer')
const events = []
const ac = new AbortController()
const streamPromise = (async () => {
  const res = await fetch(`${BASE}/api/quicky/game-chat/stream`, {
    headers: { cookie: B.cookie },
    signal: ac.signal,
  })
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 2)
      if (chunk.startsWith('data: ')) events.push(JSON.parse(chunk.slice(6)))
    }
  }
})().catch(() => {})
await new Promise((r) => setTimeout(r, 1200)) // let the stream attach
await Aa('/api/quicky/game-chat/messages', {
  method: 'POST',
  body: JSON.stringify({ peerUserId: B.userId, messageType: 'text', text: 'Realtime ping ⚡', clientMessageId: `qa_${Date.now()}_rt` }),
})
await new Promise((r) => setTimeout(r, 1500))
ac.abort()
await streamPromise
const pushed = events.find((e) => e?.type === 'message' && e?.message?.text === 'Realtime ping ⚡')
ok('message pushed to B without polling (§19)', !!pushed)
ok('push carries the full message payload', !!pushed?.message?.id)

// ── Test 4 (§134 Test 4): read receipts ─────────────────────────────────────
console.log('\nTest 4 — read receipts')
const read = await Bb('/api/quicky/game-chat/read', { method: 'POST', body: JSON.stringify({ conversationId: convId }) })
ok('B marks read', read.body?.ok === true)
const listB2 = await Bb('/api/quicky/game-chat/conversations')
const rowA2 = (listB2.body?.conversations ?? []).find((c) => c.peer.id === A.userId)
ok('unread drops to 0 after read (§89)', rowA2?.unread === 0, JSON.stringify(rowA2))
const msgs1 = await Aa(`/api/quicky/game-chat/messages?conversationId=${convId}`)
ok('A sees peerLastReadAt (✓✓ source, §17)', !!msgs1.body?.peerLastReadAt)

// ── Test 5 (§135/§136): reply + reactions ───────────────────────────────────
console.log('\nTest 5 — replies + reactions')
const first = send1.body.message
const badReply = await Bb('/api/quicky/game-chat/messages', {
  method: 'POST',
  body: JSON.stringify({ conversationId: convId, messageType: 'text', text: 'sneaky', replyToMessageId: 'nonexistent', clientMessageId: `qa_${Date.now()}_r0` }),
})
ok('invalid reply target rejected (§27)', badReply.status === 400)
const goodReply = await Bb('/api/quicky/game-chat/messages', {
  method: 'POST',
  body: JSON.stringify({ conversationId: convId, messageType: 'text', text: 'In the room!', replyToMessageId: first.id, clientMessageId: `qa_${Date.now()}_r1` }),
})
ok('reply accepted with reference', goodReply.body?.message?.replyTo?.id === first.id)
const react = await Bb('/api/quicky/game-chat/react', { method: 'POST', body: JSON.stringify({ messageId: first.id, reaction: '❤️' }) })
ok('reaction stored (§31)', react.body?.ok === true)
const reactSwitch = await Bb('/api/quicky/game-chat/react', { method: 'POST', body: JSON.stringify({ messageId: first.id, reaction: '🔥' }) })
ok('reaction REPLACES (one active per user, §31)', reactSwitch.body?.ok === true)
const msgAfter = await db.gameMessageReaction.findMany({ where: { messageId: first.id, userId: B.userId } })
ok('exactly one reaction row for B', msgAfter.length === 1 && msgAfter[0].reaction === '🔥')
const badReact = await Cc('/api/quicky/game-chat/react', { method: 'POST', body: JSON.stringify({ messageId: first.id, reaction: '❤️' }) })
ok('outsider cannot react (§125)', badReact.status === 403)

// ── Test 6 (§24): cursor pagination ─────────────────────────────────────────
console.log('\nTest 6 — pagination')
for (let i = 0; i < 45; i++) {
  await Aa('/api/quicky/game-chat/messages', {
    method: 'POST',
    body: JSON.stringify({ conversationId: convId, messageType: 'text', text: `bulk ${i}`, clientMessageId: `qa_${Date.now()}_bulk${i}` }),
  })
}
const page1 = await Aa(`/api/quicky/game-chat/messages?conversationId=${convId}`)
ok('latest page capped at 40 (§24)', page1.body?.messages?.length === 40, String(page1.body?.messages?.length))
const page2 = await Aa(`/api/quicky/game-chat/messages?conversationId=${convId}&before=${encodeURIComponent(page1.body.oldestCursor)}`)
ok('older page returned via cursor', (page2.body?.messages?.length ?? 0) > 0)
ok('pages do not overlap', !page2.body.messages.some((m) => page1.body.messages.some((p) => p.id === m.id)))
const ordered = [...page1.body.messages].every((m, i, arr) => i === 0 || arr[i - 1].createdAt <= m.createdAt)
ok('ASC ordering inside a page (§23)', ordered)

// ── Test 7 (§75/§146): sticker ownership + purchase ─────────────────────────
console.log('\nTest 7 — stickers: ownership, purchase, validation')
const seeds = await db.gameSticker.findMany({ include: { bundle: true } })
ok('seeded stickers exist', seeds.length >= 5, String(seeds.length))
const sticker = seeds[0]
const steal = await Aa('/api/quicky/game-chat/messages', {
  method: 'POST',
  body: JSON.stringify({ conversationId: convId, messageType: 'sticker', stickerId: sticker.id, clientMessageId: `qa_${Date.now()}_s0` }),
})
ok('un-owned sticker REJECTED server-side (§75)', steal.status === 403, `got ${steal.status}`)
const balBefore = (await db.user.findUnique({ where: { id: A.userId } })).coinBalance
const buy = await Aa('/api/quicky/game-chat/stickers', { method: 'POST', body: JSON.stringify({ action: 'purchase', bundleId: sticker.bundleId }) })
ok('purchase ok (§76)', buy.body?.ok === true, JSON.stringify(buy.body))
const balAfter = (await db.user.findUnique({ where: { id: A.userId } }))
ok('coins deducted exactly once', balAfter.coinBalance === balBefore - sticker.bundle.priceCoins)
const ledger = await db.coinLedger.findFirst({ where: { userId: A.userId, reason: 'sticker_bundle_purchase' }, orderBy: { createdAt: 'desc' } })
ok('CoinLedger row written (permanent economy)', !!ledger)
const buyAgain = await Aa('/api/quicky/game-chat/stickers', { method: 'POST', body: JSON.stringify({ action: 'purchase', bundleId: sticker.bundleId }) })
ok('re-purchase is idempotent (alreadyOwned)', buyAgain.body?.alreadyOwned === true)
const sendSticker = await Aa('/api/quicky/game-chat/messages', {
  method: 'POST',
  body: JSON.stringify({ conversationId: convId, messageType: 'sticker', stickerId: sticker.id, clientMessageId: `qa_${Date.now()}_s1` }),
})
ok('owned sticker accepted', sendSticker.body?.ok === true)
ok('sticker message references stickerId (§74)', sendSticker.body?.message?.stickerId === sticker.id)
const claim = await Bb('/api/quicky/game-chat/stickers', { method: 'POST', body: JSON.stringify({ action: 'claim', bundleId: sticker.bundleId }) })
ok('claim without reward config rejected (§77)', claim.status === 400, `got ${claim.status}`)

// ── Test 8 (§127/§146): admin sticker management ────────────────────────────
console.log('\nTest 8 — admin sticker CRUD + authorization')
const nonAdmin = await api(A.cookie)('/api/quicky/admin/stickers/bundles')
ok('non-admin blocked from bundle management (§127)', nonAdmin.status === 403)
const adminList = await adminApi('/api/quicky/admin/stickers/bundles')
ok('admin can list bundles + leagues + seasons', adminList.status === 200 && Array.isArray(adminList.body?.leagues))
const created = await adminApi('/api/quicky/admin/stickers/bundles', {
  method: 'POST',
  body: JSON.stringify({ name: 'QA Hearts', priceCoins: 250, minimumLeaguePoints: 0, purchaseEnabled: true, isActive: true, sortOrder: 50 }),
})
ok('admin creates a bundle (§146)', created.body?.ok === true)
const goldLeague = adminList.body.leagues.find((l) => l.name === 'Gold')
const created2 = await adminApi('/api/quicky/admin/stickers/bundles', {
  method: 'POST',
  body: JSON.stringify({ name: 'QA Gold Rewards', leagueId: goldLeague?.id, minimumLeaguePoints: 1000, rewardEnabled: true, purchaseEnabled: false }),
})
ok('league-linked bundle created (§65/§66)', created2.body?.ok === true)
const patched = await adminApi('/api/quicky/admin/stickers/bundles', {
  method: 'PATCH',
  body: JSON.stringify({ id: created.body.bundle.id, data: { isActive: false } }),
})
ok('admin deactivates a bundle', patched.body?.ok === true)
const stickerAdd = await adminApi('/api/quicky/admin/stickers', {
  method: 'POST',
  body: JSON.stringify({ bundleId: created.body.bundle.id, name: 'QA Kiss', assetUrl: '💋', sortOrder: 1 }),
})
ok('admin adds a sticker to the bundle (§146)', stickerAdd.body?.ok === true)
const badAsset = await adminApi('/api/quicky/admin/stickers', {
  method: 'POST',
  body: JSON.stringify({ bundleId: created.body.bundle.id, name: 'Evil', assetUrl: 'http://evil.example/x.exe' }),
})
ok('http asset rejected (§119)', badAsset.status === 400)
const badAsset2 = await adminApi('/api/quicky/admin/stickers', {
  method: 'POST',
  body: JSON.stringify({ bundleId: created.body.bundle.id, name: 'Evil', assetUrl: 'https://evil.example/x.exe' }),
})
ok('non-image asset rejected (§119)', badAsset2.status === 400)
const hidden = await Aa('/api/quicky/game-chat/stickers')
ok('inactive bundle hidden from players', !hidden.body?.bundles?.some((b) => b.id === created.body.bundle.id))
const deleted = await adminApi('/api/quicky/admin/stickers/bundles', { method: 'DELETE', body: JSON.stringify({ id: created.body.bundle.id }) })
ok('admin deletes a bundle (cascades stickers)', deleted.body?.ok === true)
const stickerGone = await db.gameSticker.count({ where: { bundleId: created.body.bundle.id } })
ok('stickers cascaded away', stickerGone === 0)
const goldGone = await adminApi('/api/quicky/admin/stickers/bundles', { method: 'DELETE', body: JSON.stringify({ id: created2.body.bundle.id }) })
ok('cleanup reward bundle', goldGone.body?.ok === true)

// ── Test 9 (§120): audit trail ───────────────────────────────────────────────
console.log('\nTest 9 — audit log')
const audits = await db.adminAuditLog.findMany({ where: { entityType: { in: ['sticker_bundle', 'sticker'] } }, orderBy: { createdAt: 'desc' }, take: 10 })
ok('bundle create audited', audits.some((a) => a.action === 'create' && a.entityType === 'sticker_bundle'))
ok('bundle delete audited', audits.some((a) => a.action === 'delete' && a.entityType === 'sticker_bundle'))

// ── Test 10 (§107/§108/§143): decision drawer response path = same API ─────
console.log('\nTest 10 — shared respond API (drawer uses the same endpoint)')
const joinA = await Aa('/api/quicky/games/spin-bottle/join', { method: 'POST' })
const joinB = await Bb('/api/quicky/games/spin-bottle/join', { method: 'POST' })
ok('both in one room', joinA.body?.ok && joinB.body?.roomId === joinA.body?.roomId)
let awaiting = null
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 700))
  const snap = await Bb(`/api/quicky/games/spin-bottle/room?roomId=${joinA.body.roomId}`)
  const spin = snap.body?.snapshot?.currentSpin
  if (spin?.status === 'awaiting' && spin.spinnerId && spin.targetId) { awaiting = spin; break }
}
ok('round reached awaiting', !!awaiting)
if (awaiting) {
  // The server decides who the target is (§128) — answer FROM THE TARGET's
  // session through the SAME endpoint the drawer calls.
  const targetIsB = awaiting.targetId === B.userId
  const responder = targetIsB ? Bb : Aa
  const who = targetIsB ? 'B' : 'A'
  const resp = await responder('/api/quicky/games/spin-bottle/respond', {
    method: 'POST',
    body: JSON.stringify({ roomId: joinA.body.roomId, choice: 'yes' }),
  })
  ok(`${who} (target) responds via the shared API (§143)`, resp.body?.ok === true, JSON.stringify(resp.body))
  const dup = await responder('/api/quicky/games/spin-bottle/respond', {
    method: 'POST',
    body: JSON.stringify({ roomId: joinA.body.roomId, choice: 'no' }),
  })
  ok('duplicate response rejected server-side (§130)', dup.status === 409 || dup.body?.outcome === false || dup.body?.ok !== true, JSON.stringify(dup.body))
  // outsider cannot respond
  const outsider = await Cc('/api/quicky/games/spin-bottle/respond', {
    method: 'POST',
    body: JSON.stringify({ roomId: joinA.body.roomId, choice: 'yes' }),
  })
  ok('non-participant cannot respond (§108)', outsider.status === 409 || outsider.status === 403 || outsider.body?.error !== undefined)
}

// ── Test 11 (§132/§145): room deletion leaves private chat intact ──────────
console.log('\nTest 11 — private chat survives room deletion')
const leaveWithRetry = async (sessionApi) => {
  for (let i = 0; i < 25; i++) {
    const r = await sessionApi('/api/quicky/games/spin-bottle/leave', {
      method: 'POST',
      body: JSON.stringify({ roomId: joinA.body.roomId }),
    })
    if (r.status !== 409) return r
    await new Promise((res) => setTimeout(res, 1200))
  }
  return { status: 0 }
}
await leaveWithRetry(Aa)
await leaveWithRetry(Bb)
const roomGone = await db.spinRoom.findUnique({ where: { id: joinA.body.roomId } })
ok('room deleted after leave', roomGone === null)
const chatAlive = await Aa(`/api/quicky/game-chat/messages?conversationId=${convId}`)
ok('PRIVATE game chat still accessible (§60/§132)', chatAlive.body?.conversationId === convId)
ok('messages intact after room deletion (§145)', (chatAlive.body?.messages?.length ?? 0) > 0)

console.log(`\n═══ RESULT: ${passed} passed, ${failed} failed ═══`)
await db.$disconnect()
process.exit(failed > 0 ? 1 : 0)
