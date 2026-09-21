// Faithful CLIENT-side repro: mirrors src/store/ludo-room.ts EXACTLY —
// SSE 'snapshot' + 'room_event' listeners with the SAME version guards
// (staleGame <, room_event <=, forceNextSnapshot) and the SAME optimistic
// prediction in move(). If the real app breaks for one player, this does.
const BASE = 'http://localhost:3100'
const ALICE = { cookie: 'quicky_session=' + (process.env.SESSION_A ?? ''), id: process.env.USER_A ?? '', name: 'Alice' }
const BOB = { cookie: 'quicky_session=' + (process.env.SESSION_B ?? ''), id: process.env.USER_B ?? '', name: 'Bob' }

// ═══ THE CLIENT (mirror of the store) ═════════════════════════════════════
function makeClient(p) {
  // module-scope runtime (mirrors the store's module controller)
  const ctl = { skew: 0, forceNextSnapshot: false }
  const st = {
    roomId: null,
    game: null,          // snapshot.game
    players: [],
    serverNow: 0,
    movingTokenId: null,
    streamOk: false,
    es: null,
    tick: null,
    turnsSeen: 0,
    lastCurrent: null,
    choices: 0,
    myTurnBeats: 0,
  }

  function applySnapshot(s) {
    if (s.serverNow) ctl.skew = s.serverNow - Date.now()
    // ⛔ same version-regression guard as the store
    const force = ctl.forceNextSnapshot
    ctl.forceNextSnapshot = false
    const prevGame = st.game
    const incomingGame = s.game ?? null
    const staleGame = !force && !!incomingGame && !!prevGame && (incomingGame.version ?? 0) < (prevGame.version ?? 0)
    st.game = staleGame ? prevGame : incomingGame
    st.players = s.players
    st.serverNow = s.serverNow
    trackTurn()
  }

  function onRoomEvent(payload) {
    const incoming = payload?.game ?? null
    if (!incoming) return
    // ⛔ same guard as the store: ignore <=
    if (!st.game) return
    if ((incoming.version ?? 0) <= (st.game.version ?? 0)) return
    st.game = incoming
    trackTurn()
  }

  function trackTurn() {
    const g = st.game
    if (!g) return
    if (g.currentPlayerId !== st.lastCurrent) {
      st.lastCurrent = g.currentPlayerId
      st.turnsSeen++
      console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${p.name} sees turn → ${g.currentPlayerId === ALICE.id ? 'Alice' : g.currentPlayerId === BOB.id ? 'Bob' : g.currentPlayerId} (v${g.version} #${g.turnNumber} dice=${g.dice.value})`)
    }
  }

  function legalMoves(game, meId, dice) {
    const moves = []
    for (const t of game.tokens) {
      if (t.playerId !== meId) continue
      let to
      if (t.state === 'yard' || t.position < 0) { if (dice !== 6) continue; to = 0 }
      else { if (t.state === 'finished') continue; to = t.position + dice; if (to > 56) continue }
      moves.push(t.id)
    }
    return moves
  }

  async function move(tokenId) {
    if (st.movingTokenId) return false
    const game = st.game
    if (!game || game.status !== 'playing') return false
    if (game.currentPlayerId !== p.id) return false
    if (game.dice.value == null) return false
    // ═══ CLIENT-SIDE PREDICTION (same as store) ═══
    const predicted = predictMove(game, p.id, tokenId)
    if (!predicted) return false
    st.movingTokenId = tokenId
    st.game = predicted // optimistic commit BEFORE the network hop
    try {
      const res = await post('/api/quicky/games/ludo/move', { roomId: st.roomId, tokenId, actionId: `drv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` })
      if (res.ok && res.json?.state) {
        st.game = res.json.state // server authority — NO version check (same as store)
        return true
      }
      ctl.forceNextSnapshot = true
      return false
    } catch {
      ctl.forceNextSnapshot = true
      return false
    } finally {
      st.movingTokenId = null
    }
  }

  function predictMove(game, meId, tokenId) {
    // engine moveToken re-implemented minimally (only what affects the turn)
    const dice = game.dice.value
    const token = game.tokens.find((t) => t.id === tokenId)
    if (!token || token.playerId !== meId) return null
    const legal = legalMoves(game, meId, dice)
    if (!legal.includes(tokenId)) return null
    const me = game.players.find((pl) => pl.userId === meId)
    const seatOf = (id) => game.players.find((pl) => pl.userId === id)?.seat ?? -1
    const active = game.players.filter((pl) => ['playing', 'ready', 'disconnected'].includes(pl.status)).sort((a, b) => a.seat - b.seat)
    const idx = active.findIndex((pl) => pl.seat > seatOf(meId))
    const next = idx === -1 ? active[0] : active[idx]
    const now = Date.now()
    return {
      ...game,
      version: game.version + 1,
      lastActionId: `local_${now}`,
      tokens: game.tokens.map((t) => (t.id === tokenId ? { ...t, position: (t.position < 0 ? 0 : t.position + dice), state: (t.position < 0 ? 0 : t.position + dice) === 56 ? 'finished' : (t.position < 0 ? 0 : t.position + dice) >= 51 ? 'home' : 'track' } : t)),
      dice: { value: null, rolledBy: null, rolledAt: null },
      moveDeadlineAt: null,
      turnDeadlineAt: dice === 6 ? now + 1500 : null,
      currentPlayerId: dice === 6 ? meId : next?.userId ?? null,
      turnNumber: dice === 6 ? game.turnNumber : game.turnNumber + 1,
      sixStreak: dice === 6 ? game.sixStreak : 0,
      turnId: dice === 6 ? game.turnId : `turn_${game.turnNumber + 1}_${now.toString(36)}`,
      lastEvent: dice === 6 ? { type: 'extra_turn', playerId: meId } : { type: 'turn_changed', playerId: next?.userId ?? null },
    }
  }

  async function post(path, body) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: p.cookie },
        body: JSON.stringify(body ?? {}),
      })
      const json = await res.json().catch(() => null)
      return { ok: res.ok, status: res.status, json }
    } catch (e) {
      return { ok: false, status: 0, json: null }
    }
  }

  function attach(roomId) {
    st.roomId = roomId
    // Minimal SSE client over fetch (sends the session cookie like a browser)
    const ctl2 = new AbortController()
    void (async () => {
      try {
        const res = await fetch(`${BASE}/api/quicky/games/ludo/stream?roomId=${roomId}`, {
          headers: { cookie: p.cookie, accept: 'text/event-stream' },
          signal: ctl2.signal,
        })
        if (!res.ok || !res.body) { console.log(`${p.name}: stream ${res.status}`); return }
        st.streamOk = true
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        let buf = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          let idx
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, idx)
            buf = buf.slice(idx + 2)
            let event = 'message'
            const dataLines = []
            for (const line of chunk.split('\n')) {
              if (line.startsWith('event: ')) event = line.slice(7).trim()
              else if (line.startsWith('data: ')) dataLines.push(line.slice(6))
            }
            if (dataLines.length === 0) continue
            const data = dataLines.join('\n')
            if (event === 'snapshot') { try { applySnapshot(JSON.parse(data)) } catch {} }
            else if (event === 'room_event') { try { const { payload } = JSON.parse(data); onRoomEvent(payload) } catch {} }
            else if (event === 'room_gone') console.log(`${p.name}: room gone!`)
          }
        }
      } catch {}
      st.streamOk = false
    })()
    // recovery poll while the stream is down (same as the store)
    setInterval(async () => {
      if (st.streamOk || !st.roomId) return
      try {
        const res = await fetch(`${BASE}/api/quicky/games/ludo/room?roomId=${st.roomId}`, { headers: { cookie: p.cookie } })
        if (res.ok) { const j = await res.json(); if (j?.snapshot) applySnapshot(j.snapshot) }
      } catch {}
    }, 3000)
    // 3s keepalive tick (same as the store)
    st.tick = setInterval(() => void post('/api/quicky/games/ludo/tick', { roomId }).catch(() => {}), 3000)
  }

  return { st, attach, move, legalMoves }
}

// react loop: each client checks every 700ms and moves like a human (after reveal beat)
async function reactLoop(client, p) {
  setInterval(() => {
    const g = client.st.game
    if (!g || g.status !== 'playing') return
    if (g.currentPlayerId !== p.id) return
    if (g.dice.value == null) return
    const legal = client.legalMoves(g, p.id, g.dice.value)
    if (legal.length === 0) return
    client.st.choices++
    const pick = legal[Math.floor(Math.random() * legal.length)]
    void client.move(pick)
  }, 700)
}

// ═══ THE SESSION ═══════════════════════════════════════════════════════════
const t0 = Date.now()
async function main() {
  const mode = process.argv[2] === '4' ? 4 : 2
  const maxMs = Number(process.argv[3] ?? 120000)
  const a = makeClient(ALICE)
  const b = makeClient(BOB)
  const ja = await (await fetch(`${BASE}/api/quicky/games/ludo/join`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: ALICE.cookie }, body: JSON.stringify({ mode }) })).json()
  const jb = await (await fetch(`${BASE}/api/quicky/games/ludo/join`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: BOB.cookie }, body: JSON.stringify({ mode }) })).json()
  if (!ja?.ok || !jb?.ok) { console.log('join failed', ja, jb); return }
  console.log(`Alice room ${ja.roomId} | Bob room ${jb.roomId} ${ja.roomId !== jb.roomId ? '!! DIFFERENT ROOMS' : ''}`)
  a.attach(ja.roomId)
  b.attach(jb.roomId)
  reactLoop(a, ALICE)
  reactLoop(b, BOB)

  await new Promise((r) => setTimeout(r, maxMs))
  console.log(`\n—— ${p => p} REPORT ——`)
  for (const [c, p] of [[a, ALICE], [b, BOB]]) {
    console.log(`${p.name}: turnsSeen=${c.st.turnsSeen} choices(polls)=${c.st.choices} lastCurrent=${c.st.lastCurrent === ALICE.id ? 'Alice' : c.st.lastCurrent === BOB.id ? 'Bob' : c.st.lastCurrent} localV=${c.st.game?.version} currentPlayer=${c.st.game?.currentPlayerId === ALICE.id ? 'Alice' : c.st.game?.currentPlayerId === BOB.id ? 'Bob' : c.st.game?.currentPlayerId} status=${c.st.game?.status}`)
  }
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
