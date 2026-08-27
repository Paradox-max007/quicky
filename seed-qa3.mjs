import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const user = await db.user.findUnique({ where: { phone: '+19990002003' } })
if (!user) { console.log('no user yet'); process.exit(0) }
const existing = await db.photo.count({ where: { userId: user.id } })
if (existing === 0) {
  const files = ['photo_1787310657673_3b4419bddafa1b22.png', 'photo_1787310666711_5668e3e3713bcc3d.png']
  for (let i = 0; i < files.length; i++) {
    await db.photo.create({ data: { userId: user.id, url: `/uploads/${files[i]}`, position: i, isPrimary: i === 0 } })
  }
}
await db.user.update({ where: { id: user.id }, data: { name: 'QA Viewer', age: 28, onboardedAt: new Date() } })
console.log('onboarded', user.id)
await db.$disconnect()
