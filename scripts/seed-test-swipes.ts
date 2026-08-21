// Quicky — create test swipes so the Likes page has data
// Run: bun /home/z/my-project/scripts/seed-test-swipes.ts

import { db } from '../src/lib/db'

async function main() {
  // Find Alex Edited
  const alex = await db.user.findFirst({ where: { name: 'Alex Edited' } })
  if (!alex) { console.error('Alex not found'); process.exit(1) }

  // Find some female personas to like
  const women = await db.user.findMany({
    where: { gender: 'female', id: { not: alex.id } },
    take: 5,
  })

  // Alex likes 3 women
  const liked = women.slice(0, 3)
  for (const w of liked) {
    const existing = await db.swipe.findUnique({
      where: { fromUserId_toUserId: { fromUserId: alex.id, toUserId: w.id } },
    })
    if (!existing) {
      await db.swipe.create({
        data: { fromUserId: alex.id, toUserId: w.id, type: 'like' },
      })
      console.log(`Alex liked ${w.name}`)
    } else {
      console.log(`Alex already swiped ${w.name}`)
    }
  }

  // Alex super-likes 1
  const superLiked = women[3]
  if (superLiked) {
    const existing = await db.swipe.findUnique({
      where: { fromUserId_toUserId: { fromUserId: alex.id, toUserId: superLiked.id } },
    })
    if (!existing) {
      await db.swipe.create({
        data: { fromUserId: alex.id, toUserId: superLiked.id, type: 'superlike' },
      })
      console.log(`Alex super-liked ${superLiked.name}`)
    }
  }

  // Make 3 women like Alex back (so Alex has likes-you data)
  const likers = women.slice(0, 3)
  for (const w of likers) {
    const existing = await db.swipe.findUnique({
      where: { fromUserId_toUserId: { fromUserId: w.id, toUserId: alex.id } },
    })
    if (!existing) {
      await db.swipe.create({
        data: { fromUserId: w.id, toUserId: alex.id, type: 'like' },
      })
      console.log(`${w.name} liked Alex`)
    }
  }

  // Also add a 4th woman who likes Alex (one-sided, no match)
  const extra = women[4] || women[0]
  if (extra && extra.id !== likers[2]?.id) {
    const existing = await db.swipe.findUnique({
      where: { fromUserId_toUserId: { fromUserId: extra.id, toUserId: alex.id } },
    })
    if (!existing) {
      await db.swipe.create({
        data: { fromUserId: extra.id, toUserId: alex.id, type: 'superlike' },
      })
      console.log(`${extra.name} super-liked Alex`)
    }
  }

  console.log('---DONE---')
}

main().catch((e) => { console.error(e); process.exit(1) })
