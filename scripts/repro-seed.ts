// Seed four fully-onboarded test users + sessions (2P + 4P live QA).
import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'

const db = new PrismaClient()

async function main() {
  const users = [
    { phone: '1000000001', name: 'Alice', gender: 'female', lookingFor: 'male' },
    { phone: '1000000002', name: 'Bob', gender: 'male', lookingFor: 'female' },
    { phone: '1000000003', name: 'Cara', gender: 'female', lookingFor: 'male' },
    { phone: '1000000004', name: 'Dan', gender: 'male', lookingFor: 'female' },
  ]
  for (const u of users) {
    const existing = await db.user.findUnique({ where: { phone: u.phone } })
    const data = {
      ...u,
      age: 30,
      dateOfBirth: new Date('1995-01-01'),
      isPremium: true,
      isVerified: true,
      onboardedAt: new Date(),
      lastActiveAt: new Date(),
    }
    const user = existing ? await db.user.update({ where: { id: existing.id }, data }) : await db.user.create({ data })
    let token = crypto.randomBytes(24).toString('hex')
    const sess = await db.session.findFirst({ where: { userId: user.id, expiresAt: { gt: new Date() } } })
    if (sess) token = sess.token
    else await db.session.create({ data: { token, userId: user.id, expiresAt: new Date(Date.now() + 86400000) } })
    console.log(`${u.name}\t${user.id}\t${token}`)
  }
}

main().finally(() => db.$disconnect())
