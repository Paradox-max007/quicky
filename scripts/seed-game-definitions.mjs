// Quicky — GAME HUB seed (Game Hub PRD §11/§70/§91)
// Idempotent: upserts one GameDefinition row per game. `isPlayable` is honest
// — only Spin the Bottle has a live room implementation today; everything
// else renders with the real "Coming soon" state (§59 forbids fake statuses).
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const GAMES = [
  {
    slug: 'spin-the-bottle',
    name: 'Spin the Bottle',
    shortDescription: 'Live party table — spins, dares, kisses and gifts in real time.',
    description:
      'Join a live table with up to 12 players. Take turns spinning the bottle, answer truth or dare prompts, send kisses and gifts — every spin is system-controlled and fair.',
    icon: '🍾',
    artwork: 'coral',
    supportedModes: 'GROUP',
    minPlayers: 2,
    maxPlayers: 12,
    isPlayable: true,
    isFeatured: true,
    sortOrder: 1,
  },
  {
    slug: 'truth-or-dare',
    name: 'Truth or Dare',
    shortDescription: 'Classic party truth or dare with playful challenge levels.',
    description:
      'The classic party game with a Quicky twist. Pick truth or dare, match your comfort level, and get to know the other players fast.',
    icon: '🎯',
    artwork: 'purple',
    supportedModes: 'GROUP',
    minPlayers: 3,
    maxPlayers: 12,
    isPlayable: false,
    isFeatured: false,
    sortOrder: 2,
  },
  {
    // Ludo PRD §108 — canonical slug stays 'ludo'; user-facing name is
    // Quicky Ludo. isPlayable: true — the room-based 4-player game is live.
    slug: 'ludo',
    name: 'Quicky Ludo',
    shortDescription: 'Classic 4-player Ludo — dice, captures and a race to home.',
    description:
      'The classic board game inside the Quicky game room. Up to 4 players per table, server-authoritative dice and moves, real-time tokens, chat, gifts and mentions. Roll a 6 to start a token, capture opponents on unsafe squares, and bring all four tokens home to win.',
    icon: '🎲',
    artwork: 'gold',
    supportedModes: 'GROUP',
    minPlayers: 2,
    maxPlayers: 4,
    isPlayable: true,
    isFeatured: true,
    sortOrder: 2,
  },
  {
    slug: 'party-quiz',
    name: 'Party Quiz',
    shortDescription: 'Fast quiz rounds about love, life and your table friends.',
    description:
      'Quick-fire quiz rounds about relationships, hobbies and the people at your table. Most correct answers wins the round.',
    icon: '🧠',
    artwork: 'blue',
    supportedModes: 'GROUP',
    minPlayers: 3,
    maxPlayers: 12,
    isPlayable: false,
    isFeatured: false,
    sortOrder: 4,
  },
  {
    slug: 'would-you-rather',
    name: 'Would You Rather',
    shortDescription: 'Two impossible choices — vote and see where the table lands.',
    description:
      'Vote between two impossible choices and see how the rest of the table voted. Great conversations start here.',
    icon: '🤔',
    artwork: 'purple',
    supportedModes: 'GROUP',
    minPlayers: 2,
    maxPlayers: 12,
    isPlayable: false,
    isFeatured: false,
    sortOrder: 5,
  },
  {
    slug: 'never-have-i-ever',
    name: 'Never Have I Ever',
    shortDescription: 'Confessions, laughter and getting to know each other.',
    description:
      'The ice-breaker classic. Read a confession, everyone who has done it owns up — expect stories.',
    icon: '🙈',
    artwork: 'coral',
    supportedModes: 'GROUP',
    minPlayers: 3,
    maxPlayers: 12,
    isPlayable: false,
    isFeatured: false,
    sortOrder: 6,
  },
  {
    slug: 'guess-who',
    name: 'Guess Who',
    shortDescription: 'Guess who said what — with anonymous table answers.',
    description:
      'Players answer anonymously, then everyone guesses who said what. The closest reader of the table wins.',
    icon: '🕵️',
    artwork: 'blue',
    supportedModes: 'BOTH',
    minPlayers: 2,
    maxPlayers: 6,
    isPlayable: false,
    isFeatured: false,
    sortOrder: 7,
  },
  {
    slug: 'charades',
    name: 'Charades',
    shortDescription: 'Act it out — fast, funny party guessing rounds.',
    description:
      'Act out the prompt while your table races to guess. Camera-on chaos, maximum laughter.',
    icon: '🎭',
    artwork: 'gold',
    supportedModes: 'GROUP',
    minPlayers: 4,
    maxPlayers: 12,
    isPlayable: false,
    isFeatured: false,
    sortOrder: 8,
  },
]

for (const g of GAMES) {
  await db.gameDefinition.upsert({
    where: { slug: g.slug },
    update: {
      name: g.name,
      shortDescription: g.shortDescription,
      description: g.description,
      icon: g.icon,
      artwork: g.artwork,
      supportedModes: g.supportedModes,
      minPlayers: g.minPlayers,
      maxPlayers: g.maxPlayers,
      isPlayable: g.isPlayable,
      isFeatured: g.isFeatured,
      isActive: true,
      sortOrder: g.sortOrder,
    },
    create: g,
  })
  console.log(`seeded game: ${g.slug}`)
}

// Refactor PRD §20 — admin-managed rotating landing texts for the live
// game. Idempotent: upsert by (gameId + text).
const spinGame = await db.gameDefinition.findUnique({ where: { slug: 'spin-the-bottle' } })
if (spinGame) {
  const ROTATING_TEXTS = [
    'Meet someone new',
    'Take your chance',
    'Choose Kiss or No Thanks',
    'Play with friends',
    'Make unexpected connections',
  ]
  for (let i = 0; i < ROTATING_TEXTS.length; i++) {
    const existing = await db.gameDescriptionItem.findFirst({
      where: { gameId: spinGame.id, text: ROTATING_TEXTS[i] },
    })
    if (!existing) {
      await db.gameDescriptionItem.create({
        data: { gameId: spinGame.id, text: ROTATING_TEXTS[i], sortOrder: i, isActive: true },
      })
    }
  }
  console.log(`seeded rotating texts: ${ROTATING_TEXTS.length}`)
}

console.log(`SEED OK — ${GAMES.length} game definitions`)
await db.$disconnect()
