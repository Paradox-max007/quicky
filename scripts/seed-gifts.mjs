// Quicky — seed gifts + sticker bundles (bug-fix PRD §48-§55/§125-§127)
// Usage: node scripts/seed-gifts.mjs   (or the combined seed below)
//
// SEED CONTRACT (§126): idempotent AND non-destructive. Seeds match rows by
// STABLE SLUG and CREATE-IF-MISSING only — they never overwrite price, name,
// active flags or sort order that an admin may have edited after seeding.
// Running the seed twice produces the same number of records (§157) and an
// admin-edited price survives normal application operation (§158).
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// ─── Gift categories (§49): Love / Fun / Premium ─────────────────────────────
const CATEGORIES = [
  { name: 'Love', slug: 'giftcat_love', icon: '❤️', sortOrder: 1 },
  { name: 'Fun', slug: 'giftcat_fun', icon: '🎉', sortOrder: 2 },
  { name: 'Premium', slug: 'giftcat_premium', icon: '👑', sortOrder: 3 },
]

// ─── Test gifts (§50): multiple categories, prices, ordering ─────────────────
const GIFTS = [
  { slug: 'gift_rose', name: 'Rose', emoji: '🌹', price: 50, category: 'giftcat_love', sortOrder: 1 },
  { slug: 'gift_heart', name: 'Heart', emoji: '❤️', price: 100, category: 'giftcat_love', sortOrder: 2 },
  { slug: 'gift_chocolate', name: 'Chocolate', emoji: '🍫', price: 150, category: 'giftcat_love', sortOrder: 3 },
  { slug: 'gift_teddy', name: 'Teddy', emoji: '🧸', price: 250, category: 'giftcat_fun', sortOrder: 4 },
  { slug: 'gift_crown', name: 'Crown', emoji: '👑', price: 500, category: 'giftcat_premium', sortOrder: 5 },
  { slug: 'gift_diamond', name: 'Diamond', emoji: '💎', price: 1000, category: 'giftcat_premium', sortOrder: 6 },
]

async function ensureCategory(c) {
  const existing = await prisma.giftCategory.findUnique({ where: { slug: c.slug } })
  if (existing) return existing.id
  const created = await prisma.giftCategory.create({
    data: { name: c.name, slug: c.slug, icon: c.icon, sortOrder: c.sortOrder },
  })
  console.log('created gift category', c.name)
  return created.id
}

async function ensureGift(g, categoryId) {
  const existing = await prisma.gameItem.findUnique({ where: { slug: g.slug } })
  if (existing) {
    console.log('kept gift (admin edits preserved)', g.name)
    return
  }
  await prisma.gameItem.create({
    data: {
      category: 'gift',
      slug: g.slug,
      categoryId,
      name: g.name,
      emoji: g.emoji,
      iconType: 'emoji',
      coinPrice: g.price,
      tier: g.price >= 500 ? 'premium' : 'default',
      isActive: true,
      sortOrder: g.sortOrder,
    },
  })
  console.log('created gift', g.name, `(${g.price} coins)`)
}

// ─── Sticker bundles (§52-§55): 3 bundles, several stickers each ─────────────
const BUNDLES = [
  {
    slug: 'sticker_bundle_love',
    name: 'Love Pack',
    description: 'Hearts and kisses for your favorite players.',
    icon: '❤️',
    priceCoins: 120,
    stickers: [
      { name: 'Heart', assetUrl: '❤️', sortOrder: 1 },
      { name: 'Kiss', assetUrl: '😘', sortOrder: 2 },
      { name: 'Heart Eyes', assetUrl: '😍', sortOrder: 3 },
    ],
  },
  {
    slug: 'sticker_bundle_fun',
    name: 'Fun Pack',
    description: 'Laugh it up at the table.',
    icon: '😂',
    priceCoins: 100,
    stickers: [
      { name: 'Laugh', assetUrl: '😂', sortOrder: 1 },
      { name: 'Cool', assetUrl: '😎', sortOrder: 2 },
      { name: 'Party', assetUrl: '🎉', sortOrder: 3 },
    ],
  },
  {
    slug: 'sticker_bundle_game_night',
    name: 'Game Night Pack',
    description: 'Bring the spin to a boil.',
    icon: '🔥',
    priceCoins: 150,
    stickers: [
      { name: 'Fire', assetUrl: '🔥', sortOrder: 1 },
      { name: 'Bottle Pop', assetUrl: '🍾', sortOrder: 2 },
      { name: 'Celebration', assetUrl: '🎉', sortOrder: 3 },
    ],
  },
]

async function ensureStickerBundle(b) {
  // Bundles have no slug column — the NAME is the stable identifier here
  // (matches the admin UI's uniqueness expectations). Create-if-missing only.
  const existing = await prisma.gameStickerBundle.findFirst({ where: { name: b.name } })
  if (existing) {
    console.log('kept sticker bundle (admin edits preserved)', b.name)
    return
  }
  const created = await prisma.gameStickerBundle.create({
    data: {
      name: b.name,
      description: b.description,
      icon: b.icon,
      priceCoins: b.priceCoins,
      purchaseEnabled: true,
      isActive: true,
      sortOrder: 0,
    },
  })
  for (const s of b.stickers) {
    const existingSticker = await prisma.gameSticker.findFirst({
      where: { bundleId: created.id, name: s.name },
    })
    if (!existingSticker) {
      await prisma.gameSticker.create({ data: { ...s, bundleId: created.id } })
    }
  }
  console.log('created sticker bundle', b.name, `(+${b.stickers.length} stickers)`)
}

async function main() {
  const catIds = {}
  for (const c of CATEGORIES) catIds[c.slug] = await ensureCategory(c)
  for (const g of GIFTS) await ensureGift(g, catIds[g.category])
  for (const b of BUNDLES) await ensureStickerBundle(b)
  await prisma.$disconnect()
  console.log('gifts + sticker bundles seeded ✓ (idempotent, non-destructive)')
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
