// Quicky — seed leagues / seasons / starter sticker bundle (game-chat PRD §62-§72)
// Usage: bun scripts/seed-stickers.mjs
// Idempotent: upserts by name so it can be re-run safely.
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// §65/§66: leagues and seasons are DB rows the admin selects — never
// hardcoded in the frontend.
const leagues = [
  { name: 'Bronze', minimumPoints: 0, sortOrder: 1 },
  { name: 'Silver', minimumPoints: 300, sortOrder: 2 },
  { name: 'Gold', minimumPoints: 1000, sortOrder: 3 },
]
const seasons = [{ name: 'Summer 2026' }]

const upsertLeague = async (l) => {
  // §126: seeds never overwrite admin edits — create-if-missing only.
  const existing = await prisma.gameLeague.findFirst({ where: { name: l.name } })
  if (existing) return existing.id
  const created = await prisma.gameLeague.create({ data: l })
  return created.id
}

const upsertSeason = async (s) => {
  const existing = await prisma.gameSeason.findFirst({ where: { name: s.name } })
  if (existing) return existing.id
  const created = await prisma.gameSeason.create({ data: s })
  return created.id
}

const STICKERS = [
  { name: 'Heart Eyes', assetUrl: '😍', sortOrder: 1 },
  { name: 'Blow A Kiss', assetUrl: '😘', sortOrder: 2 },
  { name: 'Bottle Pop', assetUrl: '🍾', sortOrder: 3 },
  { name: 'Fire Night', assetUrl: '🔥', sortOrder: 4 },
  { name: 'Celebration', assetUrl: '🎉', sortOrder: 5 },
]

const BUNDLE = {
  name: 'Starter Sparks',
  description: 'Five playful starters for your game chats.',
  icon: '✨',
  priceCoins: 100,
  purchaseEnabled: true,
  rewardEnabled: false,
}

const leagueIds = {}
for (const l of leagues) leagueIds[l.name] = await upsertLeague(l)
const seasonIds = {}
for (const s of seasons) seasonIds[s.name] = await upsertSeason(s)

const existingBundle = await prisma.gameStickerBundle.findFirst({ where: { name: BUNDLE.name } })
let bundleId
if (existingBundle) {
  // §126: keep the admin's edits — do NOT rewrite price/name/active.
  bundleId = existingBundle.id
  console.log('kept bundle (admin edits preserved)', BUNDLE.name)
} else {
  const created = await prisma.gameStickerBundle.create({
    data: { ...BUNDLE, leagueId: null, seasonId: seasonIds['Summer 2026'], sortOrder: 1 },
  })
  bundleId = created.id
  console.log('created bundle', BUNDLE.name)
}

for (const s of STICKERS) {
  const existing = await prisma.gameSticker.findFirst({ where: { bundleId, name: s.name } })
  if (existing) {
    console.log('kept sticker (admin edits preserved)', s.name)
  } else {
    await prisma.gameSticker.create({ data: { ...s, bundleId } })
    console.log('created sticker', s.name)
  }
}

await prisma.$disconnect()
console.log('stickers seeded ✓')
