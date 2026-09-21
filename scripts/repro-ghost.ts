// Repro the GHOST path: A+B play, B re-runs join mid-game (app restart /
// landing → Play Now). Watch the turn rotation & room states.
const BASE = 'http://localhost:3100'
const ALICE = { cookie: 'quicky_session=' + (process.env.SESSION_A ?? ''), id: process.env.USER_A ?? '', name: 'Alice' }
const BOB = { cookie: 'quicky_session=' + (process.env.SESSION_B ?? ''), id: process.env.USER_B ?? '', name: 'Bob' }

async function post(p, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: p.cookie }, body: JSON.stringify(body ?? {}),
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

async function room(p, roomId) {
  const res = await fetch(`${BASE}/api/quicky/games/ludo/room?roomId=${roomId}`, { headers: { cookie: p.cookie } })
  return res.ok ? (await res.json()).snapshot : null
}

async function main() {
  // 1. Join and start
  const a = await post(ALICE, '/api/quicky/games/ludo/join', { mode: 2 })
  const b = await post(BOB, '/api/quicky/games/ludo/join', { mode: 2 })
  const roomId = a.json.roomId
  console.log(`room ${roomId}, same=${a.json.roomId === b.json.roomId}`)
  await new Promise((r) => setTimeout(r, 4500)) // countdown + start
  let snap = await room(ALICE, roomId)
  console.log(`game started: status=${snap?.status} game=${snap?.game?.status} current=${snap?.game?.currentPlayerId === BOB.id ? 'Bob' : 'Alice'}`)

  // 2. Let a few turns pass
  for (let i = 0; i < 12; i++) {
    await post(ALICE, '/api/quicky/games/ludo/tick', { roomId })
    await post(BOB, '/api/quicky/games/ludo/tick', { roomId })
    await new Promise((r) => setTimeout(r, 2000))
  }
  snap = await room(ALICE, roomId)
  const seq = []
  for (let i = 0; i < 10; i++) {
    const cur = snap?.game?.currentPlayerId
    seq.push(cur === ALICE.id ? 'A' : cur === BOB.id ? 'B' : '?')
    await post(ALICE, '/api/quicky/games/ludo/tick', { roomId })
    await new Promise((r) => setTimeout(r, 2100))
    snap = await room(ALICE, roomId)
  }
  console.log(`turn sequence (2.1s samples): ${seq.join(' ')}`)

  // 3. BOB RE-JOINS mid-game (app restart path)
  console.log('\n— Bob re-runs join mid-game —')
  const bj = await post(BOB, '/api/quicky/games/ludo/join', { mode: 2 })
  console.log(`Bob join → room ${bj.json?.roomId} (same: ${bj.json?.roomId === roomId}) createdNew=${bj.json?.createdNewRoom}`)
  if (bj.json?.roomId !== roomId) {
    const bs = await room(BOB, bj.json.roomId)
    console.log(`Bob's NEW room: status=${bs?.status} players=${bs?.players?.length}`)
  }
  snap = await room(ALICE, roomId)
  console.log(`ORIGINAL room for Alice: roomStatus=${snap?.status} gameStatus=${snap?.game?.status} players=${snap?.players?.map((p) => `${p.displayName}:${p.inGame}`).join(',')}`)

  // 4. Watch turn rotation in the original room for 40s
  const seq2 = []
  let lastCur = snap?.game?.currentPlayerId
  let switches = 0
  const t0 = Date.now()
  while (Date.now() - t0 < 40000) {
    await post(ALICE, '/api/quicky/games/ludo/tick', { roomId })
    await new Promise((r) => setTimeout(r, 2000))
    snap = await room(ALICE, roomId)
    const cur = snap?.game?.currentPlayerId
    if (cur !== lastCur) {
      switches++
      seq2.push(`${(Date.now() - t0) / 1000 | 0}s:${cur === ALICE.id ? 'A' : cur === BOB.id ? 'B' : '?'}`)
      lastCur = cur
    }
  }
  console.log(`turn switches after Bob rejoin: ${switches} → ${seq2.join(' ')}`)
  console.log(`final: roomStatus=${snap?.status} gameStatus=${snap?.game?.status} current=${snap?.game?.currentPlayerId === ALICE.id ? 'A' : snap?.game?.currentPlayerId === BOB.id ? 'B' : snap?.game?.currentPlayerId}`)
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
