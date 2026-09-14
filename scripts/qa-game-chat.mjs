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

// ── Setup: four users + one admin ────────────────────────────────────────────
const A = await login('+15555550201')
const B = await login('+15555550202')
const C = await login('+15555550203')
const D = await login('+15555550204')
const admin = await login('+15555550000')

// Idempotency: wipe THIS QA trio's game-chat state so re-runs start clean
// (conversations are keyed by the canonical user pair, so leftover rows from
// a previous run would otherwise pollute counts).
{
  const ids = [A.userId, B.userId, C.userId, D.userId]
  const convos = await db.gameConversation.findMany({
    where: { OR: [{ userAId: { in: ids } }, { userBId: { in: ids } }] },
    select: { id: true },
  })
  await db.gameConversation.deleteMany({ where: { id: { in: convos.map((c) => c.id) } } })
  await db.gameConversationMember.deleteMany({ where: { userId: { in: ids } } })
  await db.gameStickerBundle.deleteMany({ where: { name: { startsWith: 'QA ' } } })
  // previous-run purchases would make the "un-owned sticker" test pass falsely
  await db.userGameStickerBundle.deleteMany({ where: { userId: { in: ids } } })
  // fresh Quicky economy for the quicky_image tests (§71/§77)
  await db.user.update({ where: { id: A.userId }, data: { quickyScore: 0 } })
  await db.gameQuickyStreak.deleteMany({ where: { userId: { in: ids } } })
  // QA users persist across runs — refill coins so the purchase test is
  // deterministic regardless of how many previous runs bought bundles.
  await db.user.updateMany({ where: { id: { in: ids } }, data: { coinBalance: 5000 } })
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
// Bulk history goes straight through the DB (the API path is covered by the
// other tests; the flood would trip the §120 rate limiter, which has its own
// dedicated test at the end).
const bulkRows = []
for (let i = 0; i < 45; i++) {
  bulkRows.push({
    conversationId: convId,
    senderId: i % 2 === 0 ? A.userId : B.userId,
    messageType: 'text',
    text: `bulk ${i}`,
    createdAt: new Date(Date.now() + (i + 1) * 1000),
  })
}
await db.gameMessage.createMany({ data: bulkRows })
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

// ── Test 12 (bug-fix PRD §29-§38/§99-§106): deadline authority + codes ──────
console.log('\nTest 12 — server deadline authority + specific error codes')
const joinA2 = await Aa('/api/quicky/games/spin-bottle/join', { method: 'POST' })
const joinB2 = await Bb('/api/quicky/games/spin-bottle/join', { method: 'POST' })
ok('round 2: both in one room', joinA2.body?.ok && joinB2.body?.roomId === joinA2.body?.roomId)
let awaiting2 = null
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 700))
  const snap = await Aa(`/api/quicky/games/spin-bottle/room?roomId=${joinA2.body.roomId}`)
  const spin = snap.body?.snapshot?.currentSpin
  if (spin?.status === 'awaiting' && spin.spinnerId && spin.targetId) { awaiting2 = spin; break }
}
ok('round 2 reached awaiting', !!awaiting2)
if (awaiting2) {
  // §30/§33: past the authoritative deadline → ROUND_EXPIRED (not a generic
  // "already resolved"), while the round is still technically awaiting.
  await db.spinBottleSpin.update({
    where: { id: awaiting2.id },
    data: { responseDeadline: new Date(Date.now() - 150) },
  })
  const targetSession = awaiting2.targetId === B.userId ? Bb : Aa
  const late = await targetSession('/api/quicky/games/spin-bottle/respond', {
    method: 'POST',
    body: JSON.stringify({ roomId: joinA2.body.roomId, choice: 'yes' }),
  })
  ok('expired response → ROUND_EXPIRED code (§102)', late.status === 410 && late.body?.error === 'ROUND_EXPIRED', JSON.stringify(late.body))

  // §101/§102: outsider gets the SPECIFIC NOT_TARGET code.
  const notTarget = await Cc('/api/quicky/games/spin-bottle/respond', {
    method: 'POST',
    body: JSON.stringify({ roomId: joinA2.body.roomId, choice: 'yes' }),
  })
  ok('outsider → NOT_TARGET code (§102)', notTarget.status === 403 && notTarget.body?.error === 'NOT_TARGET', JSON.stringify(notTarget.body))

  // Wait out the watchdog (+grace) and the RESULT pause; the next round opens.
  let awaiting3 = null
  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 700))
    const snap = await Aa(`/api/quicky/games/spin-bottle/room?roomId=${joinA2.body.roomId}`)
    const spin = snap.body?.snapshot?.currentSpin
    if (spin?.status === 'awaiting' && spin.spinnerId && spin.targetId && spin.id !== awaiting2.id) { awaiting3 = spin; break }
  }
  ok('next round opened after timeout resolve', !!awaiting3)
  if (awaiting3) {
    // §35/§141: a response that reaches the server BEFORE the deadline is
    // ACCEPTED even with a sliver of time left (last-moment tap).
    await db.spinBottleSpin.update({
      where: { id: awaiting3.id },
      data: { responseDeadline: new Date(Date.now() + 250) },
    })
    const tSession = awaiting3.targetId === B.userId ? Bb : Aa
    const lastMoment = await tSession('/api/quicky/games/spin-bottle/respond', {
      method: 'POST',
      body: JSON.stringify({ roomId: joinA2.body.roomId, choice: 'yes' }),
    })
    ok('last-moment response ACCEPTED (§35/§141)', lastMoment.body?.ok === true, JSON.stringify(lastMoment.body))
    // §102: a second tap from the SAME player is ALREADY_RESPONDED.
    const again = await tSession('/api/quicky/games/spin-bottle/respond', {
      method: 'POST',
      body: JSON.stringify({ roomId: joinA2.body.roomId, choice: 'no' }),
    })
    ok('double tap → ALREADY_RESPONDED code (§102/§142)', again.status === 409 && again.body?.error === 'ALREADY_RESPONDED', JSON.stringify(again.body))
    // §37/§139: the OTHER party answers → the round resolves IMMEDIATELY
    // (second responder's reply carries outcome 'resolved').
    const oSession = awaiting3.spinnerId === A.userId ? Aa : Bb
    const second = await oSession('/api/quicky/games/spin-bottle/respond', {
      method: 'POST',
      body: JSON.stringify({ roomId: joinA2.body.roomId, choice: 'yes' }),
    })
    ok('both answered → resolves immediately (§37/§139)', second.body?.ok === true && second.body?.outcome === 'resolved', JSON.stringify(second.body))
  }
  // Cleanup: leave (retry while the round lock holds).
  const leave2 = async (sessionApi) => {
    for (let i = 0; i < 25; i++) {
      const r = await sessionApi('/api/quicky/games/spin-bottle/leave', {
        method: 'POST',
        body: JSON.stringify({ roomId: joinA2.body.roomId }),
      })
      if (r.status !== 409) return r
      await new Promise((res) => setTimeout(res, 1200))
    }
    return { status: 0 }
  }
  await leave2(Aa)
  await leave2(Bb)
}

// ── Test 13 (bug-fix PRD §56-§80/§116-§118/§147-§149): media + Quicky ──────
console.log('\nTest 13 — image/voice/Quicky messaging + points + streak')
const img = await Aa('/api/quicky/game-chat/messages', {
  method: 'POST',
  body: JSON.stringify({ conversationId: convId, messageType: 'image', mediaUrl: '/uploads/gc_qa_test.png', clientMessageId: `qa_${Date.now()}_img` }),
})
ok('image message accepted (§56)', img.body?.ok === true, JSON.stringify(img.body))
ok('image carries storage reference (§58)', img.body?.message?.mediaUrl === '/uploads/gc_qa_test.png')
const evil = await Aa('/api/quicky/game-chat/messages', {
  method: 'POST',
  body: JSON.stringify({ conversationId: convId, messageType: 'image', mediaUrl: 'https://evil.example/x.png', clientMessageId: `qa_${Date.now()}_evil` }),
})
ok('external media URL rejected (§117)', evil.status === 400, `got ${evil.status}`)
const voiceNoDur = await Aa('/api/quicky/game-chat/messages', {
  method: 'POST',
  body: JSON.stringify({ conversationId: convId, messageType: 'voice', mediaUrl: '/uploads/gc_qa_voice.webm', clientMessageId: `qa_${Date.now()}_v0` }),
})
ok('voice without duration rejected (§66)', voiceNoDur.status === 400, `got ${voiceNoDur.status}`)
const voice = await Aa('/api/quicky/game-chat/messages', {
  method: 'POST',
  body: JSON.stringify({ conversationId: convId, messageType: 'voice', mediaUrl: '/uploads/gc_qa_voice.webm', mediaDuration: 2500, clientMessageId: `qa_${Date.now()}_v1` }),
})
ok('voice message accepted (§63)', voice.body?.ok === true, JSON.stringify(voice.body))
ok('voice duration stored (§65)', voice.body?.message?.mediaDuration === 2500)
// §83: media reply previews are compact per-type references
const replyImg = await Bb('/api/quicky/game-chat/messages', {
  method: 'POST',
  body: JSON.stringify({ conversationId: convId, messageType: 'text', text: 'nice pic', replyToMessageId: img.body?.message?.id, clientMessageId: `qa_${Date.now()}_ri` }),
})
ok('reply to image previews as 🖼 (§83)', replyImg.body?.message?.replyTo?.text === '🖼 Image', JSON.stringify(replyImg.body?.message?.replyTo))

// §70-§79: Quicky Image — points + streak, exactly once (§147/§148)
const scoreBefore = (await db.user.findUnique({ where: { id: A.userId } })).quickyScore
const q1 = await Aa('/api/quicky/game-chat/messages', {
  method: 'POST',
  body: JSON.stringify({ conversationId: convId, messageType: 'quicky_image', mediaUrl: '/uploads/gc_qa_quicky.png', clientMessageId: `qa_${Date.now()}_q1` }),
})
ok('quicky image accepted (§69)', q1.body?.ok === true)
const scoreMid = (await db.user.findUnique({ where: { id: A.userId } })).quickyScore
ok('sender Quicky Points +10 server-side (§71/§72)', scoreMid === scoreBefore + 10, `${scoreBefore} -> ${scoreMid}`)
const qEvent = await db.quickyEvent.findFirst({ where: { senderId: A.userId, eventType: 'sent', pointsAwarded: 10 }, orderBy: { createdAt: 'desc' } })
ok('QuickyEvent ledger row written (§70)', !!qEvent)
const streak1 = await db.gameQuickyStreak.findUnique({ where: { userId: A.userId } })
ok('streak started at 1 (§77/§78)', streak1?.currentStreak === 1, JSON.stringify(streak1))
// same-day second quicky: points accumulate, streak does NOT double
const q2Cmi = `qa_${Date.now()}_q2`
const q2 = await Aa('/api/quicky/game-chat/messages', {
  method: 'POST',
  body: JSON.stringify({ conversationId: convId, messageType: 'quicky_image', mediaUrl: '/uploads/gc_qa_quicky2.png', clientMessageId: q2Cmi }),
})
ok('second quicky accepted', q2.body?.ok === true)
const scoreAfter = (await db.user.findUnique({ where: { id: A.userId } })).quickyScore
ok('each valid quicky awards points once (§71)', scoreAfter === scoreMid + 10, `${scoreMid} -> ${scoreAfter}`)
const streak2 = await db.gameQuickyStreak.findUnique({ where: { userId: A.userId } })
ok('same-day streak does NOT double (§78)', streak2?.currentStreak === 1 && streak2?.totalQuickyImages === 2, JSON.stringify(streak2))
// §148: duplicate retry with the SAME clientMessageId → no double award
const q2Retry = await Aa('/api/quicky/game-chat/messages', {
  method: 'POST',
  body: JSON.stringify({ conversationId: convId, messageType: 'quicky_image', mediaUrl: '/uploads/gc_qa_quicky2.png', clientMessageId: q2Cmi }),
})
ok('quicky retry idempotent on message (§92)', q2Retry.body?.message?.id === q2.body?.message?.id)
const scoreRetry = (await db.user.findUnique({ where: { id: A.userId } })).quickyScore
ok('retry does NOT double points/streak (§148)', scoreRetry === scoreAfter)

// ── Test 14 (bug-fix PRD §120): rate limiting (dedicated user, last) ────────
console.log('\nTest 14 — message rate limiting')
let hit429 = false
for (let i = 0; i < 35; i++) {
  const r = await api(D.cookie)('/api/quicky/game-chat/messages', {
    method: 'POST',
    body: JSON.stringify({ peerUserId: A.userId, messageType: 'text', text: `spam ${i}`, clientMessageId: `qa_spam_${Date.now()}_${i}` }),
  })
  if (r.status === 429) { hit429 = true; break }
}
ok('flood beyond the window is throttled (§120)', hit429)
// cleanup the spam conversation
{
  const ids = [A.userId, D.userId]
  const convos = await db.gameConversation.findMany({
    where: { OR: [{ userAId: { in: ids } }, { userBId: { in: ids } }] },
    select: { id: true },
  })
  await db.gameConversation.deleteMany({ where: { id: { in: convos.map((c) => c.id) } } })
  await db.gameConversationMember.deleteMany({ where: { userId: { in: ids } } })
}

console.log(`\n═══ RESULT: ${passed} passed, ${failed} failed ═══`)
await db.$disconnect()
process.exit(failed > 0 ? 1 : 0)
