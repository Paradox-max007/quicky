// 4P table smoke test: four players join mode 4, countdown, rotation.
const BASE = 'http://localhost:3100'
const P = (name, cookie, id) => ({ name, cookie, id })
const ALICE = P('Alice', '42b7e01323a8cacf7fd86770913f5ec4fe83f3fcadc377a7', 'cmuazoc9s0000w2wkyczgq1sb')
const BOB = P('Bob', '6500e45b53e29e076d3de133c862d54287c55d88f51b3ef2', 'cmuazoc9y0003w2wkeo2u3u1v')
const CARA = P('Cara', 'e9c4cf5a7852f874d18c15f5f7108c4b16b0b27dfebf5b3b', 'cmub10fmx0000w2m138l3xjsq')
const DAN = P('Dan', 'd30a1fe28a73fd0847cb766e1d45af24d12253d71de69b45', 'cmub10fn50003w2m1a5vtxqaq')

async function join(p) {
  const res = await fetch(`${BASE}/api/quicky/games/ludo/join`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: `quicky_session=${p.cookie}` }, body: JSON.stringify({ mode: 4 }),
  })
  return res.json()
}
async function room(p, roomId) {
  const res = await fetch(`${BASE}/api/quicky/games/ludo/room?roomId=${roomId}`, { headers: { cookie: `quicky_session=${p.cookie}` } })
  return res.ok ? (await res.json()).snapshot : null
}

async function main() {
  const a = await join(ALICE)
  const b = await join(BOB)
  const c = await join(CARA)
  const d = await join(DAN)
  const ids = new Set([a.roomId, b.roomId, c.roomId, d.roomId])
  console.log(`rooms: ${[...ids].join(' ')} — all same: ${ids.size === 1}`)
  const roomId = a.roomId
  await new Promise((r) => setTimeout(r, 5000))
  let snap = await room(ALICE, roomId)
  console.log(`after countdown: room=${snap?.status} game=${snap?.game?.status} seats=${snap?.game?.players.map((p) => p.seat).join(',')} current=${snap?.game?.players.find((p) => p.userId === snap?.game?.currentPlayerId)?.displayName}`)
  // watch 30s of rotation with no moves (auto-pass cycles)
  const seen = []
  let last = snap?.game?.currentPlayerId
  const t0 = Date.now()
  while (Date.now() - t0 < 35000) {
    for (const p of [ALICE, BOB, CARA, DAN]) {
      await fetch(`${BASE}/api/quicky/games/ludo/tick`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: `quicky_session=${p.cookie}` }, body: JSON.stringify({ roomId }) }).catch(() => {})
    }
    await new Promise((r) => setTimeout(r, 2500))
    snap = await room(ALICE, roomId)
    const cur = snap?.game?.currentPlayerId
    if (cur && cur !== last) {
      seen.push(snap?.game?.players.find((pl) => pl.userId === cur)?.displayName ?? cur)
      last = cur
    }
  }
  console.log(`rotation observed (35s, no moves): ${seen.join(' → ')}`)
  const distinct = new Set(seen)
  console.log(`distinct players who got turns: ${distinct.size}/4`)
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
