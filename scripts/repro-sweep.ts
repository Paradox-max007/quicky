// GHOST SWEEP live test: kill Bob's member row directly in the DB (simulates
// endOtherMemberships / a crash that never called leave), then verify the
// game heals: ghost's tokens removed, turn advances, room de-zombied.
const BASE = 'http://localhost:3100'
const ALICE = { cookie: 'quicky_session=' + (process.env.SESSION_A ?? ''), id: process.env.USER_A ?? '', name: 'Alice' }
const BOB = { cookie: 'quicky_session=' + (process.env.SESSION_B ?? ''), id: process.env.USER_B ?? '', name: 'Bob' }

async function post(p, path, body) {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: p.cookie }, body: JSON.stringify(body ?? {}) })
  return { status: res.status, json: await res.json().catch(() => null) }
}
async function room(p, roomId) {
  const res = await fetch(`${BASE}/api/quicky/games/ludo/room?roomId=${roomId}`, { headers: { cookie: p.cookie } })
  return res.ok ? (await res.json()).snapshot : null
}

async function main() {
  const a = await post(ALICE, '/api/quicky/games/ludo/join', { mode: 2 })
  const b = await post(BOB, '/api/quicky/games/ludo/join', { mode: 2 })
  const roomId = a.json.roomId
  if (roomId !== b.json.roomId) { console.log('!! different rooms'); return }
  await new Promise((r) => setTimeout(r, 4500))
  let snap = await room(ALICE, roomId)
  console.log(`game: ${snap?.status}/${snap?.game?.status} current=${snap?.game?.currentPlayerId === BOB.id ? 'Bob' : 'Alice'} players=${snap?.game?.players.length}`)
  // let some turns pass
  await new Promise((r) => setTimeout(r, 12000))

  // 💀 Kill Bob's membership row directly (the ghost-creation path)
  const { execSync } = await import('node:child_process')
  execSync(`/home/z/my-project/pg/postgresql-16.4.0-x86_64-unknown-linux-gnu/bin/psql -h /tmp -p 5433 -U postgres -d quicky -c "UPDATE \\\"SpinRoomPlayer\\\" SET \\\"leftAt\\\" = now(), \\\"isActive\\\" = false WHERE \\\"roomId\\\" = '${roomId}' AND \\\"userId\\\" = '${BOB.id}'"`)
  console.log('\n— Bob membership row hard-killed in DB (no leave route) —')

  // Alice's ticks should heal the room within seconds
  for (let i = 0; i < 8; i++) {
    await post(ALICE, '/api/quicky/games/ludo/tick', { roomId })
    await new Promise((r) => setTimeout(r, 2500))
    snap = await room(ALICE, roomId)
    const g = snap?.game
    console.log(`t+${(i + 1) * 2.5 | 0}s: room=${snap?.status} game=${g?.status} inGamePlayers=${g?.players.map((p) => `${p.userId === BOB.id ? 'B' : 'A'}:${p.status}`).join(',')} tokens=${g?.tokens.length} current=${g?.currentPlayerId === BOB.id ? 'Bob' : g?.currentPlayerId === ALICE.id ? 'Alice' : g?.currentPlayerId}`)
    if (g?.status !== 'playing') break
  }
  const healed = snap?.game?.players.every((p) => p.userId !== BOB.id || p.status === 'left')
  console.log(`\nghost removed from game state: ${healed}`)
  console.log(`room de-zombied (WAITING so a new player can join): ${snap?.status === 'WAITING'}`)
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
