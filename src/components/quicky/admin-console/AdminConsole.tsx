'use client'

// Quicky ADMIN CONSOLE (Games PRD §55-§67)
// A dedicated, professional administration shell — deliberately NOT the
// Quicky user application:
//   · dark SaaS shell: fixed left sidebar, top command bar, content area
//   · sections: Dashboard / Games / Gifts / Stickers / How-It-Works /
//     Live Tables / Complaints / Users / Audit Log
//   · reuses the existing admin CRUD screens for content management and
//     adds the NEW consoles: overview KPIs, live-table monitor, complaints
//     queue, user management, audit trail
// Access was already verified SERVER-side by /admin/page.tsx (§105).

import { useEffect, useMemo, useState } from 'react'
import {
  LayoutDashboard,
  Gamepad2,
  Gift,
  Sticker,
  ScrollText,
  Radio,
  Flag,
  Users,
  History,
  ExternalLink,
  RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/quicky/api-client'
import { AdminGamesScreen } from '@/components/quicky/AdminGamesScreen'
import { AdminGiftsScreen } from '@/components/quicky/AdminGiftsScreen'
import { AdminStickersScreen } from '@/components/quicky/AdminStickersScreen'
import { AdminRulesScreen } from '@/components/quicky/AdminRulesScreen'
import { AdminOverview } from './AdminOverview'
import { AdminLiveTables } from './AdminLiveTables'
import { AdminComplaints } from './AdminComplaints'
import { AdminUsers } from './AdminUsers'
import { AdminAudit } from './AdminAudit'

type Section =
  | 'overview'
  | 'games'
  | 'gifts'
  | 'stickers'
  | 'rules'
  | 'live'
  | 'complaints'
  | 'users'
  | 'audit'

const NAV: { key: Section; label: string; icon: typeof LayoutDashboard; group: string }[] = [
  { key: 'overview', label: 'Dashboard', icon: LayoutDashboard, group: 'Console' },
  { key: 'games', label: 'Games', icon: Gamepad2, group: 'Content' },
  { key: 'rules', label: 'How It Works', icon: ScrollText, group: 'Content' },
  { key: 'gifts', label: 'Gifts', icon: Gift, group: 'Content' },
  { key: 'stickers', label: 'Stickers', icon: Sticker, group: 'Content' },
  { key: 'live', label: 'Live Tables', icon: Radio, group: 'Operations' },
  { key: 'complaints', label: 'Complaints', icon: Flag, group: 'Operations' },
  { key: 'users', label: 'Users', icon: Users, group: 'Operations' },
  { key: 'audit', label: 'Audit Log', icon: History, group: 'Operations' },
]

export function AdminConsole({ adminName }: { adminName: string }) {
  const [section, setSection] = useState<Section>('overview')

  const groups = useMemo(() => {
    const g: Record<string, typeof NAV> = {}
    for (const item of NAV) {
      ;(g[item.group] ??= []).push(item)
    }
    return g
  }, [])

  return (
    <div className="min-h-screen w-full bg-[#0B0E14] text-white flex" data-testid="admin-console">
      {/* ═══ Sidebar (§57) ═══ */}
      <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-white/8 bg-[#0E121A]">
        <div className="px-5 pt-6 pb-4">
          <p className="text-[10px] font-black tracking-[0.25em] text-white/40 uppercase">Quicky</p>
          <h1 className="text-lg font-black tracking-tight">Admin Console</h1>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pb-6">
          {Object.entries(groups).map(([group, items]) => (
            <div key={group} className="mb-4">
              <p className="px-2 pb-1.5 text-[9px] font-black uppercase tracking-[0.2em] text-white/30">
                {group}
              </p>
              {items.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setSection(key)}
                  className={cn(
                    'w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold transition-colors',
                    section === key
                      ? 'bg-[var(--qk-accent)]/15 text-white border border-[var(--qk-accent)]/30'
                      : 'text-white/55 hover:text-white hover:bg-white/5 border border-transparent'
                  )}
                  data-testid={`admin-nav-${key}`}
                >
                  <Icon className="w-4 h-4" aria-hidden />
                  {label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="px-4 py-4 border-t border-white/8">
          <a
            href="/"
            className="flex items-center gap-2 text-xs font-semibold text-white/50 hover:text-white transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" aria-hidden />
            Back to Quicky app
          </a>
        </div>
      </aside>

      {/* ═══ Main column ═══ */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Command/header bar (§56) */}
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-white/8 bg-[#0B0E14]/95 backdrop-blur px-4 md:px-6 py-3">
          {/* Mobile section switcher */}
          <div className="md:hidden flex-1 -mx-1 overflow-x-auto no-scrollbar">
            <div className="flex gap-1.5 px-1">
              {NAV.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setSection(key)}
                  className={cn(
                    'shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold transition-colors',
                    section === key ? 'bg-[var(--qk-accent)] text-white' : 'bg-white/5 text-white/60'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <h2 className="hidden md:block text-base font-black tracking-tight">
            {NAV.find((n) => n.key === section)?.label}
          </h2>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden sm:inline text-xs text-white/40">
              Signed in as <span className="font-bold text-white/70">{adminName}</span>
            </span>
            <span className="flex items-center gap-1.5 rounded-full bg-[#30D158]/10 border border-[#30D158]/25 px-2.5 py-1 text-[10px] font-black tracking-wider text-[#30D158]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#30D158]" aria-hidden />
              ONLINE
            </span>
          </div>
        </header>

        {/* Content area (§56: cards / tables / filters) */}
        <main className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 py-5">
          {section === 'overview' && <AdminOverview onNavigate={(s) => setSection(s as Section)} />}
          {section === 'games' && <AdminGamesScreen onBack={() => setSection('overview')} />}
          {section === 'gifts' && <AdminGiftsScreen onBack={() => setSection('overview')} />}
          {section === 'stickers' && <AdminStickersScreen onBack={() => setSection('overview')} />}
          {section === 'rules' && <AdminRulesScreen onBack={() => setSection('overview')} />}
          {section === 'live' && <AdminLiveTables />}
          {section === 'complaints' && <AdminComplaints />}
          {section === 'users' && <AdminUsers />}
          {section === 'audit' && <AdminAudit />}
        </main>
      </div>
    </div>
  )
}

/** Small shared card + helpers for the console sub-screens. */
export function ConsoleCard({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-white/8 bg-[#101623] p-4 md:p-5">
      <div className="flex items-center justify-between gap-3 pb-3 mb-3 border-b border-white/8">
        <h3 className="text-sm font-black tracking-tight">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

export function ConsoleRetry({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <span className="text-2xl" aria-hidden>🛠️</span>
      <p className="text-sm text-white/60">We couldn&apos;t load this section.</p>
      <button
        onClick={onRetry}
        className="flex items-center gap-1.5 rounded-full border border-[var(--qk-accent)]/40 px-4 py-2 text-xs font-bold text-[var(--qk-accent)]"
      >
        <RefreshCw className="w-3.5 h-3.5" aria-hidden /> Try again
      </button>
    </div>
  )
}
