// Quicky — create/promote an ADMIN user (lifecycle PRD §30-§33)
// Usage: bun scripts/make-admin.mjs <phone> [name]
//   e.g.  bun scripts/make-admin.mjs +15555550000 "Quicky Admin"
//
// The account authenticates through the normal OTP flow (the dev server
// shows the demo code on screen), and the SERVER grants admin powers by
// re-reading User.isAdmin on every protected request — no passwords or
// secrets live in any frontend code.
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const phone = process.argv[2]
if (!phone || !/^\+?\d{6,15}$/.test(phone)) {
  console.error('Usage: bun scripts/make-admin.mjs <phone> [name]')
  process.exit(1)
}
const name = process.argv[3] ?? 'Quicky Admin'
const normalized = phone.startsWith('+') ? phone : `+${phone}`

const user = await prisma.user.upsert({
  where: { phone: normalized },
  update: { isAdmin: true },
  create: {
    phone: normalized,
    name,
    isAdmin: true,
    onboardedAt: new Date(),
    coinBalance: 500,
  },
})

await prisma.$disconnect()
console.log(`✓ ${user.phone} (${user.name}) is now an admin — log in with the OTP demo code.`)
