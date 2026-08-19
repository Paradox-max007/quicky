// Quicky — simulate Mia sending a Quicky to Alex
// Run: bun /home/z/my-project/scripts/simulate-mia-quicky.ts

import { db } from '../src/lib/db'

async function main() {
  // Find Mia
  const mia = await db.user.findFirst({ where: { name: 'Mia' } })
  if (!mia) { console.error('Mia not found'); process.exit(1) }

  // Find the match between Mia and Alex
  const alex = await db.user.findFirst({ where: { name: 'Alex' } })
  if (!alex) { console.error('Alex not found'); process.exit(1) }

  const match = await db.match.findFirst({
    where: {
      OR: [
        { userAId: alex.id, userBId: mia.id },
        { userAId: mia.id, userBId: alex.id },
      ],
    },
  })
  if (!match) { console.error('Match not found'); process.exit(1) }

  console.log('Match:', match.id, '(Mia <-> Alex)')

  // Insert a quicky message from Mia to Alex
  const msg = await db.message.create({
    data: {
      matchId: match.id,
      senderId: mia.id,
      type: 'quicky',
      mediaUrl: '/personas/mia.png',
      text: 'Caught you looking at my profile \u{1F60F}',
      quickyDuration: 5,
      quickyExpiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    },
  })
  console.log('Quicky sent from Mia:', msg.id)

  // Also insert a couple text messages for context
  await db.message.create({
    data: {
      matchId: match.id,
      senderId: mia.id,
      type: 'text',
      text: 'Hey Alex! Climbed anything good lately?',
    },
  })
  console.log('Text sent')

  // Update lastMessageAt
  await db.match.update({
    where: { id: match.id },
    data: { lastMessageAt: new Date() },
  })
  console.log('---DONE---')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
