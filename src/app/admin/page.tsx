// Quicky — ADMIN CONSOLE entry (Games PRD §55/§56/§105)
// A completely separate application shell at /admin — dark professional
// SaaS layout (sidebar + command bar + content area), NOT the user app
// stretched. The server component verifies the session AND a fresh DB
// isAdmin read before rendering anything (§105: never trust client state);
// everyone else is redirected to the app.
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { AdminConsole } from '@/components/quicky/admin-console/AdminConsole'

export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  const me = await getCurrentUser()
  if (!me) redirect('/')
  const u = await db.user.findUnique({ where: { id: me.id }, select: { isAdmin: true, name: true } })
  if (!u?.isAdmin) redirect('/')

  return <AdminConsole adminName={u.name ?? 'Admin'} />
}
