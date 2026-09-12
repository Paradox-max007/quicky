// Quicky v3 seed — gift categories, gift catalog (GameItem rows), admin user.
// Idempotent: upserts by slug / name. Run: node scripts/seed-gifts.mjs
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const CATEGORIES = [
  { slug: 'popular',  name: 'Popular',  icon: '⭐', sortOrder: 1 },
  { slug: 'romantic', name: 'Romantic', icon: '🌹', sortOrder: 2 },
  { slug: 'cute',     name: 'Cute',     icon: '🧸', sortOrder: 3 },
  { slug: 'funny',    name: 'Funny',    icon: '😄', sortOrder: 4 },
  { slug: 'premium',  name: 'Premium',  icon: '💎', sortOrder: 5 },
  { slug: 'special',  name: 'Special',  icon: '✨', sortOrder: 6 },
]

// [slug, name, emoji, priceCoins, sortOrder] — matches the legacy
// SPIN_BOTTLE_GIFTS ids so historical SpinRoomGift.itemId stays valid.
const GIFTS = [
  ['rose',      'Rose',      '🌹', 10,   1, 'popular'],
  ['heart',     'Heart',     '💖', 25,   2, 'popular'],
  ['teddy',     'Teddy',     '🧸', 50,   3, 'cute'],
  ['champagne', 'Champagne', '🥂', 100,  4, 'special'],
  ['crown',     'Crown',     '👑', 250,  5, 'premium'],
  ['diamond',   'Diamond',   '💎', 500,  6, 'premium'],
  ['rocket',    'Rocket',    '🚀', 750,  7, 'funny'],
  ['kiss',      'Kiss',      '💋', 1000, 8, 'romantic'],
]

for (const c of CATEGORIES) {
  await db.giftCategory.upsert({
    where: { slug: c.slug },
    create: c,
    update: { name: c.name, icon: c.icon, sortOrder: c.sortOrder, isActive: true },
  })
}
console.log('seeded categories:', CATEGORIES.length)

for (const [id, name, emoji, price, sortOrder, catSlug] of GIFTS) {
  const cat = await db.giftCategory.findUnique({ where: { slug: catSlug } })
  const data = {
    category: 'gift',
    name,
    emoji,
    iconType: 'emoji',
    iconValue: emoji,
    coinPrice: price,
    tier: price >= 250 ? 'premium' : 'default',
    isActive: true,
    sortOrder,
    ...(cat ? { categoryId: cat.id } : {}),
  }
  const existing = await db.gameItem.findUnique({ where: { id } })
  if (existing) {
    await db.gameItem.update({ where: { id }, data })
  } else {
    await db.gameItem.create({ data: { id, ...data } })
  }
}
console.log('seeded gifts:', GIFTS.length)

// Admin user — Leo can open the gift admin panel.
await db.user.updateMany({ where: { phone: '+15555550109' }, data: { isAdmin: true } })
console.log('admin flag set for +15555550109 (Alex)')

// Photos for dev users so seats/landing show avatars. Maps only to files
// that actually exist under public/personas/ (idempotent: fixes stale URLs).
const AVATARS = {
  '+15555550101': 'luna.png', '+15555550102': 'mia.png', '+15555550103': 'aria.png',
  '+15555550104': 'sofia.png', '+15555550105': 'zoe.png', '+15555550106': 'emma.png',
  '+15555550107': 'leo.png', '+15555550108': 'mateo.png', '+15555550109': 'owen.png',
  '+15555550110': 'rex.png', '+15555550111': 'kai.png', '+15555550112': 'theo.png',
}
for (const [phone, file] of Object.entries(AVATARS)) {
  const u = await db.user.findUnique({ where: { phone } })
  if (!u) continue
  const existing = await db.photo.findFirst({ where: { userId: u.id }, orderBy: { position: 'asc' } })
  if (existing) {
    if (existing.url !== `/personas/${file}`) {
      await db.photo.update({ where: { id: existing.id }, data: { url: `/personas/${file}` } })
    }
  } else {
    await db.photo.create({ data: { userId: u.id, url: `/personas/${file}`, position: 0, isPrimary: true } })
  }
}
console.log('avatar check done')

await db.$disconnect()
console.log('done')
