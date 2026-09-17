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

// Upsert (not blind upsert): when promoting an EXISTING user we must also
// clear the onboarding gate — otherwise a half-onboarded row (e.g. created by
// logging in before running this script) keeps landing in the onboarding flow.
const existing = await prisma.user.findUnique({ where: { phone: normalized } })
const user = existing
  ? await prisma.user.update({
      where: { phone: normalized },
      data: {
        isAdmin: true,
        // Never clobber a real onboarding timestamp; only fill the gap.
        ...(existing.onboardedAt ? {} : { onboardedAt: new Date() }),
      },
    })
  : await prisma.user.create({
      data: {
        phone: normalized,
        name,
        isAdmin: true,
        onboardedAt: new Date(),
        coinBalance: 500,
      },
    })

await prisma.$disconnect()
console.log(
  `✓ ${user.phone} (${user.name}) is now an admin (onboarding gate cleared)` +
  ` — log in with the OTP demo code.` +
  `
  Admin surfaces live in Settings → Admin (Rules / Stickers / Gifts / Games).`
)
