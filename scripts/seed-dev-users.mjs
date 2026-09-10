// Seed local dev users for Quicky (sqlite). Idempotent: upsert by phone.
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const USERS = [
  { phone: '+15555550101', name: 'Luna',   gender: 'female' },
  { phone: '+15555550102', name: 'Mia',    gender: 'female' },
  { phone: '+15555550103', name: 'Aria',   gender: 'female' },
  { phone: '+15555550104', name: 'Sofia',  gender: 'female' },
  { phone: '+15555550105', name: 'Zoe',    gender: 'female' },
  { phone: '+15555550106', name: 'Emma',   gender: 'female' },
  { phone: '+15555550107', name: 'Leo',    gender: 'male'   },
  { phone: '+15555550108', name: 'Marco',  gender: 'male'   },
  { phone: '+15555550109', name: 'Alex',   gender: 'male'   },
  { phone: '+15555550110', name: 'Elena',  gender: 'female' },
  { phone: '+15555550111', name: 'Lucas',  gender: 'male'   },
  { phone: '+15555550112', name: 'Sophia', gender: 'female' },
]

for (const u of USERS) {
  const data = {
    name: u.name,
    gender: u.gender,
    dateOfBirth: new Date('1999-06-21'),
    age: 26,
    onboardedAt: new Date(),
    lastActiveAt: new Date(),
    quickyScore: 120,
  }
  await db.user.upsert({ where: { phone: u.phone }, create: { phone: u.phone, ...data }, update: data })
  console.log('seeded', u.phone, u.name)
}

await db.$disconnect()
console.log('done')
