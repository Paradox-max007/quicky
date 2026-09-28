// Dating Chat Games — Game Registry (PRD §52)
//
// A configurable registry of games available from the Dating Chat Games menu
// (PRD §5). Each entry drives:
//   - Whether the game is shown in the menu at all
//   - Whether it is playable now or marked "Coming Soon"
//   - How it is launched (currently only the INVITATION flow exists — the
//     sender creates a GameInvitation, the recipient responds, both enter
//     the game)
//
// To add a new game later (e.g. when Never Have I Ever ships), update this
// registry — no other UI changes required (PRD §52).

export type DatingGameStatus =
  | 'AVAILABLE' // shown + playable
  | 'COMING_SOON' // shown but visually disabled (PRD §51)
  | 'HIDDEN' // not shown in the menu (PRD §5 — Truth or Dare)

export type DatingGameLaunchType =
  | 'INVITATION' // PRD §10 — sender invites, recipient decides, both join
  | 'SOLO' // reserved for future single-player games

export type DatingGameMode = 'PRIVATE_2_PLAYER' // PRD §7 — only 2P for now

export type DatingGame = {
  /** Prisma GameInvitation.gameType value — matches the union in game-invites.ts */
  id: 'ludo' | 'never_have_i_ever' | 'truth_or_dare'
  /** Display name in the menu / cards / activity message */
  name: string
  /** Short tagline shown under the name in the menu */
  description: string
  /** Available / Coming Soon / Hidden (PRD §5, §51) */
  status: DatingGameStatus
  /** All dating-chat games are private 2-player (PRD §20) */
  mode: DatingGameMode
  /** How the game is launched (PRD §10, §52) */
  launchType: DatingGameLaunchType
  /** Emoji / icon shown on the game card */
  emoji: string
}

// ── Registry (PRD §52) ─────────────────────────────────────────────────────
//
// Ludo:              AVAILABLE — fully playable via the existing 2P
//                    LudoGame overlay (GameSession-backed, server-authoritative).
// Never Have I Ever: COMING_SOON — visible but not playable (PRD §51). Tap
//                    shows an info toast; no room, no invitation, no session.
// Truth or Dare:     HIDDEN — removed from the menu (PRD §5). The component
//                    is kept in code so existing in-flight sessions can still
//                    finish, but no new launches are possible from the UI.
export const DATING_GAMES: DatingGame[] = [
  {
    id: 'ludo',
    name: 'Ludo',
    description: 'Private 2 Player — challenge your chat partner to a Ludo match.',
    status: 'AVAILABLE',
    mode: 'PRIVATE_2_PLAYER',
    launchType: 'INVITATION',
    emoji: '🎲',
  },
  {
    id: 'never_have_i_ever',
    name: 'Never Have I Ever',
    description: 'A fun question game for you and your chat partner.',
    status: 'COMING_SOON',
    mode: 'PRIVATE_2_PLAYER',
    launchType: 'INVITATION',
    emoji: '💭',
  },
  {
    id: 'truth_or_dare',
    name: 'Truth or Dare',
    description: 'Removed from the Games menu.',
    status: 'HIDDEN',
    mode: 'PRIVATE_2_PLAYER',
    launchType: 'INVITATION',
    emoji: '✨',
  },
]

// ── Selectors ──────────────────────────────────────────────────────────────

/** Games that should appear in the Games menu (AVAILABLE + COMING_SOON). */
export const visibleDatingGames: DatingGame[] = DATING_GAMES.filter(
  (g) => g.status !== 'HIDDEN'
)

/** Games that the user can actually launch right now (AVAILABLE + INVITATION). */
export const playableDatingGames: DatingGame[] = DATING_GAMES.filter(
  (g) => g.status === 'AVAILABLE' && g.launchType === 'INVITATION'
)

/** Look up a game by id (returns undefined for unknown / HIDDEN). */
export function getDatingGame(id: string): DatingGame | undefined {
  return DATING_GAMES.find((g) => g.id === id)
}

/** Display label for an arbitrary gameType string (defensive). */
export function datingGameLabel(id: string): string {
  return getDatingGame(id)?.name ?? id
}
