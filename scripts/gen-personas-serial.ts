// Quicky — Persona portrait generator (serial, rate-limit-safe)
// Run: bun /home/z/my-project/scripts/gen-personas-serial.ts

import ZAI from 'z-ai-web-dev-sdk'
import fs from 'fs'
import path from 'path'

const OUT_DIR = '/home/z/my-project/public/personas'

type Persona = {
  id: string
  name: string
  visualPrompt: string
}

const REMAINING: Persona[] = [
  {
    id: 'mia',
    name: 'Mia',
    visualPrompt: 'Portrait photo of a 27-year-old Latina woman with long curly dark brown hair, gold hoop earrings, bright smile, wearing a terracotta top, outdoor setting at golden hour with warm bokeh, natural film photography style, candid, attractive',
  },
  {
    id: 'sofia',
    name: 'Sofia',
    visualPrompt: 'Portrait photo of a 29-year-old woman with shoulder-length straight black hair, sleek modern style, intelligent expression with subtle smile, wearing a structured black blazer, minimalist concrete interior background, editorial photography style, sophisticated, attractive',
  },
  {
    id: 'leo',
    name: 'Leo',
    visualPrompt: 'Portrait photo of a 28-year-old man with short dark hair and well-trimmed beard, calm confident expression, wearing an olive field jacket over a white t-shirt, standing on a Brooklyn brownstone stoop at golden hour, warm bokeh, lifestyle photography, attractive',
  },
  {
    id: 'mateo',
    name: 'Mateo',
    visualPrompt: 'Portrait photo of a 30-year-old Latino man with dark hair, light stubble, warm genuine smile, wearing a charcoal linen shirt with sleeves rolled up, kitchen background with warm tungsten light and soft bokeh, lifestyle photography, attractive',
  },
  {
    id: 'rex',
    name: 'Rex',
    visualPrompt: 'Portrait photo of a 29-year-old man with short tousled brown hair, stubble, relaxed grin, wearing a faded flannel shirt over a gray tee, brewery interior background with warm string lights bokeh, candid lifestyle photography, attractive',
  },
  {
    id: 'owen',
    name: 'Owen',
    visualPrompt: 'Portrait photo of a 34-year-old man with short dark hair, neat short beard, calm confident expression, wearing a navy henley shirt with sleeves rolled up showing forearm tattoos, workshop background with warm afternoon light and wood-shavings bokeh, lifestyle photography, attractive',
  },
]

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })
  const zai = await ZAI.create()
  for (const p of REMAINING) {
    const outPath = path.join(OUT_DIR, `${p.id}.png`)
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 10000) {
      console.log(`✓ ${p.id} already exists, skipping`)
      continue
    }
    let attempt = 0
    while (attempt < 4) {
      attempt++
      try {
        console.log(`→ [attempt ${attempt}] ${p.id}`)
        const response = await zai.images.generations.create({
          prompt: p.visualPrompt,
          size: '768x1344',
        })
        const b64 = response.data[0].base64
        const buf = Buffer.from(b64, 'base64')
        fs.writeFileSync(outPath, buf)
        console.log(`✓ saved ${p.id} (${buf.length} bytes)`)
        break
      } catch (e: any) {
        console.error(`✗ ${p.id} attempt ${attempt}: ${e.message}`)
        await sleep(15000 * attempt) // 15s, 30s, 45s backoff
      }
    }
    await sleep(4000) // 4s spacing between personas
  }
  console.log('---DONE---')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
