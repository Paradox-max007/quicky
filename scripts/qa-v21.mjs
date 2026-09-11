// QA script — PRD v2.1: both-answer-early immediate resolve + chat purity
// Luna = +15555550101, Leo = +15555550107 (both usually seated in dev room)
const BASE = 'http://localhost:3000'

async function otpLogin(phone) {
  const r = await fetch(`${BASE}/api/quicky/auth/otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone }),
  })
  const j = await r.json()
  const v = await fetch(`${BASE}/api/quicky/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, code: j.demoCode }),
  })
  const cookie = v.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  const me = await v.json()
  return { cookie, user: me.user ?? me }
}

async function post(cookie, url, body) {
  const r = await fetch(`${BASE}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify(body ?? {}),
  })
  return { status: r.status, json: await r.json().catch(() => null) }
}

async function get(cookie, url) {
  const r = await fetch(`${BASE}${url}`, { headers: { cookie } })
  return { status: r.status, json: await r.json().catch(() => null) }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const luna = await otpLogin('+15555550101')
  const leo = await otpLogin('+15555550107')
  console.log('Luna:', luna.user?.name, '| Leo:', leo.user?.name)

  // Idempotent (re)join — returns current room
  const lj = await post(luna.cookie, '/api/quicky/games/spin-bottle/join')
  console.log('Luna join ->', lj.status, 'room', lj.json?.roomId?.slice(-5))
  const roomId = lj.json.roomId
  await post(leo.cookie, '/api/quicky/games/spin-bottle/join')

  // Wait until a round is awaiting responses
  let spin = null
  for (let i = 0; i < 40; i++) {
    const s = (await get(luna.cookie, `/api/quicky/games/spin-bottle/room?roomId=${roomId}`)).json.snapshot
    if (s.currentSpin?.status === 'awaiting') { spin = s.currentSpin; break }
    if (s.currentSpin?.status === 'spinning') { /* wait for landing */ }
    await sleep(500)
  }
  if (!spin) { console.log('!! no awaiting round observed'); return }
  console.log('awaiting spin', spin.id.slice(-6), 'deadline in',
    Math.round((new Date(spin.responseDeadline) - Date.now()) / 1000) + 's')

  // §77: both answer early → resolve immediately
  const t0 = Date.now()
  const r1 = await post(luna.cookie, '/api/quicky/games/spin-bottle/respond', { roomId, choice: 'yes' })
  console.log('Luna respond ->', r1.status, r1.json?.outcome ?? r1.json?.error, `(t+${Date.now() - t0}ms)`)
  const r2 = await post(leo.cookie, '/api/quicky/games/spin-bottle/respond', { roomId, choice: 'yes' })
  console.log('Leo respond  ->', r2.status, r2.json?.outcome ?? r2.json?.error, `(t+${Date.now() - t0}ms)`)

  const t1 = Date.now()
  let completed = false
  for (let i = 0; i < 8; i++) {
    const s = (await get(luna.cookie, `/api/quicky/games/spin-bottle/room?roomId=${roomId}`)).json.snapshot
    if (s.currentSpin?.status === 'completed') {
      const leftMs = new Date(s.currentSpin.responseDeadline) - Date.now()
      console.log(`✓ RESOLVED ${Date.now() - t1}ms after 2nd respond | result=${s.currentSpin.result} | deadline had ${Math.round(leftMs / 1000)}s left`)
      completed = true
      break
    }
    await sleep(200)
  }
  if (!completed) console.log('✗ NOT RESOLVED EARLY — BUG')

  // §89 race: fresh round, near-simultaneous responses → one result, one point tx each
  await sleep(4500) // result pause + next spin
  let spin2 = null
  for (let i = 0; i < 40; i++) {
    const s = (await get(luna.cookie, `/api/quicky/games/spin-bottle/room?roomId=${roomId}`)).json.snapshot
    if (s.currentSpin?.status === 'awaiting') { spin2 = s.currentSpin; break }
    await sleep(500)
  }
  if (spin2) {
    console.log('race round', spin2.id.slice(-6))
    const [a, b] = await Promise.all([
      post(luna.cookie, '/api/quicky/games/spin-bottle/respond', { roomId, choice: 'no' }),
      post(leo.cookie, '/api/quicky/games/spin-bottle/respond', { roomId, choice: 'yes' }),
    ])
    console.log('race: Luna ->', a.status, a.json?.outcome ?? a.json?.error, '| Leo ->', b.status, b.json?.outcome ?? b.json?.error)
    await sleep(400)
    const s = (await get(luna.cookie, `/api/quicky/games/spin-bottle/room?roomId=${roomId}`)).json.snapshot
    console.log('race result:', s.currentSpin?.status, s.currentSpin?.result)
    const players = s.players.map((p) => `${p.displayName}:${p.kissPoints}`).join(' ')
    console.log('kiss points:', players)
  }

  // Chat purity: only user/join/leave rows
  const chatSnap = (await get(luna.cookie, `/api/quicky/games/spin-bottle/room?roomId=${roomId}`)).json.snapshot
  console.log('--- Chat tail:')
  for (const m of chatSnap.recentMessages.slice(-8)) console.log(`  [${m.kind}] ${m.text}`)
  const bad = chatSnap.recentMessages.filter((m) => !['user', 'join', 'leave'].includes(m.kind))
  console.log(bad.length === 0 ? '✓ No game logs in chat' : `✗ ${bad.length} polluted rows`)
}

main().catch((e) => {
  console.error('QA FAILED:', e.message)
  process.exit(1)
})
