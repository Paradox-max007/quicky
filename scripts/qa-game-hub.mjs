// Quicky — GAME HUB QA (Game Hub PRD §93 Definition of Done subset)
// Usage: BASE=http://localhost:3000 bun scripts/qa-game-hub.mjs
//
// Layer 1 (source structure): banner removed, Post rename, animated Games
// entry, DB-driven catalog, game landing, unified chat tabs, in-game dating
// banner, chemistry service — the architecture exists in src.
// Layer 2 (runtime): /api/quicky/games catalog contract (8 seeded games,
// DB-driven fields, honest isPlayable), landing-stats §59/§60/§74 contract,
// 401 handling.
const BASE = process.env.BASE ?? 'http://localhost:3000'
import { readFileSync } from 'fs'

let passed = 0
let failed = 0
const ok = (name, cond) => {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ FAIL: ${name}`) }
}

const src = (rel) => {
  try { return readFileSync(`${process.cwd()}/${rel}`, 'utf8') } catch { return '' }
}
const has = (rel, ...needles) => {
  const s = src(rel)
  return needles.every((n) => s.includes(n))
}

console.log('═══ QA: game hub — source structure ═══')

// ── Community (§4-§7) ────────────────────────────────────────────────────────
const communityMobile = src('src/components/quicky/CommunityScreen.tsx')
ok('mobile community: Spin the Bottle banner REMOVED (§4)', !communityMobile.includes('Spin the Bottle promo card'))
ok('mobile community: New Post renamed to Post (§5)', communityMobile.includes("data-testid=\"community-post\"") && !communityMobile.includes('New Post'))
ok('mobile community: continuously spinning Games entry (§5/§6 + Task 8)', communityMobile.includes('data-testid="community-games"') && communityMobile.includes('qk-icon-spin-slow'))
const communityDesk = src('src/components/quicky/desktop/CommunityDesktop.tsx')
ok('web community: Post + Games buttons, no New Post (§5/§91)', communityDesk.includes("data-testid=\"community-post\"") && communityDesk.includes("data-testid=\"community-games\"") && !communityDesk.includes('New Post'))
ok('icon-only animation exists (§6: not the whole button)', src('src/app/globals.css').includes('@keyframes qk-icon-float'))

// ── Catalog-driven Games screens (§8-§11/§68) ───────────────────────────────
ok('GameDefinition model exists (§11)', has('prisma/schema.prisma', 'model GameDefinition', 'shortDescription', 'supportedModes', 'isPlayable', 'sortOrder'))
ok('games catalog API exists (§11: not hardcoded)', !!src('src/app/api/quicky/games/route.ts'))
ok('mobile Games screen: 2-col grid from DB (§9/§68)', has('src/components/quicky/GamesScreen.tsx', 'grid-cols-2', 'useGames', 'GameCard', 'games-grid'))
ok('mobile Games: empty state (§70)', src('src/components/quicky/GamesScreen.tsx').includes('More games are coming soon'))
ok('desktop Games: featured + DB grid + progression (§67)', has('src/components/quicky/desktop/GamesDesktop.tsx', 'games-featured', 'games-grid', 'games-progress', 'useGames'))
ok('game card: artwork + mode + honest LIVE/SOON (§10/§59)', has('src/components/quicky/game-hub/GameCard.tsx', 'artworkGradient', 'modeLabel', 'LIVE', 'SOON'))
ok('seed covers 8 party games incl. Truth or Dare/Ludo (§91)', (() => {
  const s = src('scripts/seed-game-definitions.mjs')
  return ['spin-the-bottle', 'truth-or-dare', 'ludo', 'party-quiz', 'would-you-rather', 'never-have-i-ever', 'guess-who', 'charades'].every((x) => s.includes(`'${x}'`))
})())

// ── Game landing (§12-§27/§59-§62) ──────────────────────────────────────────
ok('GameLanding exists + spin-bottle dispatch to rich landing (§12)', has('src/components/quicky/game-hub/GameLanding.tsx', 'SpinBottleLanding', 'Your records', 'Your progress', 'Game information'))
ok('landing shows records/progress/chemistry (§59/§60/§74)', has('src/components/quicky/game-hub/GameLanding.tsx', 'Kiss Points', 'Streak', 'Quicky Points', 'League', 'ChemistryIndicator'))
ok('landing: honest coming-soon state (§70)', src('src/components/quicky/game-hub/GameLanding.tsx').includes('COMING SOON'))
ok('mode selector UI for supported modes (§25)', src('src/components/quicky/game-hub/GameLanding.tsx').includes('How do you want to play?'))
ok('spin landing: Play Now + mode chip + progress block (§91)', has('src/components/quicky/SpinBottleLanding.tsx', 'spin-play-now', 'Group · 2–12 players', 'spin-landing-progress'))
ok('matchmaking MODAL with animated progress kept (§7: no loading page)', has('src/components/quicky/SpinBottleLanding.tsx', 'matchmaking-modal', 'matchmaking-progress', "width: ['0%', '94%']"))

// ── Navigation (§7/§29) ─────────────────────────────────────────────────────
ok("store: 'game-landing' view + openGameLanding + chatReturnView", has('src/store/quicky.ts', "| 'game-landing'", 'openGameLanding', 'chatReturnView'))
ok('AppRoot renders GameLanding + UnifiedChatsScreen', has('src/components/quicky/AppRoot.tsx', 'view === \'game-landing\' && <GameLanding />', 'view === \'chats\' && !useDesk && <UnifiedChatsScreen />'))
ok('BottomNav Chats tab opens the unified center', has('src/components/quicky/BottomNav.tsx', "id: 'chats', label: 'Chats'"))
ok('landing reachable full-window on web (§61 full stage)', src('src/components/quicky/AppRoot.tsx').includes("case 'game-landing':"))

// ── Unified Chat Center (§28-§38/§50/§54/§57) ───────────────────────────────
ok('UnifiedChatsScreen: Game|Dating tabs + search + dating rows', has('src/components/quicky/game-hub/UnifiedChatsScreen.tsx', 'ChatTypeTabs', 'DatingContactRows', 'Search game chats', 'Search dating chats'))
ok('shared ChatTypeTabs used by ALL contact surfaces (§34: no duplicates)', (() => {
  const a = src('src/components/quicky/game-chat/GameChatContactsScreen.tsx')
  const b = src('src/components/quicky/game-chat/GameContactsPanel.tsx')
  return a.includes('ChatTypeTabs') && b.includes('ChatTypeTabs')
})())
ok('in-game contacts: dating pick returns to contacts → room (§54/§81)', src('src/components/quicky/game-chat/GameChatContactsScreen.tsx').includes("openChat(matchId, 'game-chat-contacts')"))
ok('web room panel: dating state renders embedded ChatView (§39/§57)', has('src/components/quicky/SpinBottleRoom.tsx', "roomChatPanel === 'dating'", '<ChatView embedded onBack={() => setRoomChatPanel(\'contacts\')} />'))
ok('room panel type widened (§57)', src('src/components/quicky/RoomChatPanel.tsx').includes("'room' | 'contacts' | 'personal' | 'dating'"))
ok('ChatView back honors chatReturnView (§54)', src('src/components/quicky/ChatView.tsx').includes('chatReturnView'))

// ── In-game dating chat (§41-§44/§82) ───────────────────────────────────────
ok('dating unread poller exists (§41: game stays alive)', !!src('src/components/quicky/game-hub/useDatingUnread.ts'))
ok('room shows non-blocking dating banner with Reply (§41/§53)', has('src/components/quicky/SpinBottleRoom.tsx', 'dating-message-banner', 'dating-banner-reply', 'New Dating Message'))
ok('mobile Reply returns to the LIVE room (§82)', src('src/components/quicky/SpinBottleRoom.tsx').includes("openChat(datingUnread.matchId, 'spin-bottle-room')"))

// ── Chemistry (§16/§20/§73/§75) ─────────────────────────────────────────────
ok('CENTRAL chemistry service (server-only) exists (§20)', !!src('src/lib/quicky/chemistry.ts'))
ok('chemistry combines dating + game signals (§16)', has('src/lib/quicky/chemistry.ts', 'computeOverallChemistry', 'computePairChemistry', 'chemistryConfig'))
ok('landing-stats serves the central chemistry + records (§73)', has('src/app/api/quicky/games/spin-bottle/landing-stats/route.ts', 'computeOverallChemistry', 'chemistry', 'streak', 'league', 'dating'))

console.log('═══ QA: game hub — runtime contract ═══')

async function api(pathname, opts = {}, cookie = null) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers ?? {}) }
  if (cookie) headers.cookie = cookie
  const res = await fetch(`${BASE}${pathname}`, { ...opts, headers })
  let body = null
  try { body = await res.json() } catch {}
  return { status: res.status, body }
}

// Login via the demo OTP flow (same as the other suites) → session cookie
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
  return cookie || null
}

try {
  const cookie = await login('+15557001001')
  ok('auth: OTP login returned a session cookie', !!cookie)

  const unauth = await api('/api/quicky/games')
  ok('GET /api/quicky/games: 401 without a session', unauth.status === 401)

  if (cookie) {
    const cat = await api('/api/quicky/games', {}, cookie)
    ok('GET /api/quicky/games: 200', cat.status === 200)
    const games = cat.body?.games ?? []
    ok('catalog: 8 seeded games', games.length === 8)
    const stb = games.find((g) => g.slug === 'spin-the-bottle')
    ok('catalog: Spin the Bottle present + playable + featured', !!stb && stb.isPlayable === true && stb.isFeatured === true)
    ok('catalog: Truth or Dare + Ludo present, honest not-playable', games.some((g) => g.slug === 'truth-or-dare' && g.isPlayable === false) && games.some((g) => g.slug === 'ludo' && g.supportedModes === 'BOTH'))
    ok('catalog: every game carries the §11 metadata fields', games.every((g) => 'slug' in g && 'name' in g && 'shortDescription' in g && 'icon' in g && 'artwork' in g && 'supportedModes' in g && 'minPlayers' in g && 'maxPlayers' in g && 'isPlayable' in g && 'sortOrder' in g))

    const ls = await api('/api/quicky/games/spin-bottle/landing-stats', {}, cookie)
    ok('landing-stats: 200', ls.status === 200)
    const b = ls.body ?? {}
    ok('landing-stats: legacy records kept', 'gamesPlayed' in b && 'kissesReceived' in b && 'coins' in b && 'level' in b)
    ok('landing-stats: §59/§60 records (points, streak, league)', 'quickyPoints' in b && !!b.streak && 'current' in b.streak && ('league' in b))
    ok('landing-stats: §73 chemistry result (overall + contributions)', !!b.chemistry && 'overall' in b.chemistry && 'datingContribution' in b.chemistry && 'gameContribution' in b.chemistry && b.chemistry.overall >= 0 && b.chemistry.overall <= 100)
    ok('landing-stats: §74 dating block (likes, matches)', !!b.dating && 'likesReceived' in b.dating && 'matches' in b.dating)
  } else {
    ok('auth: OTP login returned a session cookie', false)
  }
} catch (e) {
  ok(`runtime checks crashed: ${e.message}`, false)
}

console.log(`\n═══ RESULT: ${passed} passed, ${failed} failed ═══`)
process.exit(failed > 0 ? 1 : 0)
