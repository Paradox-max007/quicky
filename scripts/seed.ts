// Quicky — DB seed script
// Creates 10 demo personas using the generated portrait images in /public/personas/
// Run: bun /home/z/my-project/scripts/seed.ts

import { db } from '../src/lib/db'
// Use crypto.randomUUID instead of cuid (no extra dep needed)
const cuid = () => crypto.randomUUID()

const PERSONAS_DIR = '/home/z/my-project/public/personas'

type PersonaData = {
  id: string
  name: string
  age: number
  gender: 'male' | 'female'
  lookingFor: 'men' | 'women' | 'everyone'
  city: string
  bio: string
  interests: string[]
  prompts: { prompt: string; answer: string }[]
  isPremium: boolean
  isVerified: boolean
  quickyScore: number
  phone: string
}

const PERSONAS: PersonaData[] = [
  {
    id: 'luna',
    name: 'Luna',
    age: 24,
    gender: 'female',
    lookingFor: 'men',
    city: 'Brooklyn, NY',
    bio: 'Painter + part-time barista. Looking for someone to share late-night diners and gallery openings.',
    interests: ['art', 'coffee', 'vinyl', 'indie-film', 'thrift'],
    prompts: [
      { prompt: 'My ideal Sunday...', answer: 'Cold brew, vinyl on the turntable, long walk through the park.' },
      { prompt: 'The way to my heart is...', answer: 'A well-stocked bookshelf and strong opinions about coffee.' },
    ],
    isPremium: true,
    isVerified: true,
    quickyScore: 312,
    phone: '+15555550101',
  },
  {
    id: 'mia',
    name: 'Mia',
    age: 27,
    gender: 'female',
    lookingFor: 'everyone',
    city: 'Austin, TX',
    bio: 'Software PM by day, salsa dancer by night. Adventure buddy wanted.',
    interests: ['salsa', 'hiking', 'travel', 'podcasts', 'live-music'],
    prompts: [
      { prompt: 'I\'m looking for...', answer: 'Someone with opinions about tacos and the patience to dance badly with me.' },
    ],
    isPremium: false,
    isVerified: true,
    quickyScore: 87,
    phone: '+15555550102',
  },
  {
    id: 'aria',
    name: 'Aria',
    age: 23,
    gender: 'female',
    lookingFor: 'men',
    city: 'Los Angeles, CA',
    bio: 'Yoga teacher. Sea caffeine, slow mornings, dog mom to a corgi named Biscuit.',
    interests: ['yoga', 'meditation', 'dogs', 'matcha', 'beach'],
    prompts: [
      { prompt: 'Green flags I look for...', answer: 'Reads books, calls their mom, doesn\'t honk in traffic.' },
    ],
    isPremium: false,
    isVerified: true,
    quickyScore: 156,
    phone: '+15555550103',
  },
  {
    id: 'sofia',
    name: 'Sofia',
    age: 29,
    gender: 'female',
    lookingFor: 'men',
    city: 'Chicago, IL',
    bio: 'Architect. I will absolutely judge your bookshelf. Looking for someone who reads.',
    interests: ['architecture', 'books', 'wine', 'design', 'running'],
    prompts: [
      { prompt: 'My most controversial opinion is...', answer: 'Brutalism is the only honest architecture.' },
      { prompt: 'The way to my heart is...', answer: 'A bookstore receipt and a handwritten note.' },
    ],
    isPremium: false,
    isVerified: false,
    quickyScore: 489,
    phone: '+15555550104',
  },
  {
    id: 'zoe',
    name: 'Zoe',
    age: 26,
    gender: 'female',
    lookingFor: 'everyone',
    city: 'Portland, OR',
    bio: 'Bike mechanic and punk bassist. Adventure buddy or concert date only.',
    interests: ['cycling', 'punk', 'beer', 'diy', 'tattoos'],
    prompts: [
      { prompt: 'My ideal Sunday...', answer: 'Long ride, longer brunch, louder record.' },
    ],
    isPremium: false,
    isVerified: false,
    quickyScore: 22,
    phone: '+15555550105',
  },
  {
    id: 'emma',
    name: 'Emma',
    age: 31,
    gender: 'female',
    lookingFor: 'men',
    city: 'Seattle, WA',
    bio: 'Pediatric nurse. I make a mean lasagna and an even better listening ear.',
    interests: ['cooking', 'hiking', 'true-crime-podcasts', 'gardening', 'cats'],
    prompts: [
      { prompt: 'I\'m looking for...', answer: 'Someone kind to waiters and allergic to drama.' },
    ],
    isPremium: true,
    isVerified: true,
    quickyScore: 672,
    phone: '+15555550106',
  },
  {
    id: 'leo',
    name: 'Leo',
    age: 28,
    gender: 'male',
    lookingFor: 'women',
    city: 'Brooklyn, NY',
    bio: 'Photographer chasing golden hour. Will trade you a portrait for a coffee date.',
    interests: ['photography', 'coffee', 'jazz', 'motorcycles', 'film'],
    prompts: [
      { prompt: 'Best travel story...', answer: 'Got lost in Lisbon for 36 hours and came back with the best frames of my life.' },
      { prompt: 'Two truths and a lie...', answer: 'I\'ve broken both wrists. I speak Portuguese. I\'ve never had a haircut.' },
    ],
    isPremium: true,
    isVerified: true,
    quickyScore: 198,
    phone: '+15555550107',
  },
  {
    id: 'mateo',
    name: 'Mateo',
    age: 30,
    gender: 'male',
    lookingFor: 'women',
    city: 'Austin, TX',
    bio: 'Chef. Will cook for you on date 3. Probably date 1 too if you ask nicely.',
    interests: ['cooking', 'mezcal', 'soccer', 'travel', 'live-music'],
    prompts: [
      { prompt: 'My ideal Sunday...', answer: 'Mercado, mezcal, mucho cooking.' },
    ],
    isPremium: false,
    isVerified: true,
    quickyScore: 410,
    phone: '+15555550108',
  },
  {
    id: 'kai',
    name: 'Kai',
    age: 26,
    gender: 'male',
    lookingFor: 'everyone',
    city: 'Los Angeles, CA',
    bio: 'Surfer and graphic designer. Talks about waves way too much.',
    interests: ['surfing', 'design', 'tacos', 'vinyl', 'camping'],
    prompts: [
      { prompt: 'My most controversial opinion is...', answer: 'Tacos > burritos and it\'s not close.' },
    ],
    isPremium: false,
    isVerified: true,
    quickyScore: 64,
    phone: '+15555550109',
  },
  {
    id: 'theo',
    name: 'Theo',
    age: 32,
    gender: 'male',
    lookingFor: 'women',
    city: 'Chicago, IL',
    bio: 'Professor of literature. Will absolutely ruin movie night with historical accuracy.',
    interests: ['books', 'jazz', 'coffee', 'cycling', 'cooking'],
    prompts: [
      { prompt: 'The way to my heart is...', answer: 'A book recommendation you\'ve actually finished.' },
      { prompt: 'Green flags I look for...', answer: 'Marginalia in library books. Don\'t tell anyone.' },
    ],
    isPremium: true,
    isVerified: true,
    quickyScore: 540,
    phone: '+15555550110',
  },
  {
    id: 'rex',
    name: 'Rex',
    age: 29,
    gender: 'male',
    lookingFor: 'everyone',
    city: 'Portland, OR',
    bio: 'Brewer and weekend climber. Hoppy IPAs, hard routes, soft landings.',
    interests: ['climbing', 'beer', 'hiking', 'punk', 'dogs'],
    prompts: [
      { prompt: 'My ideal Sunday...', answer: 'Crack of dawn alpine, hazy IPA, dog walk, asleep by 9.' },
    ],
    isPremium: false,
    isVerified: false,
    quickyScore: 38,
    phone: '+15555550111',
  },
  {
    id: 'owen',
    name: 'Owen',
    age: 34,
    gender: 'male',
    lookingFor: 'women',
    city: 'Seattle, WA',
    bio: 'Tech lead by day, woodworker by weekend. Looking for someone patient with my sawdust.',
    interests: ['woodworking', 'hiking', 'whisky', 'podcasts', 'dogs'],
    prompts: [
      { prompt: 'I\'m looking for...', answer: 'Someone who notices the grain. Of wood, of life, of small things.' },
    ],
    isPremium: true,
    isVerified: true,
    quickyScore: 891,
    phone: '+15555550112',
  },
  {
    id: 'nora',
    name: 'Nora',
    age: 25,
    gender: 'female',
    lookingFor: 'men',
    city: 'Brooklyn, NY',
    bio: 'Indie bookstore clerk. I will recommend you a novel and then quiz you on it.',
    interests: ['books', 'coffee', 'poetry', 'vinyl', 'cats'],
    prompts: [
      { prompt: 'The way to my heart is...', answer: 'Correct use of a semicolon; incorrectly is also fine if confident.' },
    ],
    isPremium: false,
    isVerified: true,
    quickyScore: 143,
    phone: '+15555550113',
  },
  {
    id: 'ivy',
    name: 'Ivy',
    age: 27,
    gender: 'female',
    lookingFor: 'everyone',
    city: 'Austin, TX',
    bio: 'Botanical garden guide. My apartment is 60% plants and 40% regret.',
    interests: ['plants', 'hiking', 'watercolor', 'farmers-markets', 'dogs'],
    prompts: [
      { prompt: 'My ideal Sunday...', answer: 'Greenhouse, iced latte, nap under a monstera.' },
    ],
    isPremium: false,
    isVerified: false,
    quickyScore: 58,
    phone: '+15555550114',
  },
  {
    id: 'ruby',
    name: 'Ruby',
    age: 29,
    gender: 'female',
    lookingFor: 'men',
    city: 'Chicago, IL',
    bio: 'Jazz singer on weekends, copywriter on weekdays. Ask me about my vinyl collection.',
    interests: ['jazz', 'vinyl', 'cocktails', 'dancing', 'film'],
    prompts: [
      { prompt: 'Two truths and a lie...', answer: 'I busked in Paris. I hate jazz. I own 300 records.' },
    ],
    isPremium: false,
    isVerified: true,
    quickyScore: 205,
    phone: '+15555550115',
  },
  {
    id: 'elle',
    name: 'Elle',
    age: 24,
    gender: 'female',
    lookingFor: 'everyone',
    city: 'Seattle, WA',
    bio: 'Barista champion hopeful. I can taste the difference between roasts and I will tell you.',
    interests: ['coffee', 'baking', 'running', 'podcasts', 'thrift'],
    prompts: [
      { prompt: 'Green flags I look for...', answer: 'Tips well, reads the menu before ordering, dogs like them.' },
    ],
    isPremium: false,
    isVerified: false,
    quickyScore: 71,
    phone: '+15555550116',
  },
  {
    id: 'finn',
    name: 'Finn',
    age: 27,
    gender: 'male',
    lookingFor: 'women',
    city: 'Portland, OR',
    bio: 'Cartoonist. My hands are always ink-stained and my jokes are always drawn out.',
    interests: ['comics', 'coffee', 'cycling', 'cinema', 'cats'],
    prompts: [
      { prompt: 'My most controversial opinion is...', answer: 'Sunday comics are the peak of the art form.' },
    ],
    isPremium: false,
    isVerified: true,
    quickyScore: 132,
    phone: '+15555550117',
  },
  {
    id: 'dane',
    name: 'Dane',
    age: 31,
    gender: 'male',
    lookingFor: 'everyone',
    city: 'Los Angeles, CA',
    bio: 'Sound engineer. I mix records by day and vinyl by night. Ears on commission.',
    interests: ['music', 'vinyl', 'tacos', 'hiking', 'photography'],
    prompts: [
      { prompt: 'Best travel story...', answer: 'Recorded an album in a Joshua Tree cabin with no Wi-Fi. Best two weeks ever.' },
    ],
    isPremium: false,
    isVerified: false,
    quickyScore: 94,
    phone: '+15555550118',
  },
  {
    id: 'milo',
    name: 'Milo',
    age: 26,
    gender: 'male',
    lookingFor: 'women',
    city: 'Brooklyn, NY',
    bio: 'Climbing gym regular and mediocre sourdough baker. The bread is improving though.',
    interests: ['climbing', 'baking', 'running', 'podcasts', 'dogs'],
    prompts: [
      { prompt: 'I\'m looking for...', answer: 'A belay partner who won\'t judge my fear of the slab wall.' },
    ],
    isPremium: false,
    isVerified: true,
    quickyScore: 47,
    phone: '+15555550119',
  },
  {
    id: 'jonah',
    name: 'Jonah',
    age: 33,
    gender: 'male',
    lookingFor: 'everyone',
    city: 'Seattle, WA',
    bio: 'Marine biologist. Yes, I have held an octopus. No, it was not slimy. Well, slightly.',
    interests: ['diving', 'science', 'hiking', 'whisky', 'documentaries'],
    prompts: [
      { prompt: 'The way to my heart is...', answer: 'Ask me one question about the ocean. Any question. I dare you.' },
    ],
    isPremium: false,
    isVerified: false,
    quickyScore: 118,
    phone: '+15555550120',
  },
]

async function seed() {
  console.log('Cleaning existing data...')
  // Clean in dependency order
  await db.gameTurn.deleteMany()
  await db.gameSession.deleteMany()
  await db.quickyEvent.deleteMany()
  await db.message.deleteMany()
  await db.match.deleteMany()
  await db.swipe.deleteMany()
  await db.block.deleteMany()
  await db.report.deleteMany()
  await db.subscription.deleteMany()
  await db.session.deleteMany()
  await db.otpCode.deleteMany()
  await db.photo.deleteMany()
  await db.user.deleteMany()
  console.log('Clean.')

  for (const p of PERSONAS) {
    const userId = cuid()
    const dob = new Date()
    dob.setFullYear(dob.getFullYear() - p.age)
    dob.setMonth(Math.floor(Math.random() * 12))
    dob.setDate(1 + Math.floor(Math.random() * 28))

    const created = new Date(Date.now() - Math.random() * 14 * 86400000)

    const user = await db.user.create({
      data: {
        id: undefined, // let prisma assign
        phone: p.phone,
        name: p.name,
        age: p.age,
        dateOfBirth: dob,
        gender: p.gender,
        lookingFor: p.lookingFor,
        bio: p.bio,
        city: p.city,
        interests: JSON.stringify(p.interests),
        prompts: JSON.stringify(p.prompts),
        isPremium: p.isPremium,
        premiumUntil: p.isPremium ? new Date(Date.now() + 335 * 86400000) : null,
        isVerified: p.isVerified,
        quickyScore: p.quickyScore,
        onboardedAt: created,
        lastActiveAt: new Date(Date.now() - Math.random() * 3600000),
        createdAt: created,
      },
    })

    // Attach a generated portrait as the primary photo.
    // Only 12 portraits exist, so personas without their own image
    // cycle through the available ones.
    const PORTRAITS = ['luna', 'mia', 'aria', 'sofia', 'zoe', 'emma', 'leo', 'mateo', 'kai', 'theo', 'rex', 'owen']
    const fallback = PORTRAITS[PERSONAS.indexOf(p) % PORTRAITS.length]
    const imageKey = PORTRAITS.includes(p.id) ? p.id : fallback
    const photoUrl = `/personas/${imageKey}.png`

    await db.photo.create({
      data: {
        userId: user.id,
        url: photoUrl,
        position: 0,
        isPrimary: true,
      },
    })

    // Premium subscription record if applicable
    if (p.isPremium) {
      const started = new Date(Date.now() - 30 * 86400000)
      const expires = new Date(Date.now() + 335 * 86400000)
      await db.subscription.create({
        data: {
          userId: user.id,
          plan: 'annual',
          status: 'active',
          startedAt: started,
          expiresAt: expires,
        },
      })
    }

    console.log(`Seeded ${p.name} (${p.id}, ${p.isPremium ? 'Premium' : 'Free'}, score ${p.quickyScore})`)
  }

  console.log('---SEED DONE---')
}

seed().catch((e) => {
  console.error(e)
  process.exit(1)
})
