// Live 2-player Ludo repro: drives the REAL API end-to-end (join → countdown
// → auto-rolls → moves) exactly like two phones. Logs every turn transition
// and who got choices. Detects "one player hogs every turn".

const BASE = 'http://localhost:3100'
const ALICE = { cookie: 'quicky_session=' + (process.env.SESSION_A ?? ''), id: process.env.USER_A ?? '', name: 'Alice' }
const BOB = { cookie: 'quicky_session=' + (process.env.SESSION_B ?? ''), id: process.env.USER_B ?? '', name: 'Bob' }

const legalMovesCache = new Map()

async function post(p, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: p.cookie },
    body: JSON.stringify(body ?? {}),
  })
  const text = await res.text()
  try { return { status: res.status, json: JSON.parse(text) } } catch { return { status: res.status, json: null, text } }
}

function legalMoves(game, playerId, dice) {
  // mirror of engine getLegalMoves for the driver
  const moves = []
  for (const t of game.tokens) {
    if (t.playerId !== playerId) continue
    let to
    if (t.state === 'yard' || t.position < 0) {
      if (dice !== 6) continue
      to = 0
    } else {
      if (t.state === 'finished') continue
      to = t.position + dice
      if (to > 56) continue
    }
    moves.push(t.id)
  }
  return moves
}

async function main() {
  const mode = process.argv[2] === '4' ? 4 : 2
  console.log(`— join (mode ${mode}) —`)
  const a = await post(ALICE, '/api/quicky/games/ludo/join', { mode })
  const b = await post(BOB, '/api/quicky/games/ludo/join', { mode })
  if (!a.json?.ok || !b.json?.ok) { console.log('join failed', a.status, b.status, a.json, b.json); return }
  const roomIdA = a.json.roomId
  const roomIdB = b.json.roomId
  console.log(`Alice room ${roomIdA} seat ${a.json.snapshot?.me?.seatIndex} | Bob room ${roomIdB} seat ${b.json.snapshot?.me?.seatIndex}`)
  if (roomIdA !== roomIdB) { console.log('!! players landed in DIFFERENT rooms'); return }

  const turns = { [ALICE.id]: 0, [BOB.id]: 0 }
  const choices = { [ALICE.id]: 0, [BOB.id]: 0 }
  const rolls = { [ALICE.id]: 0, [BOB.id]: 0 }
  let lastCurrent = null
  let lastVersion = 0
  let movesSent = 0
  let errors = 0
  const t0 = Date.now()
  const MAX_MS = Number(process.argv[3] ?? 150_000)

  // per-player tick loop (mirrors the 3s client keepalive)
  for (const p of [ALICE, BOB]) {
    setInterval(() => void post(p, '/api/quicky/games/ludo/tick', { roomId: roomIdA }).catch(() => {}), 3000)
  }

  while (Date.now() - t0 < MAX_MS) {
    await new Promise((r) => setTimeout(r, 900))
    for (const p of [ALICE, BOB]) {
      const res = await fetch(`${BASE}/api/quicky/games/ludo/room?roomId=${roomIdA}`, { headers: { cookie: p.cookie } })
      if (!res.ok) { console.log(`room poll ${p.name} → ${res.status}`); continue }
      const snap = (await res.json())?.snapshot
      const game = snap?.game
      if (!game) continue
      if (game.currentPlayerId !== lastCurrent) {
        lastCurrent = game.currentPlayerId
        const who = game.currentPlayerId === ALICE.id ? 'Alice' : game.currentPlayerId === BOB.id ? 'Bob' : String(game.currentPlayerId)
        turns[game.currentPlayerId] = (turns[game.currentPlayerId] ?? 0) + 1
        console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] turn → ${who} (v${game.version}, turn #${game.turnNumber}, dice=${game.dice.value})`)
      }
      if (game.lastRoll && game.version > lastVersion) {
        rolls[game.lastRoll.playerId] = (rolls[game.lastRoll.playerId] ?? 0) + 1
        lastVersion = game.version
      }
      if (game.status === 'finished') { console.log('GAME FINISHED, winner:', game.winnerId); return report() }
      // my move?
      if (game.status === 'playing' && game.currentPlayerId === p.id && game.dice.value != null) {
        const legal = legalMoves(game, p.id, game.dice.value)
        if (legal.length > 0) {
          choices[p.id] = (choices[p.id] ?? 0) + 1
          // react like a human after the reveal beat
          const pick = legal[Math.floor(Math.random() * legal.length)]
          const mv = await post(p, '/api/quicky/games/ludo/move', { roomId: roomIdA, tokenId: pick, actionId: `drv_${Date.now()}_${p.name}` })
          movesSent++
          if (!mv.json?.ok) { errors++; console.log(`  !! move rejected ${p.name} ${mv.status} ${JSON.stringify(mv.json)}`) }
        }
      }
    }
  }
  report()

  function report() {
    console.log('\n—— REPORT ——')
    console.log(`moves sent: ${movesSent}, rejected: ${errors}`)
    for (const id of [ALICE.id, BOB.id]) {
      console.log(`${id === ALICE.id ? 'Alice' : 'Bob'}: turns=${turns[id] ?? 0} rolls=${rolls[id] ?? 0} choices=${choices[id] ?? 0}`)
    }
    process.exit(0)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
