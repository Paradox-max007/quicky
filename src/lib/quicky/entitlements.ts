// Quicky — Game Entitlements (Premium Party Games PRD §5, §44, §45, §46)
//
// Single source of truth for which games require which subscription tier.
// The `canPlayGame()` helper is the ONLY function the rest of the app should
// call to answer "is this user allowed to play this game?". Both the UI and
// the API routes use it.
//
// Premium Party Games (PRD §2):
//   • Spin the Bottle  → PREMIUM
//   • Ludo             → PREMIUM
//
// Free games:
//   • Truth or Dare    → FREE
//
// Never Have I Ever is COMING_SOON in the dating-chat-games registry, so its
// entitlement is irrelevant until it ships; it is still classified as FREE
// here so the registry gates the visibility, not the entitlement.

import type { AuthUser } from './auth'

// ── Game id union ──────────────────────────────────────────────────────────
//
// These match the Prisma GameSession.gameType values and the
// GameInvitation.gameType values. The dating-chat-games registry uses the
// same ids (ludo / truth_or_dare / never_have_i_ever). Spin-the-Bottle is
// listed here for completeness because the entitlement system is generic
// over all games, not only the dating-chat ones.
//
// IMPORTANT — two different identifiers exist for Spin the Bottle:
//   • `spin_bottle`       — the canonical id used by SpinRoom.gameType
//                           (prisma/schema.prisma:633 default value) and by
//                           the entitlement table below.
//   • `spin-the-bottle`  — the GameDefinition.slug used by the Games-page
//                           catalog (seeded in scripts/seed.ts:464 +
//                           scripts/seed-game-definitions.mjs:11). After
//                           the `replace(/-/g, '_')` transform this becomes
//                           `spin_the_bottle`, which is NOT in the
//                           entitlement table — see `GAME_SLUG_ALIASES`
//                           below for the mapping.
export type GameId =
  | 'spin_bottle'
  | 'ludo'
  | 'truth_or_dare'
  | 'never_have_i_ever'
  | string // defensive — unknown future games fall through to PREMIUM

// ── Required plan ───────────────────────────────────────────────────────────
export type RequiredPlan = 'FREE' | 'PREMIUM'

// ── Slug → canonical GameId aliases ─────────────────────────────────────────
//
// The Games-page catalog uses `GameDefinition.slug` (hyphen-delimited,
// seeded in scripts/seed.ts + scripts/seed-game-definitions.mjs). The
// SpinRoom + GameSession + GameInvitation systems use a separate
// underscore-delimited id. For most games the two align after a simple
// `replace(/-/g, '_')` — but Spin the Bottle does NOT: its catalog slug is
// `spin-the-bottle` (with "the") while the canonical id is `spin_bottle`
// (without "the"). This alias map bridges the two so `GameCard` can pass
// the catalog slug through `slugToGameId()` and get the canonical id that
// the entitlement table is keyed on.
//
// Adding a new game with a non-trivial slug → id mapping is a one-liner
// here; `slugToGameId()` picks it up automatically.
export const GAME_SLUG_ALIASES: Record<string, GameId> = {
  'spin-the-bottle': 'spin_bottle',
  // Future-proof: if a game's catalog slug doesn't transform cleanly to
  // its canonical id, add it here. e.g.:
  //   'never-have-i-ever': 'never_have_i_ever',  // (already clean — no alias needed)
}

/** Convert a GameDefinition.slug (e.g. 'spin-the-bottle') to the canonical
 *  GameId used by the entitlement table (e.g. 'spin_bottle'). Falls back
 *  to `slug.replace(/-/g, '_')` for any slug without an explicit alias. */
export function slugToGameId(slug: string): GameId {
  if (GAME_SLUG_ALIASES[slug]) return GAME_SLUG_ALIASES[slug]
  return slug.replace(/-/g, '_') as GameId
}

// ── Game entitlements config (PRD §45) ─────────────────────────────────────
//
// A small, centralized config table. Adding a new game is a one-liner here;
// `canPlayGame()` picks it up automatically. The Games-page UI and the
// dating-chat-games registry both read the same `RequiredPlan` so the lock
// state is consistent across every entry point.
//
// PRD §2 (Subscription Classification):
//   Spin the Bottle  → PREMIUM (Premium Party Games category)
//   Ludo             → PREMIUM (Premium Party Games category)
//   Truth or Dare    → FREE
//   Never Have I Ever → FREE (currently COMING_SOON per the dating-games
//                     registry; once it ships it'll be free).
export const GAME_ENTITLEMENTS: Record<GameId, RequiredPlan> = {
  spin_bottle: 'PREMIUM',
  ludo: 'PREMIUM',
  truth_or_dare: 'FREE',
  never_have_i_ever: 'FREE',
}

// ── Display metadata (PRD §42, §7) ──────────────────────────────────────────
//
// Used by subscription modals and the Games-page lock cards so the copy is
// consistent. The `category` field lets a modal list "Premium Party Games"
// as one bucket (PRD §3, §42).
export type GameEntitlementInfo = {
  id: GameId
  name: string
  emoji: string
  requiredPlan: RequiredPlan
  category: 'premium_party_games' | 'free_games'
}

export const GAME_ENTITLEMENT_INFO: GameEntitlementInfo[] = [
  { id: 'spin_bottle', name: 'Spin the Bottle', emoji: '🎡', requiredPlan: 'PREMIUM', category: 'premium_party_games' },
  { id: 'ludo', name: 'Ludo', emoji: '🎲', requiredPlan: 'PREMIUM', category: 'premium_party_games' },
  { id: 'truth_or_dare', name: 'Truth or Dare', emoji: '🎭', requiredPlan: 'FREE', category: 'free_games' },
  { id: 'never_have_i_ever', name: 'Never Have I Ever', emoji: '💭', requiredPlan: 'FREE', category: 'free_games' },
]

// Convenience: list of premium party games (for subscription-modal copy).
export const PREMIUM_PARTY_GAMES: GameEntitlementInfo[] = GAME_ENTITLEMENT_INFO.filter(
  (g) => g.category === 'premium_party_games'
)

// ── Premium-active predicate ───────────────────────────────────────────────
//
// Centralizes the "is this user's premium actually live right now?" check.
// The User.isPremium flag is the source of truth, with a `premiumUntil`
// freshness check — `getCurrentUser()` already does lazy expiry, but
// server-side routes sometimes re-read from DB to avoid race conditions.
//
// Accepts either an AuthUser (from `getCurrentUser()`) or a partial User
// row from a direct DB read. Defensive on `premiumUntil`.
export function isPremiumActive(user: { isPremium: boolean; premiumUntil?: Date | null } | null | undefined): boolean {
  if (!user) return false
  if (!user.isPremium) return false
  if (user.premiumUntil && user.premiumUntil instanceof Date && user.premiumUntil.getTime() < Date.now()) {
    return false
  }
  // premiumUntil may be null (= no expiry) — that's still premium.
  return true
}

// ── The one entry point: canPlayGame() (PRD §5, §44) ────────────────────────
//
// Returns `{ allowed: boolean, requiredPlan: RequiredPlan, reason?: string }`.
// `reason` is set when `allowed === false` so the caller can show a precise
// toast / paywall message.
//
// The `user` arg accepts the same shape as `isPremiumActive`. The `gameId`
// is the GameSession.gameType / GameInvitation.gameType / dating-games
// registry id.
export function canPlayGame(
  user: { isPremium: boolean; premiumUntil?: Date | null } | null | undefined,
  gameId: GameId
): { allowed: boolean; requiredPlan: RequiredPlan; reason?: string } {
  const requiredPlan = GAME_ENTITLEMENTS[gameId] ?? 'PREMIUM' // unknown → safe default
  if (requiredPlan === 'FREE') {
    return { allowed: true, requiredPlan: 'FREE' }
  }
  // PREMIUM required
  if (isPremiumActive(user)) {
    return { allowed: true, requiredPlan: 'PREMIUM' }
  }
  return {
    allowed: false,
    requiredPlan: 'PREMIUM',
    reason: 'premium_required',
  }
}

// Convenience: a game's required plan as a string ('FREE' | 'PREMIUM').
export function requiredPlanForGame(gameId: GameId): RequiredPlan {
  return GAME_ENTITLEMENTS[gameId] ?? 'PREMIUM'
}

// Convenience: is this game part of the Premium Party Games category?
export function isPremiumPartyGame(gameId: GameId): boolean {
  return GAME_ENTITLEMENTS[gameId] === 'PREMIUM'
}

// Convenience: friendly display name for a game id (defensive).
export function gameDisplayName(gameId: GameId): string {
  return GAME_ENTITLEMENT_INFO.find((g) => g.id === gameId)?.name ?? gameId
}

// ── AuthUser integration ────────────────────────────────────────────────────
//
// `AuthUser` already carries `isPremium`; it does NOT carry `premiumUntil`
// (see src/lib/quicky/auth.ts). For client-side `canPlayGame()` calls, we
// trust `AuthUser.isPremium` because `getCurrentUser()` already performs
// lazy expiry. For server-side calls that re-read from DB, callers pass the
// full User row (with `premiumUntil`) to get the freshness check too.
export function canPlayGameClient(user: Pick<AuthUser, 'isPremium'> | null | undefined, gameId: GameId) {
  // Client-side trust: isPremium is already lazily-expired by getCurrentUser
  return canPlayGame(user ? { isPremium: user.isPremium, premiumUntil: null } : null, gameId)
}
