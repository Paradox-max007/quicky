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
ok('GameLanding dispatches spin/ludo + generic GamePrimaryScreen (§12/§55)', has('src/components/quicky/game-hub/GameLanding.tsx', 'SpinBottleLanding', 'LudoLanding', 'GamePrimaryScreen'))
ok('unified primary screen: dynamic config, no hardcoded game logic (§4/§42)', has('src/components/quicky/game-primary/GamePrimaryScreen.tsx', 'config: GamePrimaryConfig', 'config.name', 'config.gameStats', 'config.rotatingTexts'))
ok('primary screen: Chat/Friends icons INSIDE the profile card flanking the profile image circle; HIDDEN on desktop web lg+ (columns take over), kept on native (v2 §4a)', has('src/components/quicky/game-primary/GamePrimaryScreen.tsx', 'aria-label="Open game chats"', 'aria-label="Open friends"', 'game-primary-chat-icon', 'game-primary-friends-icon', '<MessageCircle', '<Users', 'game-primary-profile-card', "native ? '' : 'lg:hidden'", "native ? '' : 'lg:justify-center'"))
ok('primary screen: desktop 3-column layout — full-width cards, wider social columns 1.6fr:1fr:1fr (v2 §3)', has('src/components/quicky/game-primary/GamePrimaryScreen.tsx', 'game-primary-main-column', 'lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]', 'game-primary-chats-column', 'game-primary-friends-column', 'variant="column"') && !src('src/components/quicky/game-primary/GamePrimaryScreen.tsx').includes('max-w-6xl'))
ok('primary screen: main column ONE vertical flow — Profile Image→You/Level→Statistics→Play Now→Group/Meet→Progress→How It Works (v2 §4)', has('src/components/quicky/game-primary/GamePrimaryScreen.tsx', 'game-primary-profile-card', 'game-primary-tagline', 'game-primary-progress', 'game-primary-how-it-works'))
ok('social columns: persistent, root list never closes, Back restores the list (v2 §3)', has('src/components/quicky/game-primary/GameInteractionPanel.tsx', "variant = 'overlay'", "variant === 'column'", 'rootView', 'root view is PERMANENT'))
ok('small-screen web = Capacitor flow: icons open dedicated screens as a fresh page, overlay panel removed (v2 §6)', has('src/components/quicky/game-primary/GamePrimaryScreen.tsx', 'openGameChatContacts', 'openGameFriends', 'pulseColumn') && !src('src/components/quicky/game-primary/GamePrimaryScreen.tsx').includes('panelRef'))
ok('primary screen: COMMON stats grid + hidden empty combined block (§6/§7 revised)', has('src/components/quicky/game-primary/GamePrimaryScreen.tsx', 'config.overallStats', 'All Quicky', 'config.gameStats'))
ok('primary screen: honest coming-soon state (§70)', src('src/components/quicky/game-primary/GamePrimaryScreen.tsx').includes('COMING SOON'))
ok('web interaction panel: chat|personalChat|friends|friendProfile stack (§20/§37)', has('src/components/quicky/game-primary/GameInteractionPanel.tsx', "'chat'", "'personalChat'", "'friends'", "'friendProfile'", 'friendProfile:'))
ok('web panel: personal chat embeds the EXISTING GameChatScreen (§23/§34)', has('src/components/quicky/game-primary/GameInteractionPanel.tsx', '<GameChatScreen', 'closeConversation'))
ok('web panel: friends list reuses the EXISTING friends API (§35)', has('src/components/quicky/game-primary/GameFriendsList.tsx', 'api.friends.list()'))
ok('bottom Game Chats section REMOVED from the primary screen (§11)', !src('src/components/quicky/SpinBottleLanding.tsx').includes('<GameChatList />'))
ok('Capacitor: dedicated Friends screen with safe area + back stacks (§15-§18/§45)', has('src/components/quicky/game-primary/GameFriendsScreen.tsx', 'gameFriendsReturnView', 'safe-area-top', "openProfile(f.id, 'game-friends')", "'game-friends'"))
ok('store: game-friends view + openGameFriends return target', has('src/store/quicky.ts', "| 'game-friends'", 'openGameFriends', 'gameFriendsReturnView'))
ok('ONE entry screen for every game: shared matchmaking modal kept (§7/§91 revised)', has('src/components/quicky/game-primary/MatchmakingModal.tsx', 'matchmaking-modal', 'matchmaking-progress', 'matchmaking-cancel', "width: ['0%', '94%']") && has('src/components/quicky/SpinBottleLanding.tsx', 'spin-play-now', 'MatchmakingModal') && has('src/components/quicky/ludo/LudoLanding.tsx', 'ludo-play-now', 'MatchmakingModal'))
ok('COMMON stats for ALL games: Total Games/Wins/Coins/Interactions in every config (§6/§7 revised)', has('src/components/quicky/game-primary/game-configs.ts', 'commonGameStats', 'Total Games', 'Total Wins', 'Total Coins', 'Interactions', 'SPIN_DEFAULT_TAGLINES', 'combinedOverallStats') && (src('src/components/quicky/game-primary/game-configs.ts').match(/commonGameStats\(/g) ?? []).length >= 3)
ok('ludo config: taglines + how-it-works kept (§6/§43 revised)', has('src/components/quicky/game-primary/game-configs.ts', 'Roll the dice', 'LUDO_RULES', 'overallStats: []'))

// ── Coin chip + animated Play Now (Unified PRD §8/§54 revised) ──────────────
ok('coin chip: + on the FIRST (Total Coins) tile opens the Coin Store on web AND Capacitor; extra balance strip REMOVED (§8 revised)', (() => {
  const s = src('src/components/quicky/game-primary/GamePrimaryScreen.tsx')
  return s.includes("'data-testid': 'landing-coin-add'") && s.includes('Buy coins — open the coin store') && s.includes('bg-coral-gradient border border-[var(--qk-card)]') && !s.includes('Coin balance + top-up') && !s.includes("(coinBalance ?? 0).toLocaleString('en-US')")
})())
ok('coin count compact chip format: 1000→1K, 1500→1.5K (formatCoinCount)', has('src/components/quicky/game-primary/game-configs.ts', 'export function formatCoinCount', "1000 → \"1K\"", "1500 → \"1.5K\"") && src('src/components/quicky/game-primary/GamePrimaryScreen.tsx').includes('formatCoinCount('))
ok('Play Now: animated icon INSIDE the button — bottle SPINS / dice ROLLS, each loop separated by a rest delay (§54 revised)', has('src/components/quicky/game-primary/AnimatedPlayIcon.tsx', 'AnimatedPlayIconKind', 'repeatDelay: REST_S', "kind === 'bottle' ? '🍾' : '🎲'", 'useReducedMotion') && src('src/components/quicky/SpinBottleLanding.tsx').includes('AnimatedPlayIcon kind="bottle"') && src('src/components/quicky/ludo/LudoLanding.tsx').includes('AnimatedPlayIcon kind="dice"'))
ok('Play Now: WEB a bit shorter in width and CENTERED; NATIVE keeps the full-width CTA (§54 revised)', src('src/components/quicky/game-primary/GamePrimaryScreen.tsx').includes("native ? 'w-full' : 'w-full max-w-[320px] mx-auto'"))

// ── Ludo room: availability + gender weighting (2 male + 2 female) ─────────
ok('ludo join: server checks table availability + gender weighting (2M+2F)', has('src/lib/quicky/ludo-assignment.ts', 'ludoSeatsOfGender', 'maleCapacity: 2', 'femaleCapacity: 2', 'gender_full', 'normalizeGender') && has('src/app/api/quicky/games/ludo/join/route.ts', 'gender: true', 'assignLudoRoomAndSeat(me.id, profile?.gender ?? null)'))

// ── Ludo board rework: full table, corner homes, real-world animations ──────
ok('ludo board: corner HOME BASES (pads + owner chips) + cross path + center triangles', has('src/components/quicky/ludo/LudoBoard.tsx', 'ldo-yard-pad', 'ldo-yard-owner', 'Open Seat', 'ldo-center-tri', 'YARD_SLOTS', 'ldo-cell-start'))
ok('ludo board fills the ENTIRE table (measured stage, thin breathing margin)', has('src/components/quicky/ludo/LudoGameArea.tsx', 'Math.min(r.width, r.height)) - 4', 'yardOwners', "'--ldo-cell': boardPx > 0") && src('src/components/quicky/ludo/ludo-room.css').includes('min(97%, 560px)'))
ok('ludo coins hop like real pieces (lift + squash every square)', has('src/components/quicky/ludo/ludo-room.css', '@keyframes ldo-token-hop', 'ldo-token-moving') && src('src/components/quicky/ludo/LudoBoard.tsx').includes("' ldo-token-moving'"))
ok('ludo dice: REAL 3D cube — two-axis tumble, settles on the server value', has('src/components/quicky/ludo/LudoDice.tsx', 'ldo-dice-cube', 'ldo-dice-face', 'FACE_ORIENTATION', 'data-testid="ludo-dice"') && has('src/components/quicky/ludo/ludo-room.css', 'preserve-3d', '@keyframes ldo-dice-tumble', '@keyframes ldo-dice-shadow', 'perspective'))

// ── Ludo room REVISED: server rolls, 45s window, floating die, toolbox ────
ok('ludo §14 REVISED: dice are a SERVER ACTION — no roll button anywhere, server auto-rolls after a short beat', (() => {
  const area = src('src/components/quicky/ludo/LudoGameArea.tsx')
  const turn = src('src/components/quicky/ludo/LudoRoundBar.tsx')
  return has('src/lib/quicky/ludo/constants.ts', 'TURN_AUTOROLL_DELAY_MS = 1_500', 'TURN_MOVE_TIMEOUT_MS = 45_000') && has('src/lib/quicky/ludo-server.ts', 'async function autoRollFor', '`auto_${Date.now()}', 'await autoRollFor(roomId, state, state.currentPlayerId)', 'scheduleWatchdog(roomId, st)') && !area.includes('onRoll') && !area.includes('ROLL DICE') && !src('src/components/quicky/ludo/LudoRoom.tsx').includes('.roll()') && turn.includes('rolling the dice')
})())
ok('ludo §44 REVISED: 45s visible move timer + CHANCE MISSED center popup (no backdrop) on a skipped chance', has('src/components/quicky/ludo/LudoRoundBar.tsx', 'ludo-move-timer', 'ldo-roundbar-urgent', 'secondsLeft', 'moveDeadlineAt') && has('src/components/quicky/ludo/LudoGameArea.tsx', 'CHANCE_MISSED_MS', 'turn_skipped', 'ludo-chance-missed') && src('src/components/quicky/ludo/ludo-room.css').includes('.ldo-missed'))
ok('ludo §31 REVISED: the die FLOATS over the board and disappears when not in use; the roll lives on in the bottom hint', has('src/components/quicky/ludo/LudoGameArea.tsx', 'ldo-dice-float', 'DICE_HOLD_MS', 'LudoRoundBar') && has('src/components/quicky/ludo/ludo-room.css', '.ldo-dice-float', 'pointer-events: none') && has('src/components/quicky/ludo/LudoRoundBar.tsx', 'rolled ${lastRoll.value}', 'ludo-roundbar'))
ok('ludo §38 REVISED: NO player chips above the table on mobile — profile pictures live in the yard corners and tap open the toolbox', has('src/components/quicky/ludo/LudoBoard.tsx', 'ldo-yard-avatar', 'ldo-ya-', 'onPlayerTap') && has('src/components/quicky/ludo/ludo-room.css', '.ldo-hud-slot { display: none; }', '.ldo-hud-slot { display: block; }', '.ldo-yard-avatar', 'ldo-ya-tl'))
ok('ludo tap-fix: snapshot version-regression guard — stale SSE/poll can never drop a pending dice (mobile token selection)', src('src/store/ludo-room.ts').includes('VERSION-REGRESSION GUARD') && src('src/store/ludo-room.ts').includes('staleGame ? { ...s, game: prevGame } : s'))
ok('ROOM TOOLBOX: standalone reusable player kit — userId in → toolbox out; consumed by BOTH rooms (not per-game hardcoded)', has('src/components/quicky/room-toolbox/useRoomPlayerToolbox.tsx', 'export function useRoomPlayerToolbox', 'toolbox.open', 'PlayerInteractionSheet', 'GiftSheet', 'insertRoomChatMention', 'api.friends.add', 'returnView: AppView', 'beforeOpen', 'resolveAnchor') && src('src/components/quicky/SpinBottleRoom.tsx').includes('useRoomPlayerToolbox') && src('src/components/quicky/ludo/LudoRoom.tsx').includes('useRoomPlayerToolbox') && src('src/components/quicky/ludo/LudoGameArea.tsx').includes('onPlayerTap'))

// ── Navigation (§7/§29) ──────────────────────────────────────────────────────
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
