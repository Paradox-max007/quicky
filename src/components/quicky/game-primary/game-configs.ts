'use client'

// Quicky — GAME PRIMARY CONFIG (Unified Game Primary Screen PRD §4/§6/§7/§42)
//
// The GamePrimaryScreen is game-AGNOSTIC: every piece of game-specific
// content (name, stats, how-it-works, rotating texts, progress) arrives
// through a GamePrimaryConfig built HERE from the real data sources — the
// GameDefinition catalog, the Spin the Bottle landing-stats API and the Ludo
// landing API. Adding a future game means adding a config builder, NEVER
// touching the screen itself (§4: no hardcoded Spin-the-Bottle UI logic).
//
// §7: `gameStats` (selected game) is kept strictly separate from
// `overallStats` (combined across games) so future games can add their own
// statistics without changing the page structure.

import { artworkGradient, modeLabel, type GameDef } from '../game-hub/types'

// Re-exported for the game adapters (they build configs, not screens).
export type { GameDef }

// ─── Types (PRD §6/§7/§42) ──────────────────────────────────────────────────

export type GameStat = {
  key: string
  label: string
  icon: string // emoji — keeps the config serializable
  value: number | string
  tint?: string
}

export type GameHowItWorksStep = {
  id: string
  title: string
  description: string
  icon: string
}

export type GamePrimaryConfig = {
  gameId: string
  slug: string
  /** §5 — the display name (e.g. "Spin the Bottle"). */
  name: string
  icon: string
  artwork: string
  modeLabel: string
  playable: boolean
  shortDescription: string
  description: string
  /** §6 — the SELECTED game's statistics. */
  gameStats: GameStat[]
  /** §7 — COMBINED Quicky statistics across games. */
  overallStats: GameStat[]
  /** §42 — Your Progress (league progression bar). */
  progress?: { label: string; value: number; max: number }
  /** §42 — Chemistry (0-100). */
  chemistry?: { value: number; max: number }
  /** League context rendered inside the progress card. */
  league?: {
    name: string
    minimumPoints: number
    nextName: string | null
    nextMinimumPoints: number | null
    points: number
  } | null
  streak?: { current: number; longest: number } | null
  quickyPoints?: number
  datingLikes?: number
  /** §42 — How It Works steps (rotated one at a time). */
  howItWorks: GameHowItWorksStep[]
  /** §42 — Rotating instructional texts under the CTA. */
  rotatingTexts: string[]
}

// ─── Source data shapes (real API responses — never invented numbers) ───────

export type SpinLandingStats = {
  gamesPlayed: number
  kissesReceived: number
  kissesGiven: number
  giftsSent: number
  giftsReceived: number
  coins: number
  level: number
  quickyPoints?: number
  streak?: { current: number; longest: number }
  league?: { name: string; minimumPoints: number; nextName: string | null; nextMinimumPoints: number | null } | null
  chemistry?: { overall: number; datingContribution: number; gameContribution: number }
  dating?: { likesReceived: number; matches: number }
  rotatingTexts?: string[]
}

export type LudoLandingStats = {
  coins: number
  gamesPlayed: number
  quickyPoints: number
  ludoGames: number
  ludoWins: number
  tokensFinished: number
  captures: number
}

// ─── Spin the Bottle content (§43 example) ──────────────────────────────────

// Refactor PRD §20 fallback — used only when admin has no active texts.
export const SPIN_DEFAULT_TAGLINES = [
  'Meet someone new',
  'Take your chance',
  'Choose Kiss or No Thanks',
  'Play with friends',
  'Make unexpected connections',
]

// Lifecycle PRD §51 fallback — mirrors HowItWorksRules' built-in copy.
const SPIN_FALLBACK_RULES: GameHowItWorksStep[] = [
  { id: 'fb-1', title: 'Take Your Seat', description: 'Join a room and meet other players around the table.', icon: '🎲' },
  { id: 'fb-2', title: 'Let It Spin', description: 'The system spins the bottle — when it points at you, the round begins.', icon: '🍾' },
  { id: 'fb-3', title: 'Kiss or No Thanks', description: 'Both players choose ❤️ Kiss or 💔 No Thanks — mutual kisses earn points.', icon: '💋' },
  { id: 'fb-4', title: 'Gift & Shine', description: 'Send gifts, earn Game Points and climb the leaderboard.', icon: '🎁' },
]

export function buildSpinPrimaryConfig(
  game: GameDef | null,
  stats: SpinLandingStats | null,
  adminRules?: { id: string; title: string; description: string; icon: string }[] | null,
  ludo?: LudoLandingStats | null
): GamePrimaryConfig {
  const howItWorks: GameHowItWorksStep[] =
    adminRules && adminRules.length > 0
      ? adminRules
          .filter((r) => r && r.title && r.description)
          .map((r, i) => ({ id: r.id || `rule-${i}`, title: r.title, description: r.description, icon: r.icon || '🎲' }))
      : SPIN_FALLBACK_RULES

  const rotatingTexts =
    stats?.rotatingTexts && stats.rotatingTexts.length > 0 ? stats.rotatingTexts : SPIN_DEFAULT_TAGLINES

  return {
    gameId: game?.id ?? 'spin-the-bottle',
    slug: 'spin-the-bottle',
    name: game?.name ?? 'Spin the Bottle',
    icon: game?.icon ?? '🍾',
    artwork: game?.artwork ?? 'coral',
    modeLabel: game ? modeLabel(game) : '👥 Group · 2–12 players',
    playable: game?.isPlayable ?? true,
    shortDescription: game?.shortDescription ?? 'Spin the bottle, meet someone new.',
    description: game?.description ?? '',
    // §6 Spin the Bottle: Games Played · Kisses · Given · Received (Gifts)
    gameStats: [
      { key: 'games', label: 'Games Played', icon: '🎮', value: stats?.gamesPlayed ?? 0, tint: 'var(--qk-purple)' },
      { key: 'kisses', label: 'Kisses', icon: '💋', value: stats?.kissesReceived ?? 0, tint: 'var(--qk-accent)' },
      { key: 'given', label: 'Given', icon: '✨', value: stats?.kissesGiven ?? 0, tint: 'var(--qk-gold)' },
      { key: 'gifts', label: 'Gifts', icon: '🎁', value: (stats?.giftsSent ?? 0) + (stats?.giftsReceived ?? 0), tint: '#f472b6' },
    ],
    // §7 combined Quicky statistics (real totals across spin + ludo)
    overallStats: combinedOverallStats(stats, ludo ?? null),
    league: stats?.league
      ? {
          name: stats.league.name,
          minimumPoints: stats.league.minimumPoints,
          nextName: stats.league.nextName,
          nextMinimumPoints: stats.league.nextMinimumPoints,
          points: stats.quickyPoints ?? 0,
        }
      : null,
    chemistry: stats?.chemistry ? { value: Math.round(stats.chemistry.overall), max: 100 } : undefined,
    streak: stats?.streak ?? null,
    quickyPoints: stats?.quickyPoints ?? 0,
    datingLikes: stats?.dating?.likesReceived ?? 0,
    howItWorks,
    rotatingTexts,
  }
}

// ─── Quicky Ludo content (§43 example) ──────────────────────────────────────

const LUDO_RULES: GameHowItWorksStep[] = [
  { id: 'ludo-1', title: 'Roll & Escape', description: 'Roll a 6 to move a token out of your yard — a 6 always grants another roll.', icon: '🎲' },
  { id: 'ludo-2', title: 'Capture', description: 'Land on an opponent outside a safe ⭐ square to send them back to their yard.', icon: '⚔️' },
  { id: 'ludo-3', title: 'Climb Home', description: 'Lap the board, then climb your colored home path — the center needs the EXACT count.', icon: '🏠' },
  { id: 'ludo-4', title: 'Win the Table', description: 'First player to bring all 4 tokens home wins the table.', icon: '🏆' },
]

const LUDO_TAGLINES = [
  'Roll the dice…',
  'Move your tokens…',
  'Get all four home…',
  'Capture or be captured…',
  'Race your rivals…',
]

export function buildLudoPrimaryConfig(game: GameDef | null, stats: LudoLandingStats | null): GamePrimaryConfig {
  return {
    gameId: game?.id ?? 'ludo',
    slug: 'ludo',
    name: game?.name ?? 'Quicky Ludo',
    icon: game?.icon ?? '🎲',
    artwork: game?.artwork ?? 'gold',
    modeLabel: game ? modeLabel(game) : '👥 Group · 2–4',
    playable: game?.isPlayable ?? true,
    shortDescription: game?.shortDescription ?? 'Classic Ludo — play with up to 4 players.',
    description:
      game?.description ??
      'The classic board game inside the Quicky game room. Up to 4 players per table, server-authoritative dice and moves, real-time tokens, chat, gifts and mentions.',
    // §6 Ludo: Games Played · Wins · Tokens Home · (Captures)
    gameStats: [
      { key: 'games', label: 'Games Played', icon: '🎮', value: stats?.ludoGames ?? 0, tint: 'var(--qk-purple)' },
      { key: 'wins', label: 'Wins', icon: '🏆', value: stats?.ludoWins ?? 0, tint: 'var(--qk-gold)' },
      { key: 'tokens', label: 'Tokens Home', icon: '🏠', value: stats?.tokensFinished ?? 0, tint: '#30D158' },
      { key: 'captures', label: 'Captures', icon: '⚔️', value: stats?.captures ?? 0, tint: '#f472b6' },
    ],
    // §7 combined Quicky statistics
    overallStats: combinedOverallStats(null, stats),
    chemistry: undefined,
    streak: null,
    quickyPoints: stats?.quickyPoints ?? 0,
    howItWorks: LUDO_RULES,
    rotatingTexts: LUDO_TAGLINES,
  }
}

// ─── Generic / future games (§3: Future Game A, Future Game B) ──────────────

export function buildGenericPrimaryConfig(game: GameDef | null, overall: SpinLandingStats | null): GamePrimaryConfig {
  const taglines = [
    game?.shortDescription || 'More games are coming soon',
    'More games are coming soon',
    'Check back for new ways to play',
  ]

  return {
    gameId: game?.id ?? 'unknown',
    slug: game?.slug ?? 'unknown',
    name: game?.name ?? 'Game',
    icon: game?.icon ?? '🎲',
    artwork: game?.artwork ?? 'purple',
    modeLabel: game ? modeLabel(game) : '',
    playable: game?.isPlayable ?? false,
    shortDescription: game?.shortDescription ?? 'Details are on the way.',
    description: game?.description ?? '',
    // Future games have no per-game stats yet — honest empty list; the screen
    // renders only the combined overall block for them (§7).
    gameStats: [],
    overallStats: combinedOverallStats(overall, null),
    league: overall?.league
      ? {
          name: overall.league.name,
          minimumPoints: overall.league.minimumPoints,
          nextName: overall.league.nextName,
          nextMinimumPoints: overall.league.nextMinimumPoints,
          points: overall.quickyPoints ?? 0,
        }
      : null,
    chemistry: overall?.chemistry ? { value: Math.round(overall.chemistry.overall), max: 100 } : undefined,
    streak: overall?.streak ?? null,
    quickyPoints: overall?.quickyPoints ?? 0,
    datingLikes: overall?.dating?.likesReceived ?? 0,
    howItWorks: [],
    rotatingTexts: taglines,
  }
}

// ─── §7 combined stats helper (shared by every config) ──────────────────────

/** Combined Quicky statistics across games: Total Games · Total Wins ·
 * Total Coins · Total Interactions. Takes whichever game-stat payloads are
 * available and sums across them — future games extend the sum, the page
 * structure never changes. */
export function combinedOverallStats(spin: SpinLandingStats | null, ludo: LudoLandingStats | null): GameStat[] {
  const totalGames = (spin?.gamesPlayed ?? 0) + (ludo?.ludoGames ?? 0)
  const totalWins = ludo?.ludoWins ?? 0
  const totalCoins = spin?.coins ?? ludo?.coins ?? 0
  const totalInteractions =
    (spin?.kissesGiven ?? 0) +
    (spin?.kissesReceived ?? 0) +
    (spin?.giftsSent ?? 0) +
    (spin?.giftsReceived ?? 0) +
    (ludo?.captures ?? 0)

  return [
    { key: 'total-games', label: 'Total Games', icon: '🎮', value: totalGames, tint: 'var(--qk-purple)' },
    { key: 'total-wins', label: 'Total Wins', icon: '🏆', value: totalWins, tint: 'var(--qk-gold)' },
    { key: 'total-coins', label: 'Total Coins', icon: '🪙', value: totalCoins, tint: 'var(--qk-accent)' },
    { key: 'total-interactions', label: 'Interactions', icon: '💬', value: totalInteractions, tint: '#38bdf8' },
  ]
}

/** Theme gradient for a config (re-exported for convenience). */
export function configGradient(config: GamePrimaryConfig): string {
  return artworkGradient(config.artwork)
}
