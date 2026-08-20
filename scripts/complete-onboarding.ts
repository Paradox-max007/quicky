// Quicky — onboarding bypass script
// Completes the onboarding for the current test user and adds 2 portrait photos.
// Run: bun /home/z/my-project/scripts/complete-onboarding.ts <sessionToken>

import { db } from '../src/lib/db'

async function main() {
  const sessionToken = process.argv[2]
  if (!sessionToken) {
    console.error('Usage: complete-onboarding.ts <sessionToken>')
    process.exit(1)
  }

  const session = await db.session.findUnique({
    where: { token: sessionToken },
    include: { user: true },
  })
  if (!session || !session.user) {
    console.error('Invalid session')
    process.exit(1)
  }

  const userId = session.user.id
  const me = session.user
  console.log('Completing onboarding for user', userId, '(phone', me.phone, ')')

  // Pick a persona portrait that doesn't conflict with seeded personas
  // Use 2 random generated portraits from /public/personas
  // Pick "luna" + "mia" as our demo user's photos
  // Use male persona photos for Alex (he's male). Since Alex is looking for women,
  // the male personas (Leo, Mateo, etc.) won't appear in his discovery feed anyway.
  const photos = ['/personas/leo.png', '/personas/mateo.png']
  // Actually, let me pick different ones so we don't see ourselves in discovery — pick 2 from personas we want to date against
  // For a male test user looking for women, pick 2 female portraits... wait, those are our photos, not theirs.
  // The test user IS the seed data. Let me make this test user a 28-year-old male named "Alex".
  // His photos can just be 2 of the male persona portraits.
  // But we don't want him to appear in his own discovery feed. The seed already excludes self.

  // Add photos
  for (let i = 0; i < photos.length; i++) {
    await db.photo.create({
      data: {
        userId,
        url: photos[i],
        position: i,
        isPrimary: i === 0,
      },
    })
    console.log('Added photo:', photos[i])
  }

  // Update user with onboarding info
  const dob = new Date()
  dob.setFullYear(dob.getFullYear() - 28)
  dob.setMonth(5) // June
  dob.setDate(15)

  const updated = await db.user.update({
    where: { id: userId },
    data: {
      name: 'Alex',
      age: 28,
      dateOfBirth: dob,
      gender: 'male',
      lookingFor: 'women',
      bio: 'Software engineer + weekend climber. Here for sparks and good tacos.',
      city: 'Brooklyn, NY',
      interests: JSON.stringify(['hiking', 'coffee', 'photography', 'tacos', 'podcasts']),
      prompts: JSON.stringify([
        { prompt: 'My ideal Sunday...', answer: 'Crack-of-dawn alpine, slow coffee, dog park, asleep by 9.' },
      ]),
      isPremium: false,
      isVerified: true,
      onboardedAt: new Date(),
      lastActiveAt: new Date(),
    },
  })
  console.log('Onboarding complete:', updated.name, updated.age, updated.city)

  // To make discovery interesting: seed a few swipes so we already have matches
  // Find 3 female personas and make them like Alex
  const women = await db.user.findMany({
    where: { gender: 'female' },
    take: 3,
  })
  for (const w of women) {
    await db.swipe.upsert({
      where: { fromUserId_toUserId: { fromUserId: w.id, toUserId: userId } },
      update: { type: 'like' },
      create: { fromUserId: w.id, toUserId: userId, type: 'like' },
    })
    console.log('Simulated like from', w.name, 'to Alex')
  }
  console.log('---DONE---')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
