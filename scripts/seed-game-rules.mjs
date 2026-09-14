// Quicky — seed the admin-managed "How It Works" rules (lifecycle PRD §44-§47)
// Usage: bun scripts/seed-game-rules.mjs
// Idempotent: upserts by title so it can be re-run safely.
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const RULES = [
  { title: 'Take Your Seat', description: 'Join a room and meet other players around the table.', icon: '🎲', sortOrder: 1 },
  { title: 'Let It Spin', description: 'The system spins the bottle — when it points at you, the round begins.', icon: '🍾', sortOrder: 2 },
  { title: 'Kiss or No Thanks', description: 'Both players choose ❤️ Kiss or 💔 No Thanks — a mutual kiss earns a point.', icon: '💋', sortOrder: 3 },
  { title: 'Gift & Shine', description: 'Send gifts from the catalog and climb the Kiss Points leaderboard.', icon: '🎁', sortOrder: 4 },
  { title: 'Keep It Fresh', description: 'Rooms are temporary — every table fills with new people each time you play.', icon: '✨', sortOrder: 5 },
]

for (const r of RULES) {
  const existing = await prisma.gameRule.findFirst({ where: { gameType: 'spin_the_bottle', title: r.title } })
  if (existing) {
    await prisma.gameRule.update({
      where: { id: existing.id },
      data: { description: r.description, icon: r.icon, sortOrder: r.sortOrder, isActive: true },
    })
    console.log('updated', r.title)
  } else {
    await prisma.gameRule.create({ data: { gameType: 'spin_the_bottle', ...r } })
    console.log('created', r.title)
  }
}

await prisma.$disconnect()
console.log('game rules seeded ✓')
