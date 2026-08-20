// Quicky — Persona portrait generator
// Generates 12 portrait photos via z-ai-web-dev-sdk in parallel batches of 4.
// Output: /home/z/my-project/public/personas/{id}.png (768x1344 portrait)
//
// Run: bun /home/z/my-project/scripts/gen-personas.ts

import ZAI from 'z-ai-web-dev-sdk'
import fs from 'fs'
import path from 'path'

const OUT_DIR = '/home/z/my-project/public/personas'

type Persona = {
  id: string
  name: string
  age: number
  gender: 'female' | 'male'
  city: string
  bio: string
  interests: string[]
  lookingFor: 'men' | 'women' | 'everyone'
  // visual description for image prompt
  visualPrompt: string
}

export const PERSONAS: Persona[] = [
  {
    id: 'luna',
    name: 'Luna',
    age: 24,
    gender: 'female',
    city: 'Brooklyn, NY',
    bio: 'Painter + part-time barista. Looking for someone to share late-night diners and gallery openings.',
    interests: ['art', 'coffee', 'vinyl', 'indie-film', 'thrift'],
    lookingFor: 'men',
    visualPrompt: 'Portrait photo of a 24-year-old woman with shoulder-length dark wavy hair, warm smile, wearing a cream sweater, sitting in a sunlit Brooklyn coffee shop with soft bokeh background, natural film photography style, candid, attractive, friendly expression',
  },
  {
    id: 'mia',
    name: 'Mia',
    age: 27,
    gender: 'female',
    city: 'Austin, TX',
    bio: 'Software PM by day, salsa dancer by night. Adventure buddy wanted.',
    interests: ['salsa', 'hiking', 'tacos', 'travel', 'podcasts'],
    lookingFor: 'everyone',
    visualPrompt: 'Portrait photo of a 27-year-old Latina woman with long curly dark brown hair, gold hoop earrings, bright smile, wearing a terracotta top, outdoor setting at golden hour with warm bokeh, natural film photography style, candid, attractive',
  },
  {
    id: 'aria',
    name: 'Aria',
    age: 23,
    gender: 'female',
    city: 'Los Angeles, CA',
    bio: 'Yoga teacher. Sea caffeine, slow mornings, dog mom to a corgi named Biscuit.',
    interests: ['yoga', 'meditation', 'dogs', 'matcha', 'beach'],
    lookingFor: 'men',
    visualPrompt: 'Portrait photo of a 23-year-old woman with long blonde hair, minimal natural makeup, soft smile, wearing a sage green athletic top, sitting outdoors in soft morning light with greenery bokeh, natural lifestyle photography, fresh faced, attractive',
  },
  {
    id: 'sofia',
    name: 'Sofia',
    age: 29,
    gender: 'female',
    city: 'Chicago, IL',
    bio: 'Architect. I will absolutely judge your bookshelf. Looking for someone who reads.',
    interests: ['architecture', 'books', 'wine', 'design', 'running'],
    lookingFor: 'men',
    visualPrompt: 'Portrait photo of a 29-year-old woman with shoulder-length straight black hair, sleek modern style, intelligent expression with subtle smile, wearing a structured black blazer, minimalist concrete interior background, editorial photography style, sophisticated, attractive',
  },
  {
    id: 'zoe',
    name: 'Zoe',
    age: 26,
    gender: 'female',
    city: 'Portland, OR',
    bio: 'Bike mechanic and punk bassist. Adventure buddy or concert date only.',
    interests: ['cycling', 'punk', 'beer', 'diy', 'tattoos'],
    lookingFor: 'everyone',
    visualPrompt: 'Portrait photo of a 26-year-old woman with chin-length pastel pink hair, multiple ear piercings, smirking confident expression, wearing a faded black band t-shirt and denim vest, gritty garage workshop background with warm tungsten light, candid film photography, edgy, attractive',
  },
  {
    id: 'emma',
    name: 'Emma',
    age: 31,
    gender: 'female',
    city: 'Seattle, WA',
    bio: 'Pediatric nurse. I make a mean lasagna and an even better listening ear.',
    interests: ['cooking', 'hiking', 'true-crime-podcasts', 'gardening', 'cats'],
    lookingFor: 'men',
    visualPrompt: 'Portrait photo of a 31-year-old woman with warm auburn hair in a low bun, soft natural makeup, kind genuine smile, wearing a cozy cream knit sweater, sitting on a window seat with autumn light, lifestyle photography, warm and approachable, attractive',
  },
  {
    id: 'leo',
    name: 'Leo',
    age: 28,
    gender: 'male',
    city: 'Brooklyn, NY',
    bio: 'Photographer chasing golden hour. Will trade you a portrait for a coffee date.',
    interests: ['photography', 'coffee', 'jazz', 'motorcycles', 'film'],
    lookingFor: 'women',
    visualPrompt: 'Portrait photo of a 28-year-old man with short dark hair and well-trimmed beard, calm confident expression, wearing an olive field jacket over a white t-shirt, standing on a Brooklyn brownstone stoop at golden hour, warm bokeh, lifestyle photography, attractive',
  },
  {
    id: 'mateo',
    name: 'Mateo',
    age: 30,
    gender: 'male',
    city: 'Austin, TX',
    bio: 'Chef. Will cook for you on date 3. Probably date 1 too if you ask nicely.',
    interests: ['cooking', 'mezcal', 'soccer', 'travel', 'live-music'],
    lookingFor: 'women',
    visualPrompt: 'Portrait photo of a 30-year-old Latino man with dark hair, light stubble, warm genuine smile, wearing a charcoal linen shirt with sleeves rolled up, kitchen background with warm tungsten light and soft bokeh, lifestyle photography, attractive',
  },
  {
    id: 'kai',
    name: 'Kai',
    age: 26,
    gender: 'male',
    city: 'Los Angeles, CA',
    bio: 'Surfer and graphic designer. Talks about waves way too much.',
    interests: ['surfing', 'design', 'tacos', 'vinyl', 'camping'],
    lookingFor: 'everyone',
    visualPrompt: 'Portrait photo of a 26-year-old man with sun-lightened brown hair, tanned skin, easy smile, wearing a faded blue linen shirt unbuttoned over a white t-shirt, beach background with sunset bokeh, candid lifestyle photography, attractive',
  },
  {
    id: 'theo',
    name: 'Theo',
    age: 32,
    gender: 'male',
    city: 'Chicago, IL',
    bio: 'Professor of literature. Will absolutely ruin movie night with historical accuracy.',
    interests: ['books', 'jazz', 'coffee', 'cycling', 'cooking'],
    lookingFor: 'women',
    visualPrompt: 'Portrait photo of a 32-year-old man with dark hair, glasses, neat trimmed beard, thoughtful expression, wearing a charcoal wool overcoat over a black turtleneck, dim warm bookshelf background, editorial photography, sophisticated, attractive',
  },
  {
    id: 'rex',
    name: 'Rex',
    age: 29,
    gender: 'male',
    city: 'Portland, OR',
    bio: 'Brewer and weekend climber. Hoppy IPAs, hard routes, soft landings.',
    interests: ['climbing', 'beer', 'hiking', 'punk', 'dogs'],
    lookingFor: 'everyone',
    visualPrompt: 'Portrait photo of a 29-year-old man with short tousled brown hair, stubble, relaxed grin, wearing a faded flannel shirt over a gray tee, brewery interior background with warm string lights bokeh, candid lifestyle photography, attractive',
  },
  {
    id: 'owen',
    name: 'Owen',
    age: 34,
    gender: 'male',
    city: 'Seattle, WA',
    bio: 'Tech lead by day, woodworker by weekend. Looking for someone patient with my sawdust.',
    interests: ['woodworking', 'hiking', 'whisky', 'podcasts', 'dogs'],
    lookingFor: 'women',
    visualPrompt: 'Portrait photo of a 34-year-old man with short dark hair, neat short beard, calm confident expression, wearing a navy henley shirt with sleeves rolled up showing forearm tattoos, workshop background with warm afternoon light and wood-shavings bokeh, lifestyle photography, attractive',
  },
]

async function generateOne(zai: Awaited<ReturnType<typeof ZAI.create>>, persona: Persona): Promise<void> {
  const outPath = path.join(OUT_DIR, `${persona.id}.png`)
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 10000) {
    console.log(`✓ ${persona.id} already exists, skipping`)
    return
  }
  console.log(`→ generating ${persona.id} (${persona.name})`)
  const response = await zai.images.generations.create({
    prompt: persona.visualPrompt,
    size: '768x1344',
  })
  const b64 = response.data[0].base64
  const buf = Buffer.from(b64, 'base64')
  fs.writeFileSync(outPath, buf)
  console.log(`✓ saved ${persona.id} (${buf.length} bytes)`)
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })
  const zai = await ZAI.create()
  // batch of 4 in parallel
  const batch = 4
  for (let i = 0; i < PERSONAS.length; i += batch) {
    const slice = PERSONAS.slice(i, i + batch)
    await Promise.all(slice.map((p) => generateOne(zai, p).catch((e) => console.error(`✗ ${p.id}:`, e))))
  }
  console.log('---DONE---')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
