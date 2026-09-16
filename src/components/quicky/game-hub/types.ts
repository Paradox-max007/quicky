// Quicky — GAME HUB shared types + artwork system (Game Hub PRD §11/§63/§64)
// The Games screen and every game landing render from these — artwork keys
// map to theme-compatible gradients (§64: never hardcode an alien palette).

export type GameDef = {
  id: string
  slug: string
  name: string
  shortDescription: string
  description: string
  icon: string
  artwork: string
  supportedModes: string // GROUP | TWO_PLAYER | BOTH
  minPlayers: number
  maxPlayers: number
  isPlayable: boolean
  isFeatured: boolean
  sortOrder: number
}

// Theme-aware gradients per artwork key (dark + premium, §64/§88)
export const ARTWORK_GRADIENTS: Record<string, string> = {
  coral:
    'bg-gradient-to-br from-[var(--qk-accent)] via-[#B23A6E] to-[var(--qk-purple)]',
  purple:
    'bg-gradient-to-br from-[var(--qk-purple)] via-[#7C66C7] to-[#4A3D8F]',
  gold: 'bg-gradient-to-br from-[var(--qk-gold)] via-[#C99640] to-[#8A6420]',
  teal: 'bg-gradient-to-br from-[#5EEAD4] via-[#14B8A6] to-[#0F766E]',
}

export function artworkGradient(key: string): string {
  return ARTWORK_GRADIENTS[key] ?? ARTWORK_GRADIENTS.coral
}

// §10/§25: mode labels for the supported play modes
export function modeLabel(game: Pick<GameDef, 'supportedModes' | 'minPlayers' | 'maxPlayers'>): string {
  if (game.supportedModes === 'TWO_PLAYER') return '💗 2 Players'
  if (game.supportedModes === 'BOTH') return `👥 Group · 💗 2P`
  return `👥 Group · ${game.minPlayers}–${game.maxPlayers}`
}
