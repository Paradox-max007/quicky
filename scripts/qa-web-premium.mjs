// Quicky — WEB PREMIUM UI/UX REFACTOR QA (Web Premium PRD §85 Definition of Done)
// Usage: BASE=http://localhost:3000 bun scripts/qa-web-premium.mjs
//
// Layer 1 (source structure): asserts the new architecture exists in src —
// top-nav-only navigation, info-only sidebar, GameChatShell, chat alignment,
// editorial community, likes grid, desktop settings, centered paywall.
// Layer 2 (runtime): /api/quicky/dashboard contract (real data only, §59).
const BASE = process.env.BASE ?? 'http://localhost:3000'
import { readFileSync, existsSync } from 'fs'

let passed = 0
let failed = 0
const ok = (name, cond) => {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ FAIL: ${name}`) }
}

const src = (rel) => {
  try { return readFileSync(`src/${rel}`, 'utf8') } catch { return '' }
}
const has = (rel, ...needles) => {
  const s = src(rel)
  return needles.every((n) => s.includes(n))
}

console.log('═══ QA: web premium refactor — source structure ═══')

// ── Store / routing (§9/§66/§67) ─────────────────────────────────────────────
ok('AppView has a dedicated chats view', has('store/quicky.ts', "| 'chats'"))
ok('store has chatsSection + openChats + setActiveMatchId', has(
  'store/quicky.ts',
  "chatsSection: 'game' | 'dating'",
  'openChats:',
  'setActiveMatchId:'
))
ok('game-section stream stays live on the chats page (§18)', has(
  'src/components/quicky/AppRoot.tsx'.replace('src/', ''),
  "view === 'chats' ||"
))

// ── Global shell (§2-§7/§75/§76/§83) ─────────────────────────────────────────
const topbar = src('components/quicky/desktop/DesktopTopBar.tsx')
ok('top nav has the 5 primary links', ['Discover', 'Likes', 'Community', 'Games', 'Chats'].every((l) => topbar.includes(`label: '${l}'`)))
ok('top nav marks active page (aria-current)', topbar.includes('aria-current'))
ok('top nav Chats opens the chats shell (openChats)', topbar.includes('openChats'))
ok('top nav settings utility present', topbar.includes('topnav-settings'))

const sidebar = src('components/quicky/desktop/DesktopSidebar.tsx')
ok('sidebar carries profile/progress/dating/game/status groups', ['Profile summary', 'Quicky Progress', 'Dating', 'Games', 'Status'].every((x) => sidebar.includes(x)))
const navLeak = ['discovery', "'likes-you'", "'community'", "'spin-bottle'"].some((v) =>
  /setView\(/.test(sidebar) && new RegExp(`setView\\(\\s*${v.replace(/'/g, "\\'")}`).test(sidebar)
)
ok('sidebar has ZERO primary-nav setView calls (§75)', !navLeak && !/label: 'Discover'/.test(sidebar))

const home = src('components/quicky/desktop/DesktopHome.tsx')
ok('DesktopHome routes games + chats + settings pages', ['GamesDesktop', 'ChatsDesktop', 'SettingsDesktop', 'CommunityDesktop', 'LikesDesktop', 'ProfileDesktop'].every((x) => home.includes(x)))

// ── Chats shell (§8-§18/§57/§67/§68) ─────────────────────────────────────────
const chats = src('components/quicky/desktop/ChatsDesktop.tsx')
ok('ChatsDesktop = contacts pane + conversation pane', chats.includes('GameContactsPane') && chats.includes('aside') && chats.includes('ConversationPlaceholder'))
ok('chats page hosts Game + Dating lists (§66 single experience)', chats.includes("chatsSection") && chats.includes('DatingPane'))
ok('chats list: search + skeleton + error + empty (§10/§53/§55)', chats.includes('Search') && chats.includes('chats-game-skeleton') && chats.includes('ErrorState') && chats.includes('EmptyState'))
ok('room runtime surfaced (return to table, §18)', chats.includes('spinBottleRoomId') && chats.includes('spin-bottle-room'))

const room = src('components/quicky/SpinBottleRoom.tsx')
ok('desktop Message → openChats (§15/§16)', room.includes('qk.openChats(\'game\')'))
ok('Capacitor keeps personal→contacts→room stack (§17 mobile)', room.includes("qk.openGameChat(peer, 'game-chat-contacts')"))

const gcs = src('components/quicky/game-chat/GameChatScreen.tsx')
ok('chat messages bottom-anchored via flex spacer (§13)', gcs.includes('mt-auto shrink-0'))
ok('chat three-row layout: header/viewport/composer', gcs.includes('w-full h-full flex flex-col') && gcs.includes('flex-1 overflow-y-auto') && gcs.includes('shrink-0 border-t border-white/10 bg-[var(--qk-bg)]/95'))

// ── Pages (§19-§44/§69-§74) ─────────────────────────────────────────────────
const community = src('components/quicky/desktop/CommunityDesktop.tsx')
ok('community compact instagram-style feed, media uncropped (Task 8)', community.includes('community-compact-feed') && community.includes('object-contain') && !community.includes('data-media-side'))
ok('community details carry like/comment engagement (§23)', community.includes('likeCount') && community.includes('MessageCircle'))
ok('community comments = premium side panel (§24)', community.includes("variant=\"panel\"") || community.includes("variant='panel'"))

const likes = src('components/quicky/desktop/LikesDesktop.tsx')
ok('likes grid 3-col desktop / 4-col large (§27/§29)', likes.includes('grid-cols-3') && likes.includes('min-[1600px]:grid-cols-4'))
ok('likes cards honest content only (§28/§59)', likes.includes('timeAgo') && !likes.includes('avgChemistry'))

const profile = src('components/quicky/desktop/ProfileDesktop.tsx')
ok('profile: hero + about/quicky + stats areas (§33/§72)', profile.includes('profile-hero') && profile.includes('Quicky profile') && profile.includes('Dating stats') && profile.includes('Game stats'))
ok('profile completion from real fields (§36)', profile.includes('DatingProfileCard'))

const settings = src('components/quicky/desktop/SettingsDesktop.tsx')
ok('settings nav|content architecture (§73)', settings.includes('settings-nav') && settings.includes('settings-content'))
ok('settings reuses real screens (§81)', ['EditProfileScreen', 'NotificationsScreen', 'AppearanceScreen', 'DiscoveryPreferencesScreen', 'PrivacySettingsScreen'].every((x) => settings.includes(x)))

const games = src('components/quicky/desktop/GamesDesktop.tsx')
ok('games hub: featured + grid + progression (§39-§42)', games.includes('games-featured') && games.includes('games-grid') && games.includes('games-progress'))
ok('games hub uses live dashboard numbers (§41/§59)', games.includes('live.players') && games.includes('live.rooms'))

// ── Modals + system (§30/§31/§49/§50/§71) ───────────────────────────────────
const paywall = src('components/quicky/PaywallModal.tsx')
ok('paywall centered + blurred backdrop on desktop (§30/§71)', paywall.includes('items-center justify-center bg-black/75 backdrop-blur-md') && paywall.includes('paywall-modal-desktop'))
ok('paywall ESC + focus trap + scroll lock (§31)', paywall.includes("e.key === 'Escape'") && paywall.includes("e.key !== 'Tab'") && paywall.includes("root.style.overflow = 'hidden'"))

const css = src('components/quicky/desktop/desktop.css')
ok('design tokens + page entrance + card hover (§49/§50/§80)', css.includes('--qk-nav-h') && css.includes('qk-page-in') && css.includes('qk-card-hover:hover'))

const webui = src('components/quicky/desktop/web-ui.tsx')
ok('shared WebPageShell max-w 1600 (§47) + skeletons/error/empty (§53/§54)', webui.includes('1600px') && webui.includes('SkeletonBlock') && webui.includes('ErrorState') && webui.includes('EmptyState'))

ok('stale MyQuickyPanel removed (superseded by sidebar)', !existsSync('src/components/quicky/desktop/MyQuickyPanel.tsx'))

// ── Runtime contract (§59: real data only) ──────────────────────────────────
async function login(phone) {
  const otpRes = await fetch(`${BASE}/api/quicky/auth/otp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone }),
  })
  const otp = await otpRes.json()
  if (!otp?.demoCode) throw new Error(`otp failed for ${phone}`)
  const verifyRes = await fetch(`${BASE}/api/quicky/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone, code: otp.demoCode }),
  })
  return verifyRes.headers.get('set-cookie')?.split(';')[0]
}

console.log('═══ QA: web premium refactor — runtime contract ═══')
const cookie = await login('+15557001001')
const res = await fetch(`${BASE}/api/quicky/dashboard`, { headers: { cookie } })
ok('dashboard 200', res.status === 200)
const data = await res.json()
ok('sidebar fields present: points/likes/matches/games/kisses/gifts', ['points', 'likesReceived', 'matches', 'gamesPlayed', 'kisses', 'giftsReceived'].every((k) => typeof data?.stats?.[k] === 'number'))
ok('league progression present or null (never fake)', data?.stats?.league === null || (typeof data?.stats?.league?.name === 'string' && typeof data?.stats?.league?.minimumPoints === 'number'))
ok('live world numbers for games hub', ['rooms', 'players', 'online'].every((k) => typeof data?.live?.[k] === 'number'))

const anon = await fetch(`${BASE}/api/quicky/dashboard`)
ok('dashboard rejects anonymous requests', anon.status === 401)

console.log(`═══ RESULT: ${passed} passed, ${failed} failed ═══`)
process.exit(failed > 0 ? 1 : 0)
